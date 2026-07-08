/**
 * Kanál stavu JEDNÉ partie: úvodní SNAPSHOT přes REST `GET /games/:id` + živé
 * aktualizace přes WebSocket `/games/:id/ws`. Klient tudy NIC neposílá (zápisová
 * cesta PvP jde po ROOM WS – viz `room-client.move`).
 *
 * PROČ i REST snapshot: herní WS je PUSH při ZMĚNĚ – při připojení sám neposílá
 * aktuální stav (fáze 66 ho zavedla jako aditivní k REST). Odběratel by tak zůstal
 * slepý až do prvního tahu; první hráč na tahu by přitom neměl co táhnout. Snapshot
 * tuhle díru zaceluje: vezme aktuální pozici hned, WS pak dorovnává změny.
 *
 * Race snapshot vs. push: kdyby mezi otevřením WS a doběhnutím REST někdo táhl, WS
 * doručí NOVĚJŠÍ stav dřív – snapshot se pak ZAHODÍ (`liveApplied`), ať starší REST
 * nepřepíše čerstvější push. Po připojení WS nic neposílá až do změny, takže každý
 * push je novější než snapshot z okamžiku připojení.
 *
 * Obrana jako u `room-client`: každá WS zpráva se tvarově ověří PŘED přístupem k
 * polím (`isPvpGameDto`), rozbitá/cizí/`null` se TIŠE ignoruje. Pád/zavření/neznámá
 * partie → `onClosed` PRÁVĚ JEDNOU (server neznámou partii rovnou zavře) – UI se
 * nezasekne. Reconnection (todo 42) je mimo řez: `onClosed` jen oznamuje.
 *
 * Web na balíček server nezávisí (nesváže build graf); drátový tvar `PvpGameDto`
 * je ručně držená kopie (viz `server-client.ts`), shodu hlídá serverový `dto.test.ts`.
 */

import { isPvpGameDto } from './server-client.js';
import type { PvpGameDto } from './server-client.js';

/**
 * Minimální rozhraní WebSocketu pro odběr partie. Reálně ho splňuje prohlížečový
 * `WebSocket`; test dodá fake se stejným tvarem. `send` tu ZÁMĚRNĚ není – tímto
 * kanálem klient nic neposílá.
 */
export interface GameWebSocket {
  readonly readyState: number;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

/** Továrna na socket – injektovatelná kvůli testům (výchozí = reálný `WebSocket`). */
export type GameSocketFactory = (url: string) => GameWebSocket;

/** Callbacky do UI. `onState` = nový stav partie; `onClosed` = spojení skončilo (pád/zavření/neznámá partie). */
export interface GameSocketHandlers {
  readonly onState: (game: PvpGameDto) => void;
  readonly onClosed: () => void;
}

export interface GameSocketOptions {
  /** URL WS partie; výchozí se odvodí z `location` (ws/wss + host + /games/:id/ws). */
  readonly url?: string;
  /** Náhrada tovární funkce socketu – jen pro testy (fake socket). */
  readonly socketFactory?: GameSocketFactory;
  /**
   * Načtení úvodního snapshotu partie. Výchozí = `GET /games/:id` (vrací PvP DTO).
   * Vrací `null`, když stav nešel načíst / nemá PvP tvar. Injektovatelné kvůli testům.
   */
  readonly fetchSnapshot?: (gameId: string) => Promise<PvpGameDto | null>;
}

/** Ovládaný odběr partie. `close` odregistruje handlery a zavře socket (bez `onClosed`). */
export interface GameSocket {
  close(): void;
}

/** Výchozí továrna: reálný prohlížečový `WebSocket`. */
function defaultSocketFactory(url: string): GameWebSocket {
  return new WebSocket(url) as unknown as GameWebSocket;
}

/** Odvodí URL WS partie ze stejného původu jako stránka (`wss:` na https). */
function defaultGameUrl(gameId: string): string {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/games/${encodeURIComponent(gameId)}/ws`;
}

/** Výchozí snapshot: `GET /games/:id` (relativní, stejný původ – dev proxy ho přepošle). */
async function defaultFetchSnapshot(gameId: string): Promise<PvpGameDto | null> {
  const res = await fetch(`/games/${encodeURIComponent(gameId)}`);
  if (!res.ok) {
    return null; // 404 (partie zmizela) / jiná chyba – snapshot nemáme, čeká se na push
  }
  const body: unknown = await res.json();
  return isPvpGameDto(body) ? body : null;
}

/**
 * Otevře odběr stavu partie `gameId`. `handlers.onState` se volá při každém
 * pushnutém stavu, `onClosed` právě jednou při konci spojení. `options` umožní
 * podstrčit URL a fake socket v testech.
 */
export function createGameSocket(
  gameId: string,
  handlers: GameSocketHandlers,
  options: GameSocketOptions = {},
): GameSocket {
  const factory = options.socketFactory ?? defaultSocketFactory;
  const fetchSnapshot = options.fetchSnapshot ?? defaultFetchSnapshot;
  // Sloučení `onerror`+`onclose` do JEDINÉHO `onClosed`: prohlížeč typicky pošle
  // error a hned close, nechceme oznámit konec dvakrát.
  let down = false;
  let closed = false;
  // `true`, jakmile dorazil první ŽIVÝ push z WS. Po něm se úvodní REST snapshot
  // ZAHODÍ (novější stav už na desce je – viz race v hlavičce modulu).
  let liveApplied = false;

  const target = options.url ?? defaultGameUrl(gameId);
  const socket = factory(target);

  /** Odpojí handlery a zavře socket – bez vyvolání `onClosed` (to je záměr při `close()`). */
  function teardown(): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Zavření už zavíraného/rozbitého socketu je neškodné – appka běží dál.
    }
  }

  /** Konec spojení (error/close) → jednou `onClosed`. Po `close()` už nikdy. */
  function handleDown(): void {
    if (down || closed) {
      return;
    }
    down = true;
    handlers.onClosed();
  }

  socket.onmessage = (event): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return; // nevalidní JSON – ignoruj, nespadni
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return; // primitiva / null / pole – nezpráva, zahoď
    }
    const msg = parsed as Record<string, unknown>;
    if (msg.type !== 'game-state' || !isPvpGameDto(msg.game)) {
      // Cizí/neúplná zpráva nebo engine stav (jiný `mode`) – tímto kanálem nečekáme, zahoď.
      return;
    }
    liveApplied = true; // od teď má WS přednost před (starším) REST snapshotem
    handlers.onState(msg.game);
  };
  socket.onerror = (): void => {
    handleDown();
  };
  socket.onclose = (): void => {
    handleDown();
  };

  // Úvodní snapshot přes REST. Aplikuje se JEN pokud mezitím nedorazil živý push
  // (novější) a kanál se nezavřel. Selhání/`null` (partie zmizela, ne-PvP tvar) se
  // spolkne – deska počká na první push; snapshot není jediná cesta ke stavu.
  void fetchSnapshot(gameId)
    .then((snapshot) => {
      // `down` (pád socketu) i `closed` (explicitní close) blokují snapshot: kanál
      // je mrtvý, opožděný REST by jinak OŽIVIL neinteraktivní stav bez živých
      // aktualizací (typicky když se WS neupgradoval a hned spadl, ale REST prošel).
      if (closed || down || liveApplied || snapshot === null) {
        return;
      }
      handlers.onState(snapshot);
    })
    .catch((error: unknown) => {
      console.error('Úvodní stav partie se nepodařilo načíst, čekám na push:', error);
    });

  return {
    close(): void {
      closed = true;
      teardown();
    },
  };
}

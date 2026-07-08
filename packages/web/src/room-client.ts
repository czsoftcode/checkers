/**
 * Klient společné MÍSTNOSTI přes WebSocket (`/room/ws`). Je to jediná vrstva
 * webového klienta, která mluví po WS (dnešní deska jede přes REST polling – to
 * je jiný řez). Server je autorita nad obsazeností místnosti; klient jen posílá
 * `join{nick}` a reaguje na drátové zprávy.
 *
 * Drátový kontrakt (server → klient) je ručně držená kopie tvaru z
 * `packages/server/src/presence.ts` – web na balíček server ZÁMĚRNĚ nezávisí
 * (nesváže build graf), stejně jako u `GameDto` v `server-client.ts`. Shodu hlídá
 * ruční e2e a serverové testy; tady se každá příchozí zpráva tvarově ověří PŘED
 * přístupem k polím, ať rozbitá/cizí zpráva klienta neshodí.
 *
 * Životní cyklus a stav `joined`:
 *  - `join(nick)` otevře socket (když žádný neběží / je zavřený) a na `open` pošle
 *    `join{nick}` PRÁVĚ JEDNOU. Server drží socket otevřený i při obsazené
 *    přezdívce (`nick-taken`), takže než join uspěje, smí klient poslat join
 *    znovu (opakování s jiným nickem) po TÉMŽE socketu – to server dovolí.
 *  - Jakmile přijde `roster` (join uspěl → `joined=true`), další `join` se ignoruje:
 *    server by na druhý join po úspěchu vrátil `error` „Už jsi v místnosti".
 *  - `left`/`joined`/`roster` udržují lokální roster (podle `id`). „Ty" v rosteru
 *    se pozná porovnáním na přezdívku, se kterou join uspěl (server ji jen trimuje).
 *  - Pád spojení (`onerror`/`onclose`) → `onDisconnected` (právě jednou; obě
 *    události se sloučí). `join(nick)` po pádu otevře čerstvý socket a zkusí znovu.
 *  - `dispose()` odregistruje handlery a zavře socket; po něm už žádný callback
 *    (ani `onDisconnected` z právě zavíraného socketu).
 */

/** `WebSocket.OPEN` dle WHATWG (i knihovna ws). Otevřený socket. */
const WS_OPEN = 1;

/** Přezdívka + skryté session id přítomného hráče (drátový tvar serveru). */
export interface RoomPlayer {
  readonly id: string;
  readonly nick: string;
}

/** Položka rosteru pro UI: hráč + příznak, že jsem to já (zvýraznění v seznamu). */
export interface RosterEntry {
  readonly id: string;
  readonly nick: string;
  readonly isSelf: boolean;
}

/**
 * Minimální rozhraní WebSocketu, které klient potřebuje. Reálně ho splňuje
 * prohlížečový `WebSocket` (viz {@link defaultSocketFactory}); test dodá fake se
 * stejným tvarem, aby šel klient ověřit bez skutečného spojení.
 */
export interface RoomWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

/** Továrna na socket – injektovatelná kvůli testům (výchozí = reálný `WebSocket`). */
export type RoomSocketFactory = (url: string) => RoomWebSocket;

/**
 * Callbacky do UI. Všechny volitelné. `onJoined` nese počáteční roster (join
 * uspěl → přepni na pohled místnosti); `onRoster` jen změny za běhu; `onNickTaken`
 * a `onError` drží socket otevřený (uživatel opraví a pošle znovu); `onDisconnected`
 * = spadlo spojení (nabídni „Připojit znovu").
 */
export interface RoomClientHandlers {
  readonly onJoined?: (roster: RosterEntry[]) => void;
  readonly onRoster?: (roster: RosterEntry[]) => void;
  readonly onNickTaken?: (suggestion: string) => void;
  readonly onError?: (message: string) => void;
  readonly onDisconnected?: () => void;
}

export interface RoomClientOptions {
  /** URL WS místnosti; výchozí se odvodí z `location` (ws/wss + host). */
  readonly url?: string;
  /** Náhrada tovární funkce socketu (test injektuje fake). */
  readonly socketFactory?: RoomSocketFactory;
  /**
   * Limit (ms), do kdy musí po otevření dorazit DEFINITIVNÍ odpověď serveru na
   * join (`roster`/`nick-taken`/`error`). Když nepřijde – mrtvé (half-open)
   * spojení NEBO tvarově vadná odpověď, kterou parser tiše zahodí – spojení se
   * shodí a ohlásí `onDisconnected`, ať UI neuvázne navěky v „Připojuji…". Výchozí
   * {@link DEFAULT_CONNECT_TIMEOUT_MS}; test si dá krátký s fake časovači.
   */
  readonly connectTimeoutMs?: number;
}

/** Výchozí limit na odpověď serveru po připojení (viz `connectTimeoutMs`). */
export const DEFAULT_CONNECT_TIMEOUT_MS = 12000;

/** Ovládání klienta místnosti. `dispose` zavře socket a odmlčí callbacky. */
export interface RoomClient {
  /**
   * Vstup do místnosti pod přezdívkou. Otevře socket (nebo použije už otevřený,
   * pokud join ještě neuspěl – opakování po `nick-taken`/`error`) a pošle
   * `join{nick}`. Po úspěšném joinu je no-op (server by druhý join odmítl).
   */
  join(nick: string): void;
  dispose(): void;
}

/** Výchozí továrna: reálný prohlížečový `WebSocket`. Cast: jeho tvar sedí na {@link RoomWebSocket}. */
function defaultSocketFactory(url: string): RoomWebSocket {
  return new WebSocket(url) as unknown as RoomWebSocket;
}

/** Odvodí URL WS místnosti ze stejného původu jako stránka (`wss:` na https). */
function defaultRoomUrl(): string {
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/room/ws`;
}

/** Runtime guard tvaru `RoomPlayer` (drift/cizí zpráva → odmítni, ať neproteče undefined). */
function isRoomPlayer(value: unknown): value is RoomPlayer {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.nick === 'string';
}

/**
 * Vytvoří klienta místnosti. `handlers` se volají při drátových událostech;
 * `options` umožní podstrčit URL a fake socket v testech.
 */
export function createRoomClient(
  handlers: RoomClientHandlers,
  options: RoomClientOptions = {},
): RoomClient {
  const factory = options.socketFactory ?? defaultSocketFactory;
  // URL se počítá LÍNĚ až v `openSocket` (ne teď): default sahá na `window.location`,
  // což v node testech není – kdo injektuje `socketFactory`, dá i `url`.
  const url = options.url;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  let socket: RoomWebSocket | null = null;
  // Časovač na odpověď serveru po připojení (viz `connectTimeoutMs`). Běží od
  // otevření socketu do PRVNÍ definitivní odpovědi (roster/nick-taken/error) nebo
  // do pádu spojení; když vyprší, spojení se shodí (jinak by UI viselo v „Připojuji…").
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  // Roster drží Map podle `id`: zachovává pořadí vložení (roster/joined) a dává
  // O(1) mazání na `left`. `id` je autoritní klíč (přezdívka je jen jmenovka).
  const players = new Map<string, RoomPlayer>();
  // Přezdívka, se kterou join NAPOSLEDY poslán (trimnutá klientem stejně jako server).
  // Po úspěchu (`roster`) je to moje přezdívka → podle ní se v rosteru pozná „ty".
  let pendingNick = '';
  let myNick: string | null = null;
  // `true` po úspěšném joinu (přišel `roster`). Blokuje další join (server by ho
  // po úspěchu odmítl) a rozliší „spadlo spojení po vstupu" od „nikdy nevstoupil".
  let joined = false;
  // Sloučení `onerror`+`onclose` do JEDNOHO `onDisconnected`: prohlížeč typicky
  // pošle error a hned close, nechceme hlásit odpojení dvakrát. Reset při novém socketu.
  let down = false;
  let disposed = false;

  /** Aktuální roster v UI tvaru; `isSelf` = přezdívka se shoduje s mou (case-insensitive). */
  function rosterEntries(): RosterEntry[] {
    const mine = myNick?.toLowerCase() ?? null;
    return [...players.values()].map((p) => ({
      id: p.id,
      nick: p.nick,
      isSelf: mine !== null && p.nick.toLowerCase() === mine,
    }));
  }

  /** Zruší běžící connect-timer (idempotentní). */
  function clearConnectTimer(): void {
    if (connectTimer !== null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  /** Odpojí handlery a zavře socket (bez vyvolání `onDisconnected` – to je záměr při teardownu). */
  function teardownSocket(): void {
    clearConnectTimer();
    if (socket === null) {
      return;
    }
    const old = socket;
    // Handlery pryč PŘED close: jinak by `onclose` z tohohle close spustil handleDown.
    old.onopen = null;
    old.onmessage = null;
    old.onerror = null;
    old.onclose = null;
    socket = null;
    try {
      old.close();
    } catch {
      // Zavření už zavíraného/rozbitého socketu je neškodné – appka běží dál.
    }
  }

  /** Otevře čerstvý socket a navěsí handlery. `join{pendingNick}` se pošle až na `open`. */
  function openSocket(): void {
    teardownSocket();
    joined = false;
    down = false;
    const target = url ?? defaultRoomUrl();
    const sock = factory(target);
    socket = sock;
    sock.onopen = (): void => {
      sendJoin();
    };
    sock.onmessage = (event): void => {
      handleMessage(event.data);
    };
    sock.onerror = (): void => {
      handleDown();
    };
    sock.onclose = (): void => {
      handleDown();
    };
  }

  /**
   * Pošle `join{pendingNick}` po otevřeném socketu a nasadí limit na odpověď.
   * Server je autorita nad validací. Časovač běží při KAŽDÉM joinu (prvním i
   * opakovaném po `nick-taken`), ať ani hang na druhý pokus neuvázne.
   */
  function sendJoin(): void {
    if (socket?.readyState !== WS_OPEN) {
      return;
    }
    socket.send(JSON.stringify({ type: 'join', nick: pendingNick }));
    // Server musí do limitu odpovědět (roster/nick-taken/error). Když ne (mrtvé
    // spojení nebo tvarově vadná, tiše zahozená odpověď), spojení shodíme a
    // ohlásíme odpojení – UI se tak dostane z „Připojuji…" ven a půjde zkusit znovu.
    clearConnectTimer();
    connectTimer = setTimeout(() => {
      teardownSocket(); // zavře socket + vynuluje handlery (a sám tento timer)
      handleDown();
    }, connectTimeoutMs);
  }

  /** Pád spojení (error/close/timeout) → jednou `onDisconnected`. */
  function handleDown(): void {
    clearConnectTimer(); // spojení je pryč – čekání na odpověď už nedává smysl
    if (down || disposed) {
      return;
    }
    down = true;
    handlers.onDisconnected?.();
  }

  /**
   * Zpracuje drátovou zprávu. Nevalidní JSON, ne-objekt, chybějící/špatný `type`
   * i NEZNÁMÝ typ (dopředná kompatibilita – zprávy výzev přijdou v další fázi) se
   * TIŠE ignorují: klient je odběratel místnosti, ne validátor serveru. Každé pole
   * se ověří PŘED přístupem, ať rozbitá zpráva neshodí render.
   */
  function handleMessage(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return; // nevalidní JSON – ignoruj, nespadni
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }
    const msg = parsed as Record<string, unknown>;
    switch (msg.type) {
      case 'roster': {
        // Vadný roster ZÁMĚRNĚ NEruší connect-timer: nechá ho vypršet → spojení se
        // shodí a UI se z „Připojuji…" dostane ven (tichý drop by jinak zamrzl).
        if (!Array.isArray(msg.players) || !msg.players.every(isRoomPlayer)) {
          return;
        }
        clearConnectTimer(); // platná odpověď serveru – join dořešen
        players.clear();
        for (const p of msg.players) {
          players.set(p.id, p);
        }
        joined = true;
        myNick = pendingNick; // join uspěl → tenhle nick jsem já
        handlers.onJoined?.(rosterEntries());
        return;
      }
      case 'joined': {
        if (!isRoomPlayer(msg.player)) {
          return;
        }
        players.set(msg.player.id, msg.player);
        handlers.onRoster?.(rosterEntries());
        return;
      }
      case 'left': {
        // `left` nese jen `{ id }` (ne celého hráče). Optional chain snese i ne-objekt.
        const id = (msg.player as { id?: unknown } | null)?.id;
        if (typeof id !== 'string') {
          return;
        }
        players.delete(id);
        handlers.onRoster?.(rosterEntries());
        return;
      }
      case 'nick-taken': {
        if (typeof msg.suggestion !== 'string') {
          return;
        }
        clearConnectTimer(); // server odpověděl (nick zabraný) – čekání skončilo
        handlers.onNickTaken?.(msg.suggestion);
        return;
      }
      case 'error': {
        if (typeof msg.message !== 'string') {
          return;
        }
        clearConnectTimer(); // server odpověděl (chyba) – čekání skončilo
        handlers.onError?.(msg.message);
        return;
      }
      default:
        return; // neznámý typ (např. zprávy výzev) – ignoruj
    }
  }

  return {
    join(nick: string): void {
      if (disposed) {
        return;
      }
      pendingNick = nick.trim();
      if (socket !== null && socket.readyState === WS_OPEN) {
        if (joined) {
          return; // už jsem v místnosti – druhý join by server odmítl
        }
        sendJoin(); // otevřený socket, join ještě neuspěl → opakuj (nick-taken/error)
        return;
      }
      if (socket !== null && socket.readyState === 0 /* CONNECTING */) {
        return; // socket se otevírá – join se pošle na `open` s aktuálním pendingNick
      }
      openSocket(); // žádný / zavřený socket → čerstvé spojení, join na `open`
    },
    dispose(): void {
      disposed = true;
      teardownSocket();
    },
  };
}

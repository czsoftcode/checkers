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
 * Příchozí výzva (drátový tvar `challenged.challenge` ze serveru). `challengerNick`
 * je jmenovka vyzyvatele, `challengerId` jeho session id, `id` je id výzvy (na něj
 * míří `accept`/`reject` i `challenge-cancelled`).
 */
export interface IncomingChallenge {
  readonly id: string;
  readonly challengerId: string;
  readonly challengerNick: string;
}

/**
 * Moje odchozí výzva. Server NEposílá vyzyvateli id jeho výzvy, proto tu id není –
 * klient drží jen cíl (`targetId` + `targetNick`) a smí mít NEJVÝŠ JEDNU odchozí
 * naráz. Díky tomu jde jednoznačně vyčistit i `challenge-cancelled`, které nese jen
 * (pro vyzyvatele neznámé) id výzvy.
 */
export interface OutgoingChallenge {
  readonly targetId: string;
  readonly targetNick: string;
}

/** Data pro přechod do hry po přijetí výzvy (barvu i gameId má klient z `challenge-accepted`). */
export interface ChallengeAcceptedInfo {
  readonly gameId: string;
  readonly color: 'black' | 'white';
  /** Session id soupeře – potřebné pro odvetu (nová výzva témuž hráči po konci partie, fáze 77). */
  readonly opponentId: string;
  readonly opponentNick: string;
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
  /** Celý seznam příchozích výzev po každé změně (přibyla/zmizela). Vzor `onRoster`. */
  readonly onIncomingChallenges?: (challenges: IncomingChallenge[]) => void;
  /** Stav mé odchozí výzvy: čekající cíl, nebo `null` (žádná / právě vyřízená). */
  readonly onOutgoingChallenge?: (pending: OutgoingChallenge | null) => void;
  /** Výzva přijata (mnou i soupeřem) → přejdi do hry se svým gameId a barvou. */
  readonly onChallengeAccepted?: (info: ChallengeAcceptedInfo) => void;
  /**
   * Neutrální provozní hláška k výzvám (soupeř odmítl / odešel). NENÍ to `onError`
   * (ten v UI vrací do formuláře) – jen informace, kterou UI krátce ukáže.
   */
  readonly onNotice?: (message: string) => void;
  /**
   * Soupeř v partii `gameId` nabídl remízu (fáze 77). UI hry na to ukáže výzvu
   * přijmout/odmítnout. Nese `gameId`, ať se dá ověřit, že jde o partii, kterou
   * hráč právě hraje (jiné se ignorují – ochrana proti zbloudilému signálu).
   */
  readonly onDrawOffered?: (gameId: string) => void;
  /**
   * Soupeř odmítl MOU nabídku remízy v partii `gameId` (fáze 77). UI hry to krátce
   * oznámí; partie běží dál.
   */
  readonly onDrawRejected?: (gameId: string) => void;
  /**
   * Soupeř po dohrané partii `gameId` nabídl ODVETU (fáze 77). UI hry ukáže dotaz
   * přijmout/odmítnout. Přijetí spustí novou partii přes `onChallengeAccepted`.
   */
  readonly onRematchOffered?: (gameId: string) => void;
  /**
   * Soupeř MOU nabídku odvety v partii `gameId` odmítl (fáze 77). UI hry to oznámí a
   * vrátí nabízejícího na výsledek.
   */
  readonly onRematchDeclined?: (gameId: string) => void;
  /**
   * Soupeř dal „Konec" – partie `gameId` skončila pro oba (fáze 77). UI hry se má taky
   * přesunout do místnosti.
   */
  readonly onGameClosed?: (gameId: string) => void;
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
  /**
   * Vyzve hráče `targetId` na partii (`{type:'challenge', targetId}`). No-op, když
   * ještě nejsi v místnosti nebo už máš odchozí výzvu (drží se NEJVÝŠ jedna – viz
   * {@link OutgoingChallenge}). Na úspěch ohlásí `onOutgoingChallenge`.
   */
  challenge(targetId: string): void;
  /** Přijme příchozí výzvu `challengeId` (`{type:'accept', challengeId}`). Neznámou ignoruje. */
  accept(challengeId: string): void;
  /**
   * Odmítne příchozí výzvu `challengeId` (`{type:'reject', challengeId}`) a rovnou ji
   * z lokálního seznamu odebere (server vyzvanému na jeho odmítnutí nic neposílá).
   */
  reject(challengeId: string): void;
  /**
   * Pošle PvP tah partie `gameId` po ROOM WS (`{type:'move', gameId, from, path}`).
   * Zápisová cesta PvP jde tudy VĚDOMĚ (fáze 70): partie je na serveru navázaná na
   * session id tohoto spojení, takže tah musí odejít po témže socketu. `path` jsou
   * VŠECHNA dopadová pole tahu (u vícenásobného skoku každý meziskok), `captures`
   * server neposíláme – odvodí si je sám (autorita). No-op mimo otevřené spojení /
   * před joinem; server je stejně autorita a chybný/neúčastnický tah odmítne (`error`).
   *
   * Vrací `true`, když tah SKUTEČNĚ odešel po drátě, a `false`, když se zahodil
   * (zavřený socket / před joinem / po dispose). Volající (deska) podle toho pozná,
   * že tah neodešel, a nezamkne se do čekání na stav, který nikdy nedorazí.
   */
  move(gameId: string, from: number, path: readonly number[]): boolean;
  /**
   * Vzdá partii `gameId` po ROOM WS (`{type:'resign', gameId}`) – vyhrává soupeř
   * (fáze 77). Stejná cesta jako {@link move}: server bere identitu z tohoto
   * spojení. Vrací `true`, když příkaz odešel; `false` mimo otevřené spojení /
   * před joinem / po dispose. Server je autorita a neúčastníka/skončenou partii odmítne.
   */
  resign(gameId: string): boolean;
  /** Nabídne remízu soupeři v partii `gameId` (`{type:'draw-offer', gameId}`). Vrací, zda odešlo. */
  offerDraw(gameId: string): boolean;
  /** Přijme soupeřovu nabídku remízy v partii `gameId` (`{type:'draw-accept', gameId}`). Vrací, zda odešlo. */
  acceptDraw(gameId: string): boolean;
  /** Odmítne soupeřovu nabídku remízy v partii `gameId` (`{type:'draw-reject', gameId}`). Vrací, zda odešlo. */
  rejectDraw(gameId: string): boolean;
  /**
   * Opustí DOHRANOU partii `gameId` (`{type:'leave-game', gameId}`) – uvolní oba hráče
   * z busy stavu na serveru, ať můžou hrát dál (fáze 77, „Konec"/„Odveta"). Vrací, zda
   * odešlo. Server uvolní jen terminální partii (autorita).
   */
  leaveGame(gameId: string): boolean;
  /** Nabídne soupeři ODVETU po dohrané partii `gameId` (`{type:'rematch-offer', gameId}`). Vrací, zda odešlo. */
  offerRematch(gameId: string): boolean;
  /** Přijme soupeřovu nabídku odvety (`{type:'rematch-accept', gameId}`). Vrací, zda odešlo. */
  acceptRematch(gameId: string): boolean;
  /** Odmítne soupeřovu nabídku odvety (`{type:'rematch-decline', gameId}`). Vrací, zda odešlo. */
  declineRematch(gameId: string): boolean;
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

/** Runtime guard tvaru příchozí výzvy (`challenged.challenge`); vadnou zprávu odmítni. */
function isIncomingChallenge(value: unknown): value is IncomingChallenge {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.challengerId === 'string' &&
    typeof record.challengerNick === 'string'
  );
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
  // Příchozí výzvy podle `challengeId` (může jich čekat víc naráz – B i C mě vyzvou,
  // busy se na serveru nastaví až přijetím). Mažou se na accept/reject/cancelled.
  const incoming = new Map<string, IncomingChallenge>();
  // Moje JEDINÁ odchozí výzva (nebo `null`). Max-1 dovolí spárovat i `challenge-cancelled`,
  // které vyzyvateli nese jen (jemu neznámé) id výzvy – viz {@link OutgoingChallenge}.
  let outgoing: OutgoingChallenge | null = null;
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
    // Stav výzev z předchozího (padlého) spojení je neplatný – session id umřelo.
    incoming.clear();
    outgoing = null;
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

  /**
   * Pošle jednoduchý herní příkaz `{type, gameId}` po room WS (vzdání/remíza,
   * fáze 77). Stejný guard jako {@link RoomClient.move}: jen zapsaný hráč otevřeným
   * spojením. Vrací `true`, když příkaz odešel, `false` když se zahodil (zavřený
   * socket / před joinem / po dispose) – volající (UI hry) tím pozná, že se nic
   * nestalo. Server je stejně autorita a chybný příkaz odmítne (`error`).
   */
  function sendGameCommand(
    type:
      | 'resign'
      | 'draw-offer'
      | 'draw-accept'
      | 'draw-reject'
      | 'leave-game'
      | 'rematch-offer'
      | 'rematch-accept'
      | 'rematch-decline',
    gameId: string,
  ): boolean {
    if (disposed || !joined) {
      return false;
    }
    if (socket?.readyState !== WS_OPEN) {
      return false;
    }
    socket.send(JSON.stringify({ type, gameId }));
    return true;
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
        // Server multiplexuje i CHYBY VÝZEV přes `error` (busy, dvojitá/křížová,
        // „výzva už neplatí") a na úspěšnou výzvu vyzyvateli NIC neposílá. Proto na
        // jakoukoli chybu uvolni optimisticky nastavenou odchozí výzvu – jinak by
        // odmítnutá výzva `outgoing` zamkla a max-1 by zablokoval všechny další.
        // (Nekorelovatelné s konkrétní operací – stejný kompromis jako challenge-cancelled.)
        if (outgoing !== null) {
          outgoing = null;
          handlers.onOutgoingChallenge?.(null);
        }
        handlers.onError?.(msg.message);
        return;
      }
      case 'challenged': {
        // Příchozí výzva (jen vyzvanému). Vadný tvar zahoď, ať neproteče undefined.
        if (!isIncomingChallenge(msg.challenge)) {
          return;
        }
        incoming.set(msg.challenge.id, msg.challenge);
        handlers.onIncomingChallenges?.([...incoming.values()]);
        return;
      }
      case 'challenge-accepted': {
        // Přijetí (mnou i soupeřem) → přechod do hry. Ověř tvar PŘED přístupem k polím.
        if (typeof msg.gameId !== 'string') {
          return;
        }
        if (msg.color !== 'black' && msg.color !== 'white') {
          return;
        }
        if (typeof msg.opponentId !== 'string') {
          return;
        }
        // `opponentId` je session id, ne jmenovka – nick dohledej z rosteru (fallback).
        const opponentNick = players.get(msg.opponentId)?.nick ?? 'soupeř';
        // Odcházím z místnosti do hry → veškerý stav výzev je passé. Ostatní MÉ výzvy
        // server zrušil, ale cancelled poslal protějškům, ne mně → musím vyčistit sám.
        incoming.clear();
        outgoing = null;
        handlers.onIncomingChallenges?.([]);
        handlers.onOutgoingChallenge?.(null);
        handlers.onChallengeAccepted?.({
          gameId: msg.gameId,
          color: msg.color,
          opponentId: msg.opponentId,
          opponentNick,
        });
        return;
      }
      case 'challenge-rejected': {
        // Můj protějšek odmítl. Nese `challengedId` (cíl) – s max-1 odchozí jednoznačné.
        if (typeof msg.challengedId !== 'string') {
          return;
        }
        if (outgoing !== null && outgoing.targetId === msg.challengedId) {
          const nick = outgoing.targetNick;
          outgoing = null;
          handlers.onOutgoingChallenge?.(null);
          handlers.onNotice?.(`${nick} výzvu odmítl.`);
        }
        return;
      }
      case 'challenge-cancelled': {
        // Zaniklá výzva. Nese jen `challengeId`. Když ho znám z příchozích (jsem vyzvaný
        // vedlejší výzvy) → odeber ji. Jinak to je MOJE odchozí (soupeř odešel): id
        // neznám, ale díky max-1 odchozí ji můžu bezpečně zrušit.
        if (typeof msg.challengeId !== 'string') {
          return;
        }
        if (incoming.has(msg.challengeId)) {
          incoming.delete(msg.challengeId);
          handlers.onIncomingChallenges?.([...incoming.values()]);
          return;
        }
        if (outgoing !== null) {
          const nick = outgoing.targetNick;
          outgoing = null;
          handlers.onOutgoingChallenge?.(null);
          handlers.onNotice?.(`${nick} odešel z místnosti, výzva zanikla.`);
        }
        return;
      }
      case 'draw-offered': {
        // Soupeř nabídl remízu (fáze 77). Nese `gameId` – ověř tvar PŘED předáním.
        // Kterou partii se signál týká, rozhoduje UI hry (jinou než rozehranou ignoruje).
        if (typeof msg.gameId !== 'string') {
          return;
        }
        handlers.onDrawOffered?.(msg.gameId);
        return;
      }
      case 'draw-rejected': {
        if (typeof msg.gameId !== 'string') {
          return;
        }
        handlers.onDrawRejected?.(msg.gameId);
        return;
      }
      case 'rematch-offered': {
        if (typeof msg.gameId !== 'string') {
          return;
        }
        handlers.onRematchOffered?.(msg.gameId);
        return;
      }
      case 'rematch-declined': {
        if (typeof msg.gameId !== 'string') {
          return;
        }
        handlers.onRematchDeclined?.(msg.gameId);
        return;
      }
      case 'game-closed': {
        if (typeof msg.gameId !== 'string') {
          return;
        }
        handlers.onGameClosed?.(msg.gameId);
        return;
      }
      default:
        return; // neznámý typ – ignoruj
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
    challenge(targetId: string): void {
      // Vyzývat smí jen zapsaný hráč otevřeným socketem a jen když nemá odchozí výzvu.
      if (disposed || !joined || outgoing !== null) {
        return;
      }
      if (socket?.readyState !== WS_OPEN) {
        return;
      }
      // UI nabízí jen přezdívky z rosteru → cíl tam obvykle je; fallback pro jistotu.
      const targetNick = players.get(targetId)?.nick ?? 'soupeř';
      socket.send(JSON.stringify({ type: 'challenge', targetId }));
      outgoing = { targetId, targetNick };
      handlers.onOutgoingChallenge?.(outgoing);
    },
    accept(challengeId: string): void {
      if (disposed || !joined) {
        return;
      }
      if (socket?.readyState !== WS_OPEN) {
        return;
      }
      if (!incoming.has(challengeId)) {
        return; // neznámá / už zaniklá výzva – neposílej
      }
      // Neodstraňuj lokálně: úspěch přijde jako `challenge-accepted` (vyčistí vše),
      // zánik jako `challenge-cancelled`/`error`. Optimistické mazání by mohlo lhát.
      socket.send(JSON.stringify({ type: 'accept', challengeId }));
    },
    reject(challengeId: string): void {
      if (disposed || !joined) {
        return;
      }
      if (socket?.readyState !== WS_OPEN) {
        return;
      }
      if (!incoming.has(challengeId)) {
        return;
      }
      // Na odmítnutí server vyzvanému NIC neposílá → odeber lokálně hned.
      socket.send(JSON.stringify({ type: 'reject', challengeId }));
      incoming.delete(challengeId);
      handlers.onIncomingChallenges?.([...incoming.values()]);
    },
    move(gameId: string, from: number, path: readonly number[]): boolean {
      // Táhnout smí jen zapsaný hráč otevřeným socketem (v partii jsem, protože jsem
      // se do místnosti připojil a spároval – `joined` drží po celou hru). Kopie
      // `path` (ne readonly odkaz), ať se serializuje pole hodnot, ne živý odkaz.
      if (disposed || !joined) {
        return false;
      }
      if (socket?.readyState !== WS_OPEN) {
        return false; // spojení pryč → tah NEodešel; volající se nezamkne
      }
      socket.send(JSON.stringify({ type: 'move', gameId, from, path: [...path] }));
      return true;
    },
    resign(gameId: string): boolean {
      return sendGameCommand('resign', gameId);
    },
    offerDraw(gameId: string): boolean {
      return sendGameCommand('draw-offer', gameId);
    },
    acceptDraw(gameId: string): boolean {
      return sendGameCommand('draw-accept', gameId);
    },
    rejectDraw(gameId: string): boolean {
      return sendGameCommand('draw-reject', gameId);
    },
    leaveGame(gameId: string): boolean {
      return sendGameCommand('leave-game', gameId);
    },
    offerRematch(gameId: string): boolean {
      return sendGameCommand('rematch-offer', gameId);
    },
    acceptRematch(gameId: string): boolean {
      return sendGameCommand('rematch-accept', gameId);
    },
    declineRematch(gameId: string): boolean {
      return sendGameCommand('rematch-decline', gameId);
    },
    dispose(): void {
      disposed = true;
      teardownSocket();
    },
  };
}

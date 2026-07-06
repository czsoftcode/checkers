/**
 * Tenký typovaný klient k autoritativnímu serveru partie. Je to JEDINÁ vrstva,
 * která v prohlížeči mluví přes síť; zbytek klienta pracuje jen s vráceným
 * `GameDto`. Server je jediný zdroj pravdy – klient sám o legalitě nerozhoduje.
 *
 * Volá relativní cesty (`/games…`); v dev režimu je na server přeposílá Vite
 * proxy (viz `vite.config.ts`), takže tu není žádná URL serveru natvrdo.
 *
 * `Position` a `GameResult` se přebírají z `@checkers/rules` (skutečně sdílený
 * tvar, jeden zdroj). `MoveDto`, `EngineStatus` a obálka odpovědi jsou drátový
 * kontrakt serveru; jejich shodu s reálným serverem hlídá ruční e2e a serverové
 * `dto.test.ts` (web na balíček server nezávisí, aby se nesvázal build graf).
 */

import type { GameResult, Position, Square } from '@checkers/rules';

/** Stav tahu enginu na pozadí (kontrakt se serverem). */
export type EngineStatus = 'idle' | 'thinking' | 'error';

/**
 * JEDINÝ web-side seznam úrovní obtížnosti. Hodnoty MUSÍ sedět na server
 * (`levels.ts`, zod enum) – web na balíček server nezávisí (nesváže build graf),
 * takže je to ručně držená kopie kontraktu, stejně jako `GameDto` níž. Neznámou
 * hodnotu server odmítne (400). Odsud se odvozuje typ `GameLevel`, runtime guard
 * v `isGameDto` i výběr úrovně v UI – přidání úrovně = jediná změna tady (plus
 * její český popisek v `app-shell.ts`). POZOR: pořadí tu není jen kosmetika –
 * `app-shell.ts` z něj plní `<select>` a PRVNÍ prvek je výchozí soupeř nové hry.
 * `professional` proto musí zůstat první, ať UI default sedí na serverový
 * `DEFAULT_LEVEL` (jinak by se automatická úvodní partie a serverový default
 * tiše rozešly).
 */
export const GAME_LEVELS = ['professional', 'championship', 'intermediate', 'beginner', 'education'] as const;

/** Úroveň obtížnosti posílaná do POST /games. Odvozeno z `GAME_LEVELS`. */
export type GameLevel = (typeof GAME_LEVELS)[number];

/** Tah v drátovém tvaru (čísla polí 1–32). Klient ho zatím nečte, ale je součástí kontraktu. */
export interface MoveDto {
  readonly from: number;
  readonly path: number[];
  readonly captures: number[];
}

/** Stav partie ze serveru – odpověď POST /games, GET /games/:id i POST /moves. */
export interface GameDto {
  readonly id: string;
  readonly position: Position;
  readonly result: GameResult;
  readonly legalMoves: MoveDto[];
  readonly engineStatus: EngineStatus;
  /** Úroveň, proti které se partie HRAJE (autorita = server, ne přepínač v UI). */
  readonly level: GameLevel;
  /**
   * Tři vynucené půltahy vylosovaného zahájení (3-move ballot), nebo `null` když
   * partie žádné vynucené zahájení nemá. Nenulové je jen u Mistrovství. Klient je
   * na startu jednou vizuálně přehraje (animace ballotu) a jinak se jich nedotkne
   * – zdroj pravdy o tazích i výsledné pozici je server.
   */
  readonly ballotMoves: MoveDto[] | null;
}

/**
 * Výsledek nabídky remízy. `accepted` = zda engine remízu přijal; `game` je
 * stav partie PO rozhodnutí (při přijetí `result: 'draw'`, při odmítnutí
 * nezměněný). Jiný tvar než holé `GameDto` – nabídka nese i verdikt.
 */
export interface DrawOffer {
  readonly accepted: boolean;
  readonly game: GameDto;
}

/** Klient serveru. Injektuje se do controlleru, ať jde otestovat bez sítě. */
export interface ServerClient {
  /** Založí novou partii proti enginu na zvolené úrovni obtížnosti. */
  createGame(level: GameLevel): Promise<GameDto>;
  getGame(id: string): Promise<GameDto>;
  postMove(id: string, from: Square, path: readonly Square[]): Promise<GameDto>;
  /** Vzdání partie (člověk = černý → vyhrává bílý). Vrací stav se skončenou partií. */
  resign(id: string): Promise<GameDto>;
  /**
   * Nabídne enginu remízu; engine rozhodne. Vrací verdikt + stav partie. Chybové
   * stavy (bez enginu, engine přemýšlí, engine selhal) přijdou jako `ServerError`
   * se strojovým `code` – volající je odliší od přijetí/odmítnutí.
   */
  offerDraw(id: string): Promise<DrawOffer>;
  /**
   * Vyžádá si od enginu doporučený tah pro aktuální pozici (režim Výuka). Vrací
   * jen tah (`MoveDto`), stav partie NEMĚNÍ – server jen radí. Selhání (bez enginu,
   * není tah člověka, konec hry, timeout/pád enginu, síť) přijde jako `ServerError`
   * se strojovým `code`; volající pak nápovědu prostě neukáže a nezasekne se.
   *
   * VOLITELNÁ schopnost: controller ji volá JEN ve Výuce (`level==='education'`),
   * jinak se jí nedotkne. Optional proto, aby ji nemusel stubovat každý klient,
   * který nápovědu nepoužívá (testovací fakey ostatních režimů). Reálný HTTP klient
   * (`createHttpClient`) ji vždy implementuje – hlídá to `server-client.test`.
   *
   * Deklarovaná jako pole s arrow-typem (ne metoda): controller si ji smí uložit
   * do lokální proměnné (kvůli zúžení optional) bez `unbound-method` varování –
   * `this` stejně nepoužívá (je to closure nad `fetch`).
   */
  getHint?: (id: string) => Promise<MoveDto>;
}

/**
 * Chyba ze serveru. `status` je HTTP kód (0 = síťová chyba, spojení vůbec
 * nedoběhlo), `code` je strojový kód z obálky serveru (`illegal_move`, …), když
 * ho odpověď nesla. Volající tak selhání rozezná – nikdy nedostane tichý
 * `undefined` místo stavu.
 */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

/**
 * HTTP implementace klienta nad `fetch`. `fetchImpl` lze injektovat (testy),
 * jinak se bere globální `fetch` prohlížeče.
 */
export function createHttpClient(fetchImpl: typeof fetch = fetch): ServerClient {
  /** Fetch + jednotné ošetření síťové chyby a ne-2xx odpovědi. Vrací syrovou Response. */
  async function send(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Response> {
    // Init se skládá podmíněně: s exactOptionalPropertyTypes nesmí headers/body
    // dostat undefined, takže se u GET (bez těla) vůbec nenastaví.
    const init: RequestInit =
      body === undefined
        ? { method }
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };

    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (cause) {
      // Spojení vůbec nedoběhlo (server neběží, výpadek sítě). Nezaměňovat s 4xx/5xx
      // odpovědí – ta má status. Přebalíme na ServerError(0), ať to volající pozná.
      throw new ServerError(0, undefined, `Síťová chyba při ${method} ${url}: ${describe(cause)}`);
    }

    if (!response.ok) {
      const code = await readErrorCode(response);
      throw new ServerError(
        response.status,
        code,
        `Server odpověděl ${String(response.status)} na ${method} ${url}`,
      );
    }
    return response;
  }

  /** Pošle požadavek a odpověď přečte jako `GameDto`. */
  async function request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<GameDto> {
    return parseGameDto(await send(method, url, body), method, url);
  }

  return {
    createGame: (level) => request('POST', '/games', { level }),
    getGame: (id) => request('GET', `/games/${encodeURIComponent(id)}`),
    postMove: (id, from, path) =>
      request('POST', `/games/${encodeURIComponent(id)}/moves`, { from, path: [...path] }),
    resign: (id) => request('POST', `/games/${encodeURIComponent(id)}/resign`),
    offerDraw: async (id) => {
      const url = `/games/${encodeURIComponent(id)}/offer-draw`;
      return parseDrawOffer(await send('POST', url, undefined), url);
    },
    getHint: async (id) => {
      const url = `/games/${encodeURIComponent(id)}/hint`;
      return parseHint(await send('GET', url), url);
    },
  };
}

/**
 * Přečte a ověří odpověď nabídky remízy `{ accepted, game }`. `game` prochází
 * stejným guardem tvaru jako `GameDto` (jinak by rozbitá odpověď tiše nastavila
 * desku na undefined); `accepted` musí být boolean. Selhání → `ServerError`,
 * který volající pozná.
 */
async function parseDrawOffer(response: Response, url: string): Promise<DrawOffer> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ServerError(response.status, undefined, `Odpověď POST ${url} nešla přečíst jako JSON: ${describe(cause)}`);
  }
  if (typeof body !== 'object' || body === null) {
    throw new ServerError(response.status, undefined, `Odpověď POST ${url} nemá očekávaný tvar nabídky remízy`);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.accepted !== 'boolean' || !isGameDto(record.game)) {
    throw new ServerError(response.status, undefined, `Odpověď POST ${url} nemá očekávaný tvar nabídky remízy`);
  }
  return { accepted: record.accepted, game: record.game };
}

/**
 * Přečte a ověří odpověď nápovědy `{ move: MoveDto }`. Tvar `move` se prověří
 * (jinak by rozbitá odpověď protekla jako „nápověda" a zvýraznila nesmysl na
 * desce). Selhání parsování → `ServerError`, který volající pozná a nápovědu
 * neukáže. Vrací jen samotný tah.
 */
async function parseHint(response: Response, url: string): Promise<MoveDto> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ServerError(response.status, undefined, `Odpověď GET ${url} nešla přečíst jako JSON: ${describe(cause)}`);
  }
  if (typeof body !== 'object' || body === null || !isMoveDto((body as Record<string, unknown>).move)) {
    throw new ServerError(response.status, undefined, `Odpověď GET ${url} nemá očekávaný tvar nápovědy { move }`);
  }
  return (body as { move: MoveDto }).move;
}

/**
 * Lehký runtime guard tvaru `MoveDto`: `from` číslo, `path` a `captures` pole
 * čísel. Nekontroluje rozsah 1–32 (to je věc serveru/pravidel), jen tvar, ať se
 * do vykreslení nedostane `undefined`/cizí struktura.
 */
function isMoveDto(value: unknown): value is MoveDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.from === 'number' &&
    Array.isArray(record.path) &&
    record.path.every((n) => typeof n === 'number') &&
    Array.isArray(record.captures) &&
    record.captures.every((n) => typeof n === 'number')
  );
}

/**
 * Přečte a ověří úspěšnou odpověď. Klient serveru DŮVĚŘUJE jen potud, že tvar
 * ověří: server (nebo špatně nakonfigurovaná proxy) může na 200 vrátit ne-JSON
 * (např. `index.html`) nebo JSON jiného tvaru. Bez téhle kontroly by se `position`
 * tiše nastavila na `undefined` a `render()` by spadl na TypeError → deska by
 * zůstala natrvalo rozbitá. Místo toho se z obojího stane `ServerError`, který
 * volající pozná (controller ho odchytí a dorovná stav / nezasekne se).
 */
async function parseGameDto(response: Response, method: string, url: string): Promise<GameDto> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ServerError(
      response.status,
      undefined,
      `Odpověď ${method} ${url} nešla přečíst jako JSON: ${describe(cause)}`,
    );
  }
  if (!isGameDto(body)) {
    throw new ServerError(
      response.status,
      undefined,
      `Odpověď ${method} ${url} nemá očekávaný tvar GameDto`,
    );
  }
  return body;
}

/**
 * Lehký runtime guard tvaru `GameDto`. Ověřuje jen pole, na kterých klient staví
 * vykreslení a rozhodování (`position.board` + `turn`, `id`, `engineStatus`);
 * `result`/`legalMoves` se nezobrazují, takže se nekontrolují do hloubky. Cíl je
 * chytit drift kontraktu nebo cizí tělo dřív, než rozbije desku.
 */
function isGameDto(value: unknown): value is GameDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') {
    return false;
  }
  if (
    record.engineStatus !== 'idle' &&
    record.engineStatus !== 'thinking' &&
    record.engineStatus !== 'error'
  ) {
    return false;
  }
  if (
    typeof record.level !== 'string' ||
    !(GAME_LEVELS as readonly string[]).includes(record.level)
  ) {
    return false;
  }
  // `ballotMoves`: buď `null` (partie bez zahájení), nebo pole tahů drátového
  // tvaru. Klient z něj skládá animaci ballotu, takže se ověřuje do hloubky
  // (jinak by rozbité pole spadlo až v `applyMove`). `undefined` (starý/rozbitý
  // server bez pole) je taky drift → odmítni, ať se nezobrazí nesmysl.
  if (
    record.ballotMoves !== null &&
    !(Array.isArray(record.ballotMoves) && record.ballotMoves.every(isMoveDto))
  ) {
    return false;
  }
  const position = record.position;
  if (typeof position !== 'object' || position === null) {
    return false;
  }
  const pos = position as Record<string, unknown>;
  return Array.isArray(pos.board) && (pos.turn === 'black' || pos.turn === 'white');
}

/**
 * Vytáhne strojový kód chyby z obálky `{ error: { code } }`. Selhání parsování
 * (tělo není JSON / má jiný tvar) není fatální – vrátí `undefined`, status z
 * odpovědi stačí. Nikdy nevyhazuje, aby nepřebilo původní chybu z odpovědi.
 */
async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'object' &&
      body.error !== null &&
      'code' in body.error &&
      typeof body.error.code === 'string'
    ) {
      return body.error.code;
    }
  } catch {
    // tělo nešlo přečíst jako JSON – kód neznáme, jen status
  }
  return undefined;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

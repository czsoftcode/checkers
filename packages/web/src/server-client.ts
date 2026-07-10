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

import type { Color, GameResult, Position, Square } from '@checkers/rules';
import type { GameLevel } from '@checkers/ai';

/** Stav tahu enginu na pozadí (kontrakt se serverem). */
export type EngineStatus = 'idle' | 'thinking' | 'error';

/**
 * Důvod konce partie z pohledu klienta (fáze 78) – ručně držená kopie serverového
 * `EndReason` (`store.ts`). `'resign'` = soupeř se vzdal, `'draw-agreement'` =
 * dohodnutá remíza, `'rules'` = konec podle pravidel. Server ho posílá jen u PvP
 * stavu (`PvpGameDto.reason`) a jen u terminálního výsledku; jinak `null`.
 */
export const END_REASONS = ['resign', 'draw-agreement', 'rules'] as const;
export type EndReason = (typeof END_REASONS)[number];

/**
 * Web-side seznam úrovní obtížnosti v UI POŘADÍ. Množina hodnot je táž jako
 * `@checkers/ai` `LEVELS` (jediný zdroj pravdy o úrovních), ale POŘADÍ je tu
 * lokální a ZÁMĚRNĚ jiné: `@checkers/ai` řadí championship-first, web
 * professional-first. POZOR: pořadí tu není kosmetika – `app-shell.ts` z něj plní
 * `<select>` a PRVNÍ prvek je výchozí soupeř nové hry, takže `professional` musí
 * zůstat první, ať UI default sedí na `DEFAULT_LEVEL` (jinak by se automatická
 * úvodní partie a default tiše rozešly).
 *
 * Zub proti driftu je DVOJÍ: `satisfies readonly GameLevel[]` (compile-time)
 * odmítne úroveň, kterou `@checkers/ai` nezná; permutační test
 * (`server-client-levels.test.ts`) hlídá, že jde o STEJNOU MNOŽINU (chytí i
 * úroveň chybějící tady). Přidání/odebrání úrovně na jedné straně tak shodí buď
 * typecheck, nebo test – ne tiše.
 */
export const GAME_LEVELS = [
  'professional',
  'championship',
  'intermediate',
  'beginner',
  'education',
] as const satisfies readonly GameLevel[];

/** Úroveň obtížnosti posílaná do POST /games. Sdílený typ z `@checkers/ai`. */
export type { GameLevel };

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
  /**
   * Barva, kterou v této partii hraje ČLOVĚK (engine hraje druhou). Server ji od
   * fáze 50 posílá; klient podle ní orientuje desku (člověk dole), rozhoduje čí
   * je tah a mapuje výsledek na „vyhrál/prohrál jsem". VOLITELNÉ na drátě: starý
   * server (nebo odpověď bez pole) = `undefined` → klient bere výchozí `'black'`
   * (dnešní chování, člověk černý). Přítomná neplatná hodnota (ne `black`/`white`)
   * je ale drift kontraktu → `isGameDto` ji odmítne, ať se do orientace nedostane
   * nesmysl.
   */
  readonly humanColor?: Color;
  /**
   * Index vylosovaného 3-move ballotu do serverového decku (`THREE_MOVE_BALLOTS`),
   * nebo `null` u partie bez vynuceného zahájení. Nenulový je jen u Mistrovství.
   * Klient ho v zápase (2 kola) přečte z 1. kola a pošle zpět do `createGame` 2. kola,
   * ať se přehraje STEJNÉ zahájení. VOLITELNÉ na drátě (aditivní pole): chybějící /
   * `undefined` bere volající jako „index neznám" (2. kolo se pak nerozjede). Přítomná
   * hodnota musí být nezáporné celé číslo; jiná = drift → `isGameDto` odmítne.
   */
  readonly ballotIndex?: number | null;
}

/**
 * Stav PvP partie v drátovém tvaru (fáze 66/70). Zrcadlí serverový `PvpGameDto`
 * (`packages/server/src/dto.ts`): žádný engine, žádná úroveň ani ballot – jen
 * pozice, výsledek a legální tahy. Diskriminátor `mode:'pvp'` odlišuje tento tvar
 * od engine `GameDto` uvnitř téže obálky `game-state`. Vlastní barvu hráče DTO
 * NEnese – klient ji zná z `challenge-accepted` (fáze 71), server-push ji nedovodí.
 * Web na balíček server nezávisí (nesváže build graf) → ručně držená kopie, shodu
 * hlídá serverový `dto.test.ts` + ruční e2e.
 */
export interface PvpGameDto {
  readonly mode: 'pvp';
  readonly id: string;
  readonly position: Position;
  readonly result: GameResult;
  readonly legalMoves: MoveDto[];
  /**
   * Důvod konce partie (fáze 78), nebo `null` dokud partie běží. VOLITELNÝ na
   * klientu schválně: kdyby dorazil starší/nekompletní stav bez `reason`, guard
   * ho nezahodí (deska nezamrzne) a text výsledku spadne na neutrální variantu
   * bez důvodu. Server ho u živého kontraktu posílá vždy (u PvP stavu).
   */
  readonly reason?: EndReason | null;
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
  /**
   * Založí novou partii proti enginu na zvolené úrovni obtížnosti a se zvolenou
   * barvou ČLOVĚKA (`humanColor`; engine hraje druhou). Server je autorita: barvu
   * uloží u partie a u člověk=bílý sám spustí první tah enginu (černého). Server
   * má i default (`black`), ale klient barvu posílá vždy explicitně, ať se z volby
   * nestane tiché „co server zrovna dosadí".
   *
   * `ballotIndex` (volitelný) nasadí KONKRÉTNÍ vylosované zahájení místo serverového
   * losu – používá ho 2. kolo Mistrovství, aby přehrálo stejný ballot jako 1. kolo.
   * Posílá se JEN když je zadán a jen u Mistrovství; server ho ověří (rozsah decku,
   * jen championship) a mimo to vrátí 400 (fáze 53). Bez něj = normální los.
   */
  createGame(level: GameLevel, humanColor: Color, ballotIndex?: number): Promise<GameDto>;
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
/**
 * Strop čekání na PASIVNÍ čtení (poll stavu, nápověda Výuky). Tyhle requesty jsou
 * zahoditelné (další tik je zopakuje) a hlavně na nich CONTROLLER ČEKÁ, než pustí
 * akční request (odeslání tahu / vzdání / remíza) – drain `while (busy) await inflight`.
 * Bez stropu by zaseknuté spojení na mobilu (rádio drop, žádná odpověď ani chyba)
 * drželo `fetch` viset až do prohlížečového timeoutu (desítky sekund) a s ním i ten
 * drain → deska zamčená. AbortController proto pasivní request po tomhle čase utne;
 * `fetch` vyhodí AbortError → `ServerError(0)` → volající ho spolkne a drain se pustí.
 * Akční requesty strop NEMAJÍ: nesmí se utnout rozehraný tah (nejednoznačné, zda
 * server stihl aplikovat); ty řeší běžná chybová cesta + resync.
 */
const PASSIVE_REQUEST_TIMEOUT_MS = 10_000;

export function createHttpClient(fetchImpl: typeof fetch = fetch): ServerClient {
  /**
   * Fetch + jednotné ošetření síťové chyby a ne-2xx odpovědi. Vrací syrovou Response.
   * `timeoutMs` (jen pasivní čtení) request po uplynutí utne přes AbortController –
   * viz {@link PASSIVE_REQUEST_TIMEOUT_MS}; abort spadne stejnou cestou jako síťová chyba.
   */
  async function send(method: 'GET' | 'POST', url: string, body?: unknown, timeoutMs?: number): Promise<Response> {
    // Init se skládá podmíněně: s exactOptionalPropertyTypes nesmí headers/body
    // dostat undefined, takže se u GET (bez těla) vůbec nenastaví.
    const init: RequestInit =
      body === undefined
        ? { method }
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };

    // Volitelný strop: po `timeoutMs` request přerušíme (abort → catch níž → ServerError(0)).
    const controller = timeoutMs === undefined ? null : new AbortController();
    const timer = controller === null ? null : setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    if (controller !== null) {
      init.signal = controller.signal;
    }

    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (cause) {
      // Spojení vůbec nedoběhlo (server neběží, výpadek sítě) NEBO jsme ho utnuli
      // timeoutem (AbortError). Nezaměňovat s 4xx/5xx odpovědí – ta má status.
      // Přebalíme na ServerError(0), ať to volající pozná (a drain se odblokuje).
      throw new ServerError(0, undefined, `Síťová chyba při ${method} ${url}: ${describe(cause)}`);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
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

  /** Pošle požadavek a odpověď přečte jako `GameDto`. `timeoutMs` jen pro pasivní čtení. */
  async function request(method: 'GET' | 'POST', url: string, body?: unknown, timeoutMs?: number): Promise<GameDto> {
    return parseGameDto(await send(method, url, body, timeoutMs), method, url);
  }

  return {
    createGame: (level, humanColor, ballotIndex) =>
      // `ballotIndex` do těla JEN když je zadán (2. kolo Mistrovství). Jinak ho
      // vynech úplně – ne poslat `undefined`: server má pole volitelné a chybějící
      // = normální los. Přítomné `undefined` by JSON.stringify stejně zahodil, ale
      // podmíněné rozšíření drží tělo čisté a záměr explicitní.
      request(
        'POST',
        '/games',
        ballotIndex === undefined ? { level, humanColor } : { level, humanColor, ballotIndex },
      ),
    getGame: (id) => request('GET', `/games/${encodeURIComponent(id)}`, undefined, PASSIVE_REQUEST_TIMEOUT_MS),
    postMove: (id, from, path) =>
      request('POST', `/games/${encodeURIComponent(id)}/moves`, { from, path: [...path] }),
    resign: (id) => request('POST', `/games/${encodeURIComponent(id)}/resign`),
    offerDraw: async (id) => {
      const url = `/games/${encodeURIComponent(id)}/offer-draw`;
      return parseDrawOffer(await send('POST', url, undefined), url);
    },
    getHint: async (id) => {
      const url = `/games/${encodeURIComponent(id)}/hint`;
      return parseHint(await send('GET', url, undefined, PASSIVE_REQUEST_TIMEOUT_MS), url);
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

/** Platná hodnota `GameResult` (kopie z `@checkers/rules`, jen pro runtime guard). */
function isGameResult(value: unknown): value is GameResult {
  return (
    value === 'ongoing' || value === 'black-wins' || value === 'white-wins' || value === 'draw'
  );
}

/**
 * Platná hodnota `EndReason` (fáze 78). Normalizace na hranici: cokoli jiného
 * (chybějící, `null`, neznámý řetězec ze staršího/rozbitého stavu) NENÍ důvod →
 * volající spadne na neutrální text výsledku, deska nezamrzne.
 */
export function isEndReason(value: unknown): value is EndReason {
  return value === 'resign' || value === 'draw-agreement' || value === 'rules';
}

/**
 * Runtime guard tvaru `PvpGameDto` (drátový PvP stav v obálce `game-state`).
 * Ověří diskriminátor `mode:'pvp'`, `id`, `position` (board + turn), `result` a
 * `legalMoves` do hloubky – rozbité/cizí pole se má zachytit tady, ne až při
 * vykreslení desky. Engine `GameDto` (jiný `mode`) tímto guardem NEprojde.
 */
export function isPvpGameDto(value: unknown): value is PvpGameDto {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.mode !== 'pvp' || typeof record.id !== 'string') {
    return false;
  }
  if (!isGameResult(record.result)) {
    return false;
  }
  if (!Array.isArray(record.legalMoves) || !record.legalMoves.every(isMoveDto)) {
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
export function isGameDto(value: unknown): value is GameDto {
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
  // `humanColor`: VOLITELNÉ (aditivní pole, zpětná kompatibilita). Chybějící /
  // `undefined` je v pořádku – volající si dosadí výchozí `'black'`. Ale když
  // pole PŘIJDE, musí být platná barva; jiná hodnota je drift → odmítni, ať se
  // do orientace desky nedostane nesmysl (obrácená deska / špatné mapování výhry).
  if (
    record.humanColor !== undefined &&
    record.humanColor !== 'black' &&
    record.humanColor !== 'white'
  ) {
    return false;
  }
  // `ballotIndex`: VOLITELNÉ (aditivní pole). Chybějící / `undefined` = starý server
  // bez pole → volající si dosadí „neznám". `null` = partie bez zahájení (ne-Mistrovství).
  // Když PŘIJDE číslo, musí být nezáporné celé (index do serverového decku); jiná
  // hodnota (řetězec, zlomek, záporné) je drift → odmítni, ať se do 2. kola nepošle
  // nesmysl (server by ho stejně 400, ale drift chytneme dřív a hlasitě).
  if (
    record.ballotIndex !== undefined &&
    record.ballotIndex !== null &&
    (typeof record.ballotIndex !== 'number' ||
      !Number.isInteger(record.ballotIndex) ||
      record.ballotIndex < 0)
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

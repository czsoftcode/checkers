/**
 * Prohlížečový `LocalClient` (fáze 87) – implementuje TÝŽ `ServerClient` jako
 * dnešní HTTP klient, ale hru proti AI odbaví CELOU v prohlížeči, bez běžícího
 * serveru. Je to browserový port serverové orchestrace partie (`store.ts` +
 * AI část `app.ts`) za stejným rozhraním: stejný životní cyklus (humanColor,
 * první tah enginu, model `thinking`→`idle`, konec s důvodem), stejný tvar
 * `GameDto`, stejný polling kontrakt (postMove vrátí stav hned, tah enginu dorazí
 * `getGame` pollem).
 *
 * Co se z prohlížeče NEpočítá jinak než na serveru:
 *  - PRAVIDLA (konec hry, legální tahy, důsledek tahu, ballot) jdou přes
 *    `@checkers/rules` – žádná vlastní pravidla se tu neopakují.
 *  - VÝBĚR TAHU AI jde přes `@checkers/ai` `computeAiMove` (jediný sdílený zdroj,
 *    fáze 86), ve Web Workeru (mimo hlavní vlákno) přes injektované `EngineWorker`.
 *
 * `LocalClient` reimplementuje JEN orchestraci: čí je tah, model `thinking`,
 * `endReason` (resign/draw-agreement/rules), los ballotu. `GameDto` zůstává ručně
 * drženým drátovým kontraktem (jako u HTTP klienta) – rules brání drift v pravidlech.
 *
 * NEZÁVISLÉ na serveru: web na balíček server nezávisí (nesváže build graf), takže
 * serverový `store.ts` se nesdílí – orchestrace je tu zopakovaná (menší, bez PvP,
 * bez archivace, bez podprocesu enginu).
 */

import {
  THREE_MOVE_BALLOTS,
  advanceState,
  gameResultFromState,
  initialGameState,
  legalMoves,
  playBallot,
} from '@checkers/rules';
import type { Color, GameResult, GameState, Move, Position, Square } from '@checkers/rules';
import { searchTimed } from '@checkers/engine';

import { ServerError } from './server-client.js';
import type {
  DrawOffer,
  GameDto,
  GameLevel,
  MoveDto,
  ServerClient,
} from './server-client.js';
import { DEFAULT_SEARCH_TIME_MS } from './local/compute-move.js';
import type { EngineWorker } from './local/engine-worker.js';

/**
 * Práh přijetí nabídky remízy – kopie serverového `DRAW_ACCEPT_MAX_ENGINE_SCORE`
 * (app.ts). Engine remízu přijme, právě když skóre pozice Z POHLEDU ENGINU není
 * kladné (≤ 0), tj. pozici nehodnotí jako svou výhru. Vědomá duplicita jednoho
 * čísla (web na server nezávisí); shodu hlídá stejné znaménkové chování v testu.
 */
export const DRAW_ACCEPT_MAX_ENGINE_SCORE = 0;

/**
 * Strojové kódy chyb, které `LocalClient` posílá v `ServerError` – KOPIE
 * podmnožiny serverových `ERROR_CODES` (errors.ts), na které controller reaguje.
 * Web na server nezávisí, takže je to ručně držená kopie kontraktu (jako `GameDto`).
 */
const CODES = {
  gameNotFound: 'game_not_found',
  gameOver: 'game_over',
  notYourTurn: 'not_your_turn',
  illegalMove: 'illegal_move',
  engineBusy: 'engine_busy',
  engineUnavailable: 'engine_unavailable',
  invalidRequest: 'invalid_request',
} as const;

/** Interní důvod VYNUCENÉHO konce (mimo pravidla): vzdání nebo dohodnutá remíza. */
type ForcedReason = 'resign' | 'draw-agreement';

/**
 * In-memory záznam partie. Mutuje se na místě (jako serverový store); `GameDto`
 * je vždy SNÍMEK (`advanceState` vrací nový stav, takže dřív vrácené DTO svou
 * pozici nezmění). `forcedResult`/`forcedReason` drží vynucený konec, který stav
 * pravidel NEmění (vzdání/remíza) – efektivní výsledek je `forcedResult ?? z pozice`.
 */
interface LocalGame {
  readonly id: string;
  state: GameState;
  readonly moves: Move[];
  readonly level: GameLevel;
  readonly humanColor: Color;
  readonly ballotIndex: number | null;
  engineStatus: 'idle' | 'thinking' | 'error';
  forcedResult: GameResult | null;
  forcedReason: ForcedReason | null;
  /**
   * Seed pro PRÁVĚ probíhající tah enginu. Losuje se jednou při spuštění tahu
   * (aby byl výběr reprodukovatelný a nezávisel na časování workeru) a předá se do
   * `EngineMoveRequest`. Null, když engine zrovna netáhne.
   */
  pendingSeed: number | null;
}

/** Volitelná injekce pro `LocalClient` (produkce nechá výchozí; test dosadí). */
export interface LocalClientOptions {
  /**
   * Zdroj náhody pro LOS ballotu (úroveň Mistrovství), hodnota v [0, 1). Výchozí
   * `Math.random`; test dosadí seedovaný `mulberry32`, aby byl los deterministický.
   */
  readonly rng?: () => number;
  /**
   * Generátor SEEDU pro výběr tahu enginu (rng tie-breaku a nepozornosti v
   * `computeAiMove`). Výchozí náhodný 32bit seed (obdoba serverového neseedovaného
   * rng); test dosadí pevný, aby byl tah reprodukovatelný a regresní test měl zuby.
   */
  readonly seed?: () => number;
  /** Měkký časový limit searche v ms (tah i nabídka remízy). Výchozí {@link DEFAULT_SEARCH_TIME_MS}. */
  readonly timeMs?: number;
  /**
   * Injektovatelné hodiny pro `searchTimed` NABÍDKY REMÍZY (běží na hlavním
   * vlákně, ne ve workeru). Jen test (determinismus znaménka skóre); produkce
   * nechá výchozí `performance.now`. Tah enginu má vlastní hodiny uvnitř workeru.
   */
  readonly now?: () => number;
}

/** Opačná barva. Barva enginu je vždy `opposite(humanColor)`. */
function opposite(color: Color): Color {
  return color === 'black' ? 'white' : 'black';
}

/**
 * ID lokální partie. Je to JEN klíč do in-memory mapy partií (žádná bezpečnostní
 * ani drátová role – server ho nevidí), takže nepotřebuje kryptografickou sílu.
 *
 * POZOR na secure context: `crypto.randomUUID` je v prohlížeči dostupné jen na
 * HTTPS nebo `localhost`/`127.0.0.1`. Přes prosté HTTP na LAN IP (typicky ruční
 * test na mobilu z dev serveru, nebo cizí hosting bez TLS) je `undefined` a přímé
 * volání by shodilo `createGame` (TypeError → „Partii se nepodařilo založit"),
 * takže by AI deska byla v insecure contextu nepoužitelná. `crypto.getRandomValues`
 * je dostupné I v insecure contextu → primární cesta; poslední záchrana
 * (`Date.now` + `Math.random`) kdyby chybělo i `crypto` úplně. Unikátnost v rámci
 * jedné stránky plně stačí (partie žijí jen v paměti tohoto klienta).
 */
function newGameId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  if (c !== undefined && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `game-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Přepis `Move` (rules) do drátového `MoveDto`. Kopie polí, ne readonly odkaz. */
function moveToDto(move: Move): MoveDto {
  return { from: move.from, path: [...move.path], captures: [...move.captures] };
}

/** Legální tahy pozice v drátovém tvaru. */
function legalMoveDtos(position: Position): MoveDto[] {
  return legalMoves(position).map(moveToDto);
}

/**
 * Najde legální tah odpovídající zadání (výchozí pole + cesta). Shoda = stejné
 * `from` a hluboká shoda CELÉHO `path` v pořadí (duplicity v path povoleny –
 * kruhový skok dámy), stejný kontrakt jako serverový `findLegalMove`.
 */
function findLegalMove(position: Position, from: number, path: readonly number[]): Move | undefined {
  return legalMoves(position).find((move) => move.from === from && pathsEqual(move.path, path));
}

function pathsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Sestaví partii pro dané zahájení. Mistrovství (`championship`) vylosuje/nasadí
 * třítahový ballot (bílý na tahu po něm), ostatní úrovně startují výchozím
 * rozestavěním (černý na tahu). `applyBallot` páruje půltahy proti reálným
 * `legalMoves` (na neshodě throwuje – hlasitá chyba, ne tichý falešný start) a
 * přehraje je přes `advanceState`, stejná cesta jako tah hráče/enginu.
 */
function seedInitial(
  level: GameLevel,
  ballotIndex: number | undefined,
  rng: () => number,
): { state: GameState; moves: Move[]; ballotIndex: number | null } {
  if (level !== 'championship') {
    return { state: initialGameState(), moves: [], ballotIndex: null };
  }
  const index = ballotIndex ?? Math.floor(rng() * THREE_MOVE_BALLOTS.length);
  const ballot = THREE_MOVE_BALLOTS[index];
  if (ballot === undefined) {
    // Programová chyba volajícího (rozbitý rng u losu, nebo neověřený index) – ne
    // klientský vstup. Hlasitě, nemaskovat na tichý fallback.
    throw new RangeError(
      `Ballot mimo rozsah: index ${String(index)} pro deck délky ${String(THREE_MOVE_BALLOTS.length)}`,
    );
  }
  const { moves } = playBallot(ballot);
  let state = initialGameState();
  for (const move of moves) {
    state = advanceState(state, move);
  }
  return { state, moves: [...moves], ballotIndex: index };
}

/**
 * Vytvoří `LocalClient`. `worker` (injektovaný `EngineWorker`) počítá tah AI mimo
 * hlavní vlákno; testy dosadí in-process fake. Stav partií žije v `Map` tohoto
 * klienta (jeden „server" v paměti prohlížeče, žádná perzistence).
 */
export function createLocalClient(worker: EngineWorker, options: LocalClientOptions = {}): ServerClient {
  const games = new Map<string, LocalGame>();
  const rng = options.rng ?? Math.random;
  const nextSeed = options.seed ?? (() => Math.floor(Math.random() * 0x1_0000_0000));
  const timeMs = options.timeMs ?? DEFAULT_SEARCH_TIME_MS;
  const now = options.now;

  /** Efektivní výsledek: vynucený (vzdání/remíza) > výsledek z pozice. */
  function effectiveResult(game: LocalGame): GameResult {
    return game.forcedResult ?? gameResultFromState(game.state);
  }

  /** Barva enginu v partii. */
  function engineColorOf(game: LocalGame): Color {
    return opposite(game.humanColor);
  }

  /** `GameDto` (drátový kontrakt) ze záznamu; `result` je EFEKTIVNÍ výsledek. */
  function toDto(game: LocalGame): GameDto {
    const ballotMoves = game.ballotIndex === null ? null : game.moves.slice(0, 3).map(moveToDto);
    return {
      id: game.id,
      position: game.state.position,
      result: effectiveResult(game),
      legalMoves: legalMoveDtos(game.state.position),
      engineStatus: game.engineStatus,
      level: game.level,
      ballotMoves,
      humanColor: game.humanColor,
      ballotIndex: game.ballotIndex,
    };
  }

  /**
   * Když je v běžící partii na tahu engine, přepni na `thinking` a spusť tah NA
   * POZADÍ (fire-and-forget). No-op, když je na tahu člověk / je po partii –
   * stejná podmínka jako serverový `maybeTriggerEngine`, takže pro partii, kde
   * začíná člověk, se nic nespustí.
   */
  function maybeTriggerEngine(game: LocalGame): void {
    if (effectiveResult(game) !== 'ongoing') {
      return;
    }
    if (game.state.position.turn !== engineColorOf(game)) {
      return;
    }
    game.engineStatus = 'thinking';
    game.pendingSeed = nextSeed();
    void runEngineMove(game.id);
  }

  /**
   * Spočítá (workerem) a zahraje tah enginu. Engine je NEDŮVĚRYHODNÝ: jeho tah se
   * ověří `findLegalMove` proti AKTUÁLNÍ pozici (jako tah člověka). Jakékoli
   * selhání (worker padl, nelegální tah) skončí `engineStatus='error'` – partie
   * zůstane stát na tahu člověka. Nikdy nevyhazuje (fire-and-forget). Tah se
   * aplikuje proti pozici PO awaitu, ne proti snímku z doby spuštění.
   */
  async function runEngineMove(id: string): Promise<void> {
    try {
      const game = games.get(id);
      if (game === undefined) {
        return;
      }
      // Tato kontrola i `games.get` MUSÍ zůstat PŘED prvním awaitem (níž
      // `worker.computeMove`): `maybeTriggerEngine` nastaví 'thinking' a synchronně
      // sem vskočí. Return před awaitem znamená, že status 'thinking' nastavený
      // spouštěčem nikdy neuvázne (reset dělá jen post-await větev níž).
      if (
        effectiveResult(game) !== 'ongoing' ||
        game.state.position.turn !== engineColorOf(game) ||
        game.pendingSeed === null
      ) {
        return;
      }
      const move = await worker.computeMove({
        position: game.state.position,
        level: game.level,
        seed: game.pendingSeed,
        timeMs,
      });

      // Po awaitu se stav znovu načte: tah enginu se aplikuje VÝHRADNĚ proti
      // AKTUÁLNÍ pozici. Vzdání/remíza (které stav pravidel nemění) tady engine
      // zastaví – nesáhne do už skončené partie.
      const current = games.get(id);
      if (current === undefined) {
        return;
      }
      if (
        effectiveResult(current) !== 'ongoing' ||
        current.state.position.turn !== engineColorOf(current)
      ) {
        current.engineStatus = 'idle';
        current.pendingSeed = null;
        return;
      }
      const legal = findLegalMove(current.state.position, move.from, move.path);
      if (legal === undefined) {
        // Engine vrátil nelegální tah (nemělo by nastat – computeAiMove bere tahy
        // z legalMoves). Obranně: 'error', partie stojí na tahu člověka.
        console.error(`Engine vrátil nelegální tah pro partii ${id}, odmítám.`);
        current.engineStatus = 'error';
        current.pendingSeed = null;
        return;
      }
      current.state = advanceState(current.state, legal);
      current.moves.push(legal);
      current.engineStatus = 'idle';
      current.pendingSeed = null;
    } catch (error) {
      console.error(`Tah enginu selhal pro partii ${id}:`, error);
      const game = games.get(id);
      if (game !== undefined) {
        game.engineStatus = 'error';
        game.pendingSeed = null;
      }
    }
  }

  return {
    createGame(level: GameLevel, humanColor: Color, ballotIndex?: number): Promise<GameDto> {
      // ballotIndex dává smysl JEN u Mistrovství (2. kolo přehraje ballot 1. kola).
      // Jinde je to chyba volajícího – hlasitě (server na to vrací 400), ne tiché
      // ignorování. `seedInitial` navíc ověří rozsah proti decku.
      if (ballotIndex !== undefined && level !== 'championship') {
        return Promise.reject(
          new ServerError(400, CODES.invalidRequest, `ballotIndex lze zadat jen pro úroveň 'championship', ne '${level}'`),
        );
      }
      let seeded: { state: GameState; moves: Move[]; ballotIndex: number | null };
      try {
        seeded = seedInitial(level, ballotIndex, rng);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      const game: LocalGame = {
        id: newGameId(),
        state: seeded.state,
        moves: seeded.moves,
        level,
        humanColor,
        ballotIndex: seeded.ballotIndex,
        engineStatus: 'idle',
        forcedResult: null,
        forcedReason: null,
        pendingSeed: null,
      };
      games.set(game.id, game);
      // Engine táhne PRVNÍ, kdykoli je po založení na tahu jeho barva: (a) Mistrovství
      // s ballotem, po němž je na tahu bílý = engine (člověk černý); (b) běžná partie,
      // kde je člověk bílý → engine černý začíná. Obojí pokryje maybeTriggerEngine.
      maybeTriggerEngine(game);
      return Promise.resolve(toDto(game));
    },

    getGame(id: string): Promise<GameDto> {
      const game = games.get(id);
      if (game === undefined) {
        return Promise.reject(new ServerError(404, CODES.gameNotFound, `Partie ${id} neexistuje`));
      }
      return Promise.resolve(toDto(game));
    },

    postMove(id: string, from: Square, path: readonly Square[]): Promise<GameDto> {
      const game = games.get(id);
      if (game === undefined) {
        return Promise.reject(new ServerError(404, CODES.gameNotFound, `Partie ${id} neexistuje`));
      }
      // Konec partie PŘED hledáním tahu: remíza opakováním / 80 půltahů může mít
      // legální tahy, ale partie je u konce. Přes efektivní výsledek → chytí i vzdanou.
      if (effectiveResult(game) !== 'ongoing') {
        return Promise.reject(new ServerError(409, CODES.gameOver, 'Partie je u konce'));
      }
      // Autorita barvy: člověk smí táhnout JEN svou stranou. Bez toho by mohl zahrát
      // legální tah ENGINU, zatímco engine přemýšlí, a přepsat mu pozici pod rukama.
      if (game.state.position.turn === engineColorOf(game)) {
        return Promise.reject(new ServerError(409, CODES.notYourTurn, 'Na tahu je počítač, počkej na jeho tah.'));
      }
      const move = findLegalMove(game.state.position, from, path);
      if (move === undefined) {
        return Promise.reject(new ServerError(409, CODES.illegalMove, 'Nelegální tah'));
      }
      game.state = advanceState(game.state, move);
      game.moves.push(move);
      // Je-li engine na tahu (bílý), spusť jeho tah NA POZADÍ – volající nikdy
      // nečeká na engine. Klient tah uvidí pollem getGame (přechod na 'idle').
      maybeTriggerEngine(game);
      // Odpověď nese stav HNED po tahu člověka (engine ještě nedotáhl); engineStatus
      // už může být 'thinking'. toDto je snímek – pozdější aplikace tahu enginu ho nezmění.
      return Promise.resolve(toDto(game));
    },

    resign(id: string): Promise<GameDto> {
      const game = games.get(id);
      if (game === undefined) {
        return Promise.reject(new ServerError(404, CODES.gameNotFound, `Partie ${id} neexistuje`));
      }
      if (effectiveResult(game) !== 'ongoing') {
        return Promise.reject(new ServerError(409, CODES.gameOver, 'Partie je u konce'));
      }
      // Člověk se vzdá → vyhrává ENGINE (druhá barva): člověk černý → white-wins,
      // člověk bílý → black-wins. NE natvrdo white-wins, jinak by obrácená barva
      // připsala výhru straně, která se vzdala.
      game.forcedResult = engineColorOf(game) === 'white' ? 'white-wins' : 'black-wins';
      game.forcedReason = 'resign';
      return Promise.resolve(toDto(game));
    },

    offerDraw(id: string): Promise<DrawOffer> {
      // Ne `async`: searchTimed běží SYNCHRONNĚ (na hlavním vlákně), žádný await tu
      // není. Vrací se explicitní Promise (konzistentní s createGame/postMove/resign).
      const game = games.get(id);
      if (game === undefined) {
        return Promise.reject(new ServerError(404, CODES.gameNotFound, `Partie ${id} neexistuje`));
      }
      if (effectiveResult(game) !== 'ongoing') {
        return Promise.reject(new ServerError(409, CODES.gameOver, 'Partie je u konce'));
      }
      // Engine přemýšlí (je na tahu) → remízu teď nepřijímáme (symetrie se serverem):
      // rozhodnutí chce klid na tahu člověka.
      if (game.engineStatus === 'thinking') {
        return Promise.reject(
          new ServerError(409, CODES.engineBusy, 'Počítač je na tahu, remízu nabídni na svém tahu.'),
        );
      }
      // Rozhodnutí enginu: skóre pozice z pohledu STRANY NA TAHU (negamax) →
      // přepočet na pohled ENGINU (na tahu engine = beze změny, na tahu člověk =
      // obrácené znaménko). searchTimed běží na HLAVNÍM vlákně (krátký blok při
      // vzácné akci; worker interface počítá jen tah). Selhání searche NENÍ „engine
      // řekl ne": spadne jako engine_unavailable, partie beze změny.
      const position = game.state.position;
      let engineScore: number;
      try {
        const { score } = searchTimed(position, now === undefined ? { timeMs } : { timeMs, now });
        engineScore = position.turn === engineColorOf(game) ? score : -score;
      } catch (error) {
        console.error(`Vyhodnocení nabídky remízy selhalo pro partii ${id}:`, error);
        return Promise.reject(
          new ServerError(503, CODES.engineUnavailable, 'Počítač teď nedokáže o nabídce rozhodnout, zkus to prosím znovu.'),
        );
      }
      const accepted = engineScore <= DRAW_ACCEPT_MAX_ENGINE_SCORE;
      if (!accepted) {
        return Promise.resolve({ accepted: false, game: toDto(game) });
      }
      // Přijato: vynucený výsledek draw (atomický – mezi kontrolou a zápisem není
      // await; searchTimed výše je synchronní, stav se pod ním nezměnil).
      game.forcedResult = 'draw';
      game.forcedReason = 'draw-agreement';
      return Promise.resolve({ accepted: true, game: toDto(game) });
    },

    async getHint(id: string): Promise<MoveDto> {
      const game = games.get(id);
      if (game === undefined) {
        throw new ServerError(404, CODES.gameNotFound, `Partie ${id} neexistuje`);
      }
      if (effectiveResult(game) !== 'ongoing') {
        throw new ServerError(409, CODES.gameOver, 'Partie je u konce');
      }
      // Nápověda je jen na tahu ČLOVĚKA (na tahu engine není co radit). Symetrie s
      // guardem v postMove a se serverovým /hint.
      if (game.state.position.turn === engineColorOf(game)) {
        throw new ServerError(409, CODES.notYourTurn, 'Na tahu je počítač, nápověda je jen na tvém tahu.');
      }
      // Nápověda = PLNÁ síla + strop 12, BEZ nepozornosti a BEZ knihy. Sílu dává
      // offline politika silné úrovně (Profesionál), nezávisle na úrovni partie
      // (server: hint vždy naplno). Kniha se ale VYPÍNÁ (`useBook: false`): server
      // hint počítá `bestmove(position, undefined)` bez knihy (knihu aplikuje jen u
      // tahu enginu), takže se stropem, ale bez knihy, radí LocalClient v zahájení
      // TÝŽ tah jako server, ne knižní. READ-ONLY: stav partie se nemění.
      let suggested: Move;
      try {
        suggested = await worker.computeMove({
          position: game.state.position,
          level: 'professional',
          seed: nextSeed(),
          timeMs,
          useBook: false,
        });
      } catch (error) {
        console.error(`Nápověda selhala pro partii ${id}:`, error);
        throw new ServerError(503, CODES.engineUnavailable, 'Počítač teď nedokáže poradit, zkus to prosím znovu.');
      }
      // Engine je nedůvěryhodný i když radí: tah PROVĚŘ proti legálním tahům.
      // Pozici zachyť PŘED awaitem není třeba – getHint běží jen na tahu člověka a
      // stav se pod ním nemění (žádný souběžný trigger enginu), ale re-validace je levná pojistka.
      const legal = findLegalMove(game.state.position, suggested.from, suggested.path);
      if (legal === undefined) {
        console.error(`Engine vrátil nelegální nápovědu pro partii ${id}, odmítám.`);
        throw new ServerError(503, CODES.engineUnavailable, 'Počítač teď nedokáže poradit, zkus to prosím znovu.');
      }
      return moveToDto(legal);
    },
  };
}

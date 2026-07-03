/**
 * Search jádro: negamax s alfa-beta ořezáváním, quiescence na povinných
 * skocích a iterativní prohlubování s měkkým časovým limitem (searchTimed).
 *
 * Quiescence: na hranici hloubky (depth 0) se pozice NEvyhodnotí staticky,
 * dokud je strana na tahu v povinném skoku – vynucená výměna se dohraje do
 * klidné pozice. Bez toho engine na horizontu nevidí ztrátu kamene o půltah
 * dál a tahy „do braní" přeceňuje (horizont efekt). Stand-pat neexistuje:
 * braní je v americké dámě povinné, strana v braní se evaluace dovolat
 * nemůže. Terminaci zaručuje úbytek materiálu – každý skok bere aspoň
 * jeden kámen, řetěz je tedy omezen počtem kamenů na desce.
 *
 * Časová kontrola (searchTimed): iterativní prohlubování 1..maxDepth.
 * Hloubka 1 se dokončí VŽDY bez měření času – legální výsledek existuje
 * i při absurdně malém limitu. Před každou další iterací se odhaduje,
 * jestli se vejde; běžící iterace se při překročení deadline přeruší
 * (kontrola hodin jednou za NODES_PER_TIME_CHECK uzlů) a její NEÚPLNÝ
 * výsledek se zahodí – vrací se poslední kompletní iterace.
 *
 * Vědomý limit (ne opomenutí): search NEVIDÍ remízová pravidla (čítač
 * půltahů, opakování) – pracuje nad samotnou `Position`, protokol historii
 * nepřenáší. Remízy autoritativně hlídá server přes GameState.
 *
 * Terminál: strana na tahu bez legálního tahu prohrála (pat v americké
 * dámě neexistuje). Skóre výhry se snižuje o vzdálenost od kořene
 * (`WIN_SCORE - ply`), takže engine preferuje rychlejší výhru a pozdější
 * prohru – bez toho by mezi „mat hned" a „mat za 3 tahy" neuměl vybrat
 * a mohl výhru donekonečna odkládat.
 *
 * Kořen sbírá VŠECHNY tahy s nejlepším skóre (podklad pro tie-break
 * v handleru). Aby byly remízy přesné i s ořezáváním, hledá se každý další
 * tah s alfou `best - 1`: děti s hodnotou PŘESNĚ `best` tak padnou dovnitř
 * okna a vrátí přesné skóre, horší tahy se dál ořezávají. Stojí to na tom,
 * že všechna skóre jsou CELÁ čísla (viz evaluate.ts).
 */

import { applyMove, legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';

import { evaluate } from './evaluate.js';

/**
 * Statická evaluace listu z pohledu strany na tahu (celé číslo). Injektuje
 * se do searche, aby šly v self-play harnessu srovnat dvě verze evaluace
 * v jednom procesu; výchozí je produkční `evaluate`. Celočíselnost je
 * KONTRAKT (viz hlavička souboru, trik okna `best - 1`) – search si ji
 * nevynucuje, dodržet ji musí každá dosazená funkce.
 */
export type EvalFn = (position: Position) => number;

/**
 * Skóre výhry v kořeni; skutečná hodnota v uzlu je `WIN_SCORE - ply`.
 * Řádově výš než součet materiálu (max ~12 × 130), aby se výhra nikdy
 * nepletla s poziční převahou.
 */
export const WIN_SCORE = 100_000;

/**
 * Strop iterativního prohlubování – pojistka proti nekonečné smyčce
 * u triviálních pozic; v běžné pozici iterace utne čas dávno před ním.
 */
export const MAX_SEARCH_DEPTH = 25;

/**
 * Po kolika uzlech se kontrolují hodiny. Kompromis: kontrola v každém
 * uzlu by brzdila (volání hodin je proti evaluaci laciné, ale ne zadarmo),
 * moc řídká kontrola nechá deadline přetéct. 64 uzlů ≈ desítky µs práce,
 * překročení deadline je tak omezeno hluboko pod milisekundu.
 */
const NODES_PER_TIME_CHECK = 64;

/** Výchozí hodiny: monotónní čas procesu v ms. */
function currentTimeMs(): number {
  return performance.now();
}

/**
 * Interní signál „došel čas". Chytá ho výhradně searchTimed; ven z modulu
 * nesmí uniknout (volající dostává vždy kompletní výsledek, ne výjimku).
 */
class SearchAborted extends Error {
  constructor() {
    super('Search přerušen: překročena deadline.');
    this.name = 'SearchAborted';
  }
}

/** Běžící hodiny searche; `null` = bez časové kontroly (hloubka 1, testy). */
interface SearchClock {
  readonly now: () => number;
  readonly deadline: number;
  nodesUntilCheck: number;
}

/** Započítá uzel; jednou za NODES_PER_TIME_CHECK uzlů porovná hodiny. */
function tickClock(clock: SearchClock | null): void {
  if (clock === null) {
    return;
  }
  clock.nodesUntilCheck -= 1;
  if (clock.nodesUntilCheck > 0) {
    return;
  }
  clock.nodesUntilCheck = NODES_PER_TIME_CHECK;
  if (clock.now() >= clock.deadline) {
    throw new SearchAborted();
  }
}

/** Výsledek prohledání kořene. */
export interface SearchResult {
  /** Všechny tahy se shodným nejlepším skóre (aspoň jeden). */
  readonly bestMoves: readonly Move[];
  /** Skóre nejlepších tahů z pohledu strany na tahu. */
  readonly score: number;
}

/**
 * Prohledá pozici do hloubky `depth` (plus quiescence za horizontem)
 * a vrátí nejlepší tahy + skóre. Bez časové kontroly – vždy doběhne.
 *
 * `bestMoves` jsou vždy prvky `legalMoves(position)` – search jiné tahy
 * nevyrábí, jen vybírá z generátoru. Pozice bez legálního tahu je
 * programátorská chyba volajícího (handler ji odbavuje dřív jako
 * `no_legal_moves`) → RangeError, žádný tichý fallback.
 */
export function searchRoot(
  position: Position,
  depth: number,
  evaluateFn: EvalFn = evaluate,
): SearchResult {
  return rootSearch(position, depth, null, evaluateFn);
}

/** Kořen searche; s hodinami umí vyhodit SearchAborted (chytá searchTimed). */
function rootSearch(
  position: Position,
  depth: number,
  clock: SearchClock | null,
  evaluateFn: EvalFn,
): SearchResult {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new RangeError(`Neplatná hloubka prohledávání: ${String(depth)}`);
  }
  const moves = legalMoves(position);
  if (moves.length === 0) {
    throw new RangeError('searchRoot: pozice bez legálního tahu – partie už skončila');
  }

  let best = Number.NEGATIVE_INFINITY;
  let bestMoves: Move[] = [];
  for (const move of moves) {
    // Okno dítěte je (-beta, -alfa) s alfou kořene `best - 1` (viz hlavička).
    const rootAlpha = bestMoves.length === 0 ? Number.NEGATIVE_INFINITY : best - 1;
    const value = -negamax(
      applyMove(position, move),
      depth - 1,
      1,
      Number.NEGATIVE_INFINITY,
      -rootAlpha,
      clock,
      evaluateFn,
    );
    if (value > best) {
      best = value;
      bestMoves = [move];
    } else if (value === best) {
      bestMoves.push(move);
    }
  }
  // Negace v rekurzi umí vyrobit -0; navenek vracíme vždy +0, ať budoucí
  // konzument (server, telemetrie) nedostane falešný rozdíl v Object.is.
  return { bestMoves, score: best === 0 ? 0 : best };
}

/**
 * Negamax s alfa-beta (fail-soft): vrací skóre pozice z pohledu strany
 * na tahu, `ply` je vzdálenost od kořene (pro WIN_SCORE - ply).
 *
 * Tahy se generují i v hloubce 0 – dražší o legalMoves na listech, ale
 * prohra „bez tahu" na horizontu se pozná přesně místo tichého ohodnocení
 * prohrané pozice materiálem, a povinné skoky na horizontu spouštějí
 * quiescence (childDepth zůstává 0, dokud výměna neskončí).
 */
function negamax(
  position: Position,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  clock: SearchClock | null,
  evaluateFn: EvalFn,
): number {
  tickClock(clock);
  const moves = legalMoves(position);
  if (moves.length === 0) {
    return -(WIN_SCORE - ply);
  }
  // Povinné braní: generátor vrací buď samá braní, nebo žádné – stačí
  // ověřit první tah.
  const forcedCapture = moves[0] !== undefined && moves[0].captures.length > 0;
  if (depth <= 0 && !forcedCapture) {
    return evaluateFn(position);
  }
  const childDepth = depth <= 0 ? 0 : depth - 1;

  let best = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    const value = -negamax(applyMove(position, move), childDepth, ply + 1, -beta, -alpha, clock, evaluateFn);
    if (value > best) {
      best = value;
      if (value > alpha) {
        alpha = value;
      }
      if (alpha >= beta) {
        break;
      }
    }
  }
  return best;
}

/** Volby časovaného searche. */
export interface TimedSearchOptions {
  /** Měkký limit v ms – kladné celé číslo (kontrakt protokolu bestmove). */
  readonly timeMs: number;
  /** Strop prohlubování (výchozí MAX_SEARCH_DEPTH); kladné celé číslo. */
  readonly maxDepth?: number;
  /** Injektovatelné hodiny pro deterministické testy (výchozí performance.now). */
  readonly now?: () => number;
  /** Injektovatelná statická evaluace (výchozí produkční `evaluate`). */
  readonly evaluate?: EvalFn;
}

/** Výsledek časovaného searche. */
export interface TimedSearchResult extends SearchResult {
  /** Hloubka poslední KOMPLETNÍ iterace – z ní pochází bestMoves i score. */
  readonly depth: number;
}

/**
 * Iterativní prohlubování 1..maxDepth s měkkým limitem `timeMs`.
 *
 * Záruky:
 * - hloubka 1 doběhne vždy (bez hodin) → výsledek existuje i pro timeMs=1,
 * - vrací se výhradně poslední KOMPLETNÍ iterace; iterace přerušená
 *   deadline se celá zahodí (částečný výsledek se nikam nepropíše),
 * - doba běhu ≤ max(timeMs, čas hloubky 1) + jedno okno kontroly hodin
 *   (NODES_PER_TIME_CHECK uzlů, řádově desítky µs). Hloubka 1 běží bez
 *   hodin včetně quiescence – u pozice s hustým stromem povinných výměn
 *   může přesáhnout malé timeMs; terminaci zaručuje úbytek materiálu,
 *   prakticky jde o jednotky ms.
 *
 * Odhad před iterací: nezačínat, když `uplynulo + 2 × trvání poslední
 * iterace > timeMs`. Strom mezi hloubkami roste zhruba 3-6×, faktor 2 je
 * záměrně optimistický: hraniční iteraci raději začne a nechá ji utnout
 * deadline (tvrdý strop drží přerušení), než aby nechával budget ležet.
 */
export function searchTimed(position: Position, options: TimedSearchOptions): TimedSearchResult {
  const { timeMs } = options;
  if (!Number.isSafeInteger(timeMs) || timeMs < 1) {
    throw new RangeError(`Neplatný časový limit searche: ${String(timeMs)}`);
  }
  const maxDepth = options.maxDepth ?? MAX_SEARCH_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError(`Neplatný strop hloubky: ${String(maxDepth)}`);
  }
  const now = options.now ?? currentTimeMs;
  const evaluateFn = options.evaluate ?? evaluate;

  const start = now();
  const deadline = start + timeMs;

  let result: TimedSearchResult = { ...rootSearch(position, 1, null, evaluateFn), depth: 1 };
  let lastIterationMs = now() - start;

  for (let depth = 2; depth <= maxDepth; depth++) {
    const iterationStart = now();
    if (iterationStart - start + 2 * lastIterationMs > timeMs) {
      break;
    }
    let iteration: SearchResult;
    try {
      iteration = rootSearch(
        position,
        depth,
        { now, deadline, nodesUntilCheck: NODES_PER_TIME_CHECK },
        evaluateFn,
      );
    } catch (error) {
      if (error instanceof SearchAborted) {
        break;
      }
      throw error;
    }
    result = { ...iteration, depth };
    lastIterationMs = now() - iterationStart;
  }
  return result;
}

/**
 * Search jádro: negamax s alfa-beta ořezáváním, quiescence na povinných
 * skocích, transpoziční tabulkou a iterativní prohlubování s měkkým časovým
 * limitem (searchTimed).
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
 *
 * Transpoziční tabulka (fáze 17) – návrh podřízený PŘESNOSTI kořene, tj.
 * tomu, aby `searchRoot` s TT vrátil na dané hloubce IDENTICKOU množinu
 * nejlepších tahů i skóre jako bez TT (jinak by TT tiše rozbila kalibraci
 * remíz). Proto tři vědomá omezení proti „učebnicové" TT:
 *   1. TT čte/píše JEN v `negamax` (ply ≥ 1) a jen v plných uzlech
 *      (depth ≥ 1); kořen ani quiescence se necachují. Kořen tak zůstává
 *      přesný jako bez TT, z TT bere maximálně pořadí tahů dětí.
 *   2. Skóre se z TT přebírá jen při SHODNÉ zbývající hloubce
 *      (`entry.depth === depth`), ne `>=`. Reuse hlubšího záznamu v mělčím
 *      uzlu by fakticky prohloubil evaluaci → výsledek fixní hloubky by se
 *      lišil od běhu bez TT. Řazení (`bestMove`) se bere z libovolné hloubky:
 *      přeuspořádání tahů výsledek nikdy nemění, jen rychlost.
 *   3. Cutoff-only, BEZ zúžení okna: mez způsobí návrat jen když prokáže
 *      hodnotu mimo okno (`lower ≥ beta`, `upper ≤ alpha`) – přesně tam, kde
 *      by i alfa-beta bez TT vrátila mez. Okno se z TT NEzužuje: zúžení by na
 *      hranici udělalo z přesného skóre mez a mohlo změnit, které tahy kořen
 *      vyhodnotí jako shodně nejlepší.
 * Mat-skóre (`|score|` blízko `WIN_SCORE`) se do TT NEUKLÁDÁ: závisí na `ply`
 * a přenos mezi různými hloubkami (napříč iteracemi, přes quiescence) by hlásil
 * mat v jiné vzdálenosti. Vynechání je levné (mat je vzácný) a přesné.
 */

import { AMERICAN_RULESET, applyMove, legalMoves } from '@checkers/rules';
import type { Move, Position, Ruleset } from '@checkers/rules';

import { evaluate } from './evaluate.js';
import { TranspositionTable } from './transposition.js';
import type { BoundType } from './transposition.js';
import { hashPosition } from './zobrist.js';

/**
 * Statická evaluace listu z pohledu strany na tahu (celé číslo). Injektuje
 * se do searche, aby šly v self-play harnessu srovnat dvě verze evaluace
 * v jednom procesu; výchozí je produkční `evaluate`. Celočíselnost je
 * KONTRAKT (viz hlavička souboru, trik okna `best - 1`) – search si ji
 * nevynucuje, dodržet ji musí každá dosazená funkce.
 *
 * `ruleset` je VOLITELNÝ druhý argument (default americká u volajícího): search
 * ho dodává z varianty, aby evaluace závislá na `legalMoves` (mobilita v2)
 * počítala tahy pravidly SPRÁVNÉ varianty. Evaluace, které ruleset nepotřebují
 * (materiálová v1), ho prostě ignorují – proto je volitelný a nerozbíjí starší
 * dosazené funkce.
 */
export type EvalFn = (position: Position, ruleset?: Ruleset) => number;

/**
 * Skóre výhry v kořeni; skutečná hodnota v uzlu je `WIN_SCORE - ply`.
 * Řádově výš než součet materiálu (max ~12 × 130), aby se výhra nikdy
 * nepletla s poziční převahou.
 */
export const WIN_SCORE = 100_000;

/**
 * Práh „mat skóre": skóre s absolutní hodnotou nad ním je vzdálenostně
 * korigovaná výhra/prohra (`WIN_SCORE - ply`), ne materiál. Materiál je
 * shora omezen součtem kamenů (~12 × 130 = 1560), práh je bezpečně nad ním
 * a pod nejmělčím matem (`WIN_SCORE` − reálná hloubka). Používá se k tomu,
 * aby se mat-skóre neukládala do TT (viz hlavička).
 */
const MATE_SCORE_THRESHOLD = WIN_SCORE - 1_000;

/** Skóre je vzdálenostně korigovaný mat (nezávislé na materiálu). */
function isMateScore(score: number): boolean {
  return score >= MATE_SCORE_THRESHOLD || score <= -MATE_SCORE_THRESHOLD;
}

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

/**
 * Kontext jednoho prohledávání: sdílené hodiny, evaluace, TT a čítač uzlů.
 * `nodes` je JEDINÉ mutovatelné pole – roste přes celý strom (počet
 * navštívených uzlů pro bránu úbytku). `tt === null` = bez transpoziční
 * tabulky (běh pro srovnání a starší volající).
 */
interface SearchCtx {
  readonly clock: SearchClock | null;
  readonly evaluateFn: EvalFn;
  readonly tt: TranspositionTable | null;
  /**
   * Ruleset varianty – search ho předává `legalMoves`/`applyMove`/`evaluateFn`.
   * Default u volajících je americká, takže dosavadní hledání se nemění.
   */
  readonly ruleset: Ruleset;
  nodes: number;
}

/** Strukturální rovnost tahů (pro nalezení TT-tahu v seznamu k řazení). */
function moveEquals(a: Move, b: Move): boolean {
  if (a.from !== b.from || a.path.length !== b.path.length || a.captures.length !== b.captures.length) {
    return false;
  }
  for (let i = 0; i < a.path.length; i++) {
    if (a.path[i] !== b.path[i]) {
      return false;
    }
  }
  for (let i = 0; i < a.captures.length; i++) {
    if (a.captures[i] !== b.captures[i]) {
      return false;
    }
  }
  return true;
}

/** Jeden kořenový tah s jeho PŘESNÝM skóre; plní se jen v ranked režimu. */
export interface RankedMove {
  readonly move: Move;
  /** Skóre tahu z pohledu strany na tahu (přesné – kořen se v ranked nepruuje). */
  readonly score: number;
}

/** Výsledek prohledání kořene. */
export interface SearchResult {
  /** Všechny tahy se shodným nejlepším skóre (aspoň jeden). */
  readonly bestMoves: readonly Move[];
  /** Skóre nejlepších tahů z pohledu strany na tahu. */
  readonly score: number;
  /** Počet navštívených uzlů (negamax volání) – podklad brány úbytku. */
  readonly nodes: number;
  /**
   * Všechny kořenové tahy se skóre, seřazené SESTUPNĚ – jen když search běžel
   * v ranked režimu (`rankRoot`). Podklad pro výběr slabšího tahu (nepozornost).
   * Mimo ranked režim je `undefined` (běžný search kořen pruuje, skóre horších
   * tahů se nepočítá).
   */
  readonly rankedMoves?: readonly RankedMove[];
}

/**
 * Prohledá pozici do hloubky `depth` (plus quiescence za horizontem)
 * a vrátí nejlepší tahy + skóre. Bez časové kontroly – vždy doběhne.
 *
 * `bestMoves` jsou vždy prvky `legalMoves(position)` – search jiné tahy
 * nevyrábí, jen vybírá z generátoru. Pozice bez legálního tahu je
 * programátorská chyba volajícího (handler ji odbavuje dřív jako
 * `no_legal_moves`) → RangeError, žádný tichý fallback.
 *
 * `tt` (volitelně) zapne transpoziční tabulku pro TOTO prohledávání. Na
 * dané hloubce vrací identickou množinu bestMoves i skóre jako bez TT (viz
 * hlavička) – TT je čistě optimalizace počtu uzlů, ne změna výsledku.
 */
export function searchRoot(
  position: Position,
  depth: number,
  evaluateFn: EvalFn = evaluate,
  tt: TranspositionTable | null = null,
  rankRoot = false,
  ruleset: Ruleset = AMERICAN_RULESET,
): SearchResult {
  const ctx: SearchCtx = { clock: null, evaluateFn, tt, ruleset, nodes: 0 };
  return rootSearch(position, depth, ctx, rankRoot);
}

/**
 * Kořen searche; s hodinami umí vyhodit SearchAborted (chytá searchTimed).
 *
 * `rankRoot`: v ranked režimu se kořen NEpruuje (plné okno na každý tah), takže
 * skóre VŠECH kořenových tahů je přesné a vrací se v `rankedMoves` (seřazeno
 * sestupně). Mimo ranked režim je chování bit-identické s původním (okno
 * `best - 1`, `rankedMoves` chybí) – ranked režim je dražší (žádné ořezání
 * kořene), proto se zapíná jen pro slabší hru s nepozorností.
 */
function rootSearch(
  position: Position,
  depth: number,
  ctx: SearchCtx,
  rankRoot: boolean,
): SearchResult {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new RangeError(`Neplatná hloubka prohledávání: ${String(depth)}`);
  }
  const moves = legalMoves(position, ctx.ruleset);
  if (moves.length === 0) {
    throw new RangeError('searchRoot: pozice bez legálního tahu – partie už skončila');
  }

  let best = Number.NEGATIVE_INFINITY;
  let bestMoves: Move[] = [];
  const ranked: RankedMove[] | null = rankRoot ? [] : null;
  for (const move of moves) {
    // Okno dítěte je (-beta, -alfa) s alfou kořene `best - 1` (viz hlavička).
    // V ranked režimu se ale kořen nepruuje (alfa = -∞), aby skóre KAŽDÉHO
    // tahu vyšlo přesné, ne jen jako fail-soft mez pod nejlepším.
    const rootAlpha = rankRoot
      ? Number.NEGATIVE_INFINITY
      : bestMoves.length === 0
        ? Number.NEGATIVE_INFINITY
        : best - 1;
    const value = -negamax(
      applyMove(position, move, ctx.ruleset),
      depth - 1,
      1,
      Number.NEGATIVE_INFINITY,
      -rootAlpha,
      ctx,
    );
    if (ranked !== null) {
      // -0 → +0 stejně jako u `score`, ať tie-break i řazení dají stabilní pořadí.
      ranked.push({ move, score: value === 0 ? 0 : value });
    }
    if (value > best) {
      best = value;
      bestMoves = [move];
    } else if (value === best) {
      bestMoves.push(move);
    }
  }
  // Negace v rekurzi umí vyrobit -0; navenek vracíme vždy +0, ať budoucí
  // konzument (server, telemetrie) nedostane falešný rozdíl v Object.is.
  const score = best === 0 ? 0 : best;
  if (ranked !== null) {
    // Sestupně podle skóre; shodné skóre drží pořadí generátoru (stabilní sort).
    ranked.sort((a, b) => b.score - a.score);
    return { bestMoves, score, nodes: ctx.nodes, rankedMoves: ranked };
  }
  return { bestMoves, score, nodes: ctx.nodes };
}

/**
 * Negamax s alfa-beta (fail-soft): vrací skóre pozice z pohledu strany
 * na tahu, `ply` je vzdálenost od kořene (pro WIN_SCORE - ply).
 *
 * Tahy se generují i v hloubce 0 – dražší o legalMoves na listech, ale
 * prohra „bez tahu" na horizontu se pozná přesně místo tichého ohodnocení
 * prohrané pozice materiálem, a povinné skoky na horizontu spouštějí
 * quiescence (childDepth zůstává 0, dokud výměna neskončí).
 *
 * TT (viz hlavička) se čte/píše jen v plných uzlech (depth ≥ 1): skóre se
 * přebírá při shodné hloubce (exact → návrat; lower/upper → cutoff, když mez
 * dokáže hodnotu mimo okno), uložený tah řadí jako první. Zapisuje se
 * fail-soft mez proti PŮVODNÍMU oknu; mat-skóre se neukládá.
 */
function negamax(
  position: Position,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx,
): number {
  ctx.nodes += 1;
  tickClock(ctx.clock);
  const moves = legalMoves(position, ctx.ruleset);
  if (moves.length === 0) {
    return -(WIN_SCORE - ply);
  }
  // Povinné braní: generátor vrací buď samá braní, nebo žádné – stačí
  // ověřit první tah.
  const forcedCapture = moves[0] !== undefined && moves[0].captures.length > 0;
  if (depth <= 0 && !forcedCapture) {
    return ctx.evaluateFn(position, ctx.ruleset);
  }
  const childDepth = depth <= 0 ? 0 : depth - 1;

  // TT jen v plných uzlech; quiescence (depth ≤ 0) se necachuje.
  const tt = depth >= 1 ? ctx.tt : null;
  let key = 0;
  let ttMove: Move | null = null;
  if (tt !== null) {
    key = hashPosition(position);
    const entry = tt.probe(key);
    if (entry !== null) {
      ttMove = entry.bestMove;
      // Skóre jen při SHODNÉ hloubce (viz hlavička, omezení 2); cutoff-only,
      // bez zúžení okna (omezení 3).
      if (entry.depth === depth) {
        if (entry.bound === 'exact') {
          return entry.score;
        }
        if (entry.bound === 'lower') {
          if (entry.score >= beta) {
            return entry.score;
          }
        } else if (entry.bound === 'upper') {
          if (entry.score <= alpha) {
            return entry.score;
          }
        }
      }
    }
  }

  // TT-tah řadíme první (najdeme jeho index; -1 = není mezi legálními).
  let firstIdx = -1;
  if (ttMove !== null) {
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m !== undefined && moveEquals(m, ttMove)) {
        firstIdx = i;
        break;
      }
    }
  }

  const alphaOrig = alpha;
  let best = Number.NEGATIVE_INFINITY;
  let bestMove: Move | null = null;
  // k === -1 → TT-tah (firstIdx), pak zbylé tahy kromě firstIdx. Bez alokace
  // přeuspořádaného pole – jen přeskočení už zahraného indexu.
  for (let k = -1; k < moves.length; k++) {
    let move: Move | undefined;
    if (k === -1) {
      if (firstIdx === -1) {
        continue;
      }
      move = moves[firstIdx];
    } else {
      if (k === firstIdx) {
        continue;
      }
      move = moves[k];
    }
    if (move === undefined) {
      continue;
    }
    const value = -negamax(applyMove(position, move, ctx.ruleset), childDepth, ply + 1, -beta, -alpha, ctx);
    if (value > best) {
      best = value;
      bestMove = move;
      if (value > alpha) {
        alpha = value;
      }
      if (alpha >= beta) {
        break;
      }
    }
  }

  if (tt !== null && !isMateScore(best)) {
    let bound: BoundType;
    if (best <= alphaOrig) {
      bound = 'upper'; // fail-low: žádný tah nepřekonal alfu → horní mez
    } else if (best >= beta) {
      bound = 'lower'; // fail-high: cutoff → dolní mez
    } else {
      bound = 'exact';
    }
    tt.store(key, depth, best, bound, bestMove);
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
  /**
   * Ranked režim kořene (výchozí false): vrací `rankedMoves` z poslední
   * kompletní iterace – skóre všech kořenových tahů. Zapíná se pro slabší hru
   * s nepozorností; jinak nech vypnuté (kořen se pruuje, search je rychlejší).
   */
  readonly rankRoot?: boolean;
  /**
   * Ruleset varianty (výchozí americká): protahuje se do `legalMoves`/`applyMove`/
   * evaluace. Chybí → americká, tedy dosavadní chování beze změny.
   */
  readonly ruleset?: Ruleset;
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
 * `nodes` ve výsledku je SOUČET uzlů přes všechny (i přerušenou) iterace –
 * celková vykonaná práce, ne poslední iterace.
 *
 * TT žije jedno volání: jedna tabulka sdílená napříč iteracemi (starší
 * iterace zlepšuje řazení novější), vytvořená čerstvá zde. Odhad před iterací:
 * nezačínat, když `uplynulo + 2 × trvání poslední iterace > timeMs`. Strom
 * mezi hloubkami roste zhruba 3-6×, faktor 2 je záměrně optimistický:
 * hraniční iteraci raději začne a nechá ji utnout deadline, než aby nechával
 * budget ležet.
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
  const rankRoot = options.rankRoot ?? false;
  const ruleset = options.ruleset ?? AMERICAN_RULESET;
  const tt = new TranspositionTable();

  const start = now();
  const deadline = start + timeMs;

  const firstCtx: SearchCtx = { clock: null, evaluateFn, tt, ruleset, nodes: 0 };
  let result: TimedSearchResult = { ...rootSearch(position, 1, firstCtx, rankRoot), depth: 1 };
  let totalNodes = firstCtx.nodes;
  let lastIterationMs = now() - start;

  for (let depth = 2; depth <= maxDepth; depth++) {
    const iterationStart = now();
    if (iterationStart - start + 2 * lastIterationMs > timeMs) {
      break;
    }
    const ctx: SearchCtx = {
      clock: { now, deadline, nodesUntilCheck: NODES_PER_TIME_CHECK },
      evaluateFn,
      tt,
      ruleset,
      nodes: 0,
    };
    let iteration: SearchResult;
    try {
      iteration = rootSearch(position, depth, ctx, rankRoot);
    } catch (error) {
      if (error instanceof SearchAborted) {
        totalNodes += ctx.nodes; // práce přerušené iterace se do součtu počítá
        break;
      }
      throw error;
    }
    totalNodes += ctx.nodes;
    result = { ...iteration, depth };
    lastIterationMs = now() - iterationStart;
  }
  return { ...result, nodes: totalNodes };
}

/**
 * Vybere tah z výsledku searche podle míry nepozornosti – sdílí ho handler
 * enginu i self-play harness (jeden kontrakt výběru, ne dvě kopie).
 *
 * `carelessness` (0..1) je pravděpodobnost, že se místo nejlepšího tahu zahraje
 * „o úroveň horší" tah (nejlepší z tahů mimo top skóre) – slabší, ale ne
 * náhodně zahozený. Mezi tahy shodného skóre láme `rng` (tie-break).
 *
 * Losování `rng` (pořadí je součást kontraktu – nesmí posunout seedované testy):
 * - `carelessness <= 0` (Profesionál): JEDEN los, čistě tie-break mezi
 *   `bestMoves` – identické s původním chováním handleru,
 * - `carelessness > 0`: nejdřív los „jsem nepozorný?", teprve pak tie-break.
 *
 * `rankedMoves` je POVINNÉ, když `carelessness > 0` (search musí běžet v ranked
 * režimu). Chybí-li, je to programátorská chyba volajícího → RangeError; žádný
 * tichý spád na profesionální hru, který by zamaskoval špatné zapojení.
 */
export function chooseMove(
  bestMoves: readonly Move[],
  rankedMoves: readonly RankedMove[] | undefined,
  carelessness: number,
  rng: () => number,
): Move {
  if (carelessness > 0 && rankedMoves === undefined) {
    throw new RangeError('chooseMove: carelessness > 0 vyžaduje rankedMoves (ranked režim searche).');
  }
  if (carelessness > 0 && rng() < carelessness && rankedMoves !== undefined) {
    const worse = secondBestTier(rankedMoves);
    if (worse.length > 0) {
      return pickByRng(worse, rng);
    }
    // Jediná úroveň skóre → není co pokazit, padá do běžného tie-breaku níž.
  }
  return pickByRng(bestMoves, rng);
}

/**
 * Tahy s NEJVYŠŠÍM skóre pod nejlepším (druhá úroveň). Prázdné, když mají
 * všechny tahy shodné skóre (jediná úroveň – nelze zahrát „o úroveň horší").
 * Očekává `ranked` seřazené sestupně (jak vrací rootSearch).
 */
function secondBestTier(ranked: readonly RankedMove[]): Move[] {
  const first = ranked[0];
  if (first === undefined) {
    return [];
  }
  const bestScore = first.score;
  let secondScore: number | undefined;
  for (const entry of ranked) {
    if (entry.score < bestScore) {
      secondScore = entry.score;
      break;
    }
  }
  if (secondScore === undefined) {
    return [];
  }
  return ranked.filter((entry) => entry.score === secondScore).map((entry) => entry.move);
}

/** Vybere tah seedovaným tie-breakem; rng mimo [0, 1) je programátorská chyba. */
function pickByRng(moves: readonly Move[], rng: () => number): Move {
  const index = Math.floor(rng() * moves.length);
  const move = moves[index];
  if (move === undefined) {
    throw new RangeError(`Výběr tahu: rng vrátil hodnotu mimo [0, 1), index ${String(index)}`);
  }
  return move;
}

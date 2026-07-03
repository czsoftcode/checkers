/**
 * Self-play harness fáze 16 – nástroj pro SROVNÁNÍ dvou evaluací, ne součást
 * protokolu enginu. Proto NENÍ v public API balíčku (index.ts ho nereexportuje);
 * importuje ho jen gate skript a jeho testy.
 *
 * Princip brány (viz .mini/discuss/phase-016.md): dáma je při dobré hře remíza,
 * takže dvě podobné evaluace většinou remizují. Aby se rozdíl vůbec projevil:
 * - PÁROVANÁ zahájení: každé náhodné zahájení se odehraje DVAKRÁT s prohozenými
 *   barvami (color swap) → odečte se výhoda tahu,
 * - FIXNÍ HLOUBKA (ne čas): srovnání kvality evaluace, ne její rychlosti
 *   (dražší evaluace by na čas prohrála i kdyby byla chytřejší).
 */

import {
  advanceState,
  gameResultFromState,
  initialGameState,
  legalMoves,
} from '@checkers/rules';
import type { Color, GameResult, GameState } from '@checkers/rules';

import { mulberry32 } from './prng.js';
import { searchRoot } from './search.js';
import type { EvalFn } from './search.js';

/**
 * Tvrdý strop délky partie – pojistka proti chybě, ne herní pravidlo.
 * Remízová pravidla (80 půltahů bez pokroku, opakování) ukončí partii dávno
 * dřív; přetečení stropu = rozbitá terminace (throw), ne remíza.
 */
export const MAX_SELFPLAY_PLIES = 20_000;

/**
 * Vyrobí jedno zahájení: `plies` náhodných legálních půltahů od výchozí
 * pozice, seedovaně (reprodukovatelně). Vrací stav PO zahájení, který se
 * pak odehraje z obou barev.
 *
 * Skončí-li partie během zahájení (nemělo by při malém `plies` nastat),
 * vyhodí Error – rozehrané, ale UŽ ROZHODNUTÉ zahájení nejde férově hrát
 * z obou stran, tiše ho přeskočit by zkreslilo bránu.
 */
export function generateOpening(seed: number, plies: number): GameState {
  if (!Number.isInteger(plies) || plies < 0) {
    throw new RangeError(`Neplatný počet půltahů zahájení: ${String(plies)}`);
  }
  const rng = mulberry32(seed);
  let state = initialGameState();
  for (let i = 0; i < plies; i++) {
    if (gameResultFromState(state) !== 'ongoing') {
      throw new Error(
        `Zahájení (seed ${String(seed)}) skončilo už po ${String(i)} půltazích – zvol menší plies`,
      );
    }
    const moves = legalMoves(state.position);
    const move = moves[Math.floor(rng() * moves.length)];
    if (move === undefined) {
      throw new RangeError(`generateOpening: index tahu mimo rozsah (seed ${String(seed)})`);
    }
    state = advanceState(state, move);
  }
  if (gameResultFromState(state) !== 'ongoing') {
    throw new Error(
      `Zahájení (seed ${String(seed)}) je už rozhodnuté – nelze hrát z obou barev`,
    );
  }
  return state;
}

/**
 * `count` deterministicky odlišných zahájení (seed = `baseSeed + i`).
 * Kolize (dvě zahájení shodná) jsou při různých seedech nepravděpodobné a
 * pro bránu jen mírný šum, ne chyba.
 */
export function generateOpenings(baseSeed: number, count: number, plies: number): GameState[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`Neplatný počet zahájení: ${String(count)}`);
  }
  const openings: GameState[] = [];
  for (let i = 0; i < count; i++) {
    openings.push(generateOpening(baseSeed + i, plies));
  }
  return openings;
}

/** Čas a počet tahů odehraných KAŽDOU barvou (podklad telemetrie rychlosti). */
interface GameStats {
  readonly result: GameResult;
  readonly msByColor: Record<Color, number>;
  readonly movesByColor: Record<Color, number>;
}

/**
 * Odehraje jednu partii z daného zahájení na FIXNÍ hloubce. Každá barva má
 * vlastní evaluaci; tah se vybírá `searchRoot` a při shodě skóre se láme
 * seedovaným `rng` (stejný princip jako handler enginu). Remízová pravidla
 * a konec hry řeší `GameState` (kontrakt rules), ne vlastní logika.
 *
 * Přetečení tvrdého stropu = rozbitá terminace (throw), ne remíza.
 */
function playFixedDepthGame(
  start: GameState,
  blackEval: EvalFn,
  whiteEval: EvalFn,
  depth: number,
  rng: () => number,
): GameStats {
  let state = start;
  const msByColor: Record<Color, number> = { black: 0, white: 0 };
  const movesByColor: Record<Color, number> = { black: 0, white: 0 };

  for (let ply = 0; ply < MAX_SELFPLAY_PLIES; ply++) {
    const result = gameResultFromState(state);
    if (result !== 'ongoing') {
      return { result, msByColor, movesByColor };
    }
    const color = state.position.turn;
    const evalFn = color === 'black' ? blackEval : whiteEval;

    const started = performance.now();
    const { bestMoves } = searchRoot(state.position, depth, evalFn);
    msByColor[color] += performance.now() - started;
    movesByColor[color] += 1;

    const move = bestMoves[Math.floor(rng() * bestMoves.length)];
    if (move === undefined) {
      throw new RangeError('playFixedDepthGame: rng mimo [0, 1) nebo prázdné bestMoves');
    }
    state = advanceState(state, move);
  }
  throw new Error(
    `Partie nedosáhla konce ani po ${String(MAX_SELFPLAY_PLIES)} půltazích – rozbitá terminace`,
  );
}

/** Nastavení zápasu dvou evaluací. */
export interface MatchOptions {
  /** Zkoumaná („nová") evaluace. */
  readonly newEval: EvalFn;
  /** Referenční („stará") evaluace. */
  readonly oldEval: EvalFn;
  /** Zahájení; každé se odehraje dvakrát (nová jako černá, pak jako bílá). */
  readonly openings: readonly GameState[];
  /** Fixní hloubka prohledávání pro obě strany. */
  readonly depth: number;
  /** Seed pro tie-break; každá partie dostane odvozený seed (reprodukovatelné). */
  readonly seed: number;
}

/** Výsledek zápasu z pohledu NOVÉ evaluace. */
export interface MatchResult {
  readonly games: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  /** Skóre nové evaluace: výhra 1, remíza 0,5. */
  readonly score: number;
  /** Skóre / počet partií (0..1); 0,5 = vyrovnané. */
  readonly scoreRate: number;
  /** Telemetrie rychlosti (informativní, NENÍ kritérium brány). */
  readonly newMs: number;
  readonly newMoves: number;
  readonly oldMs: number;
  readonly oldMoves: number;
}

/** Zapíše výsledek jedné partie do tally z pohledu nové evaluace. */
function tally(
  result: GameResult,
  newColor: Color,
  acc: { wins: number; draws: number; losses: number },
): void {
  if (result === 'draw') {
    acc.draws += 1;
    return;
  }
  const newWon = (newColor === 'black' && result === 'black-wins') ||
    (newColor === 'white' && result === 'white-wins');
  if (newWon) {
    acc.wins += 1;
  } else {
    acc.losses += 1;
  }
}

/**
 * Sehraje párovaný zápas: každé zahájení dvakrát s prohozenými barvami
 * (color swap) → odečte se výhoda tahu. Vrací skóre a telemetrii z pohledu
 * NOVÉ evaluace. Deterministické: stejné vstupy = stejný výsledek.
 *
 * Pozn.: tie-break seed je odvozen od `seed` a indexu partie, aby dvě
 * partie páru nebyly svázané stejnou náhodou, ale celek zůstal reprodukovatelný.
 */
export function runMatch(options: MatchOptions): MatchResult {
  const { newEval, oldEval, openings, depth, seed } = options;
  const acc = { wins: 0, draws: 0, losses: 0 };
  let newMs = 0;
  let newMoves = 0;
  let oldMs = 0;
  let oldMoves = 0;

  openings.forEach((opening, i) => {
    // Partie A: nová hraje černou, stará bílou.
    const a = playFixedDepthGame(opening, newEval, oldEval, depth, mulberry32(seed + 2 * i));
    tally(a.result, 'black', acc);
    newMs += a.msByColor.black;
    newMoves += a.movesByColor.black;
    oldMs += a.msByColor.white;
    oldMoves += a.movesByColor.white;

    // Partie B: prohození barev – nová hraje bílou, stará černou.
    const b = playFixedDepthGame(opening, oldEval, newEval, depth, mulberry32(seed + 2 * i + 1));
    tally(b.result, 'white', acc);
    newMs += b.msByColor.white;
    newMoves += b.movesByColor.white;
    oldMs += b.msByColor.black;
    oldMoves += b.movesByColor.black;
  });

  const games = openings.length * 2;
  const score = acc.wins + 0.5 * acc.draws;
  return {
    games,
    wins: acc.wins,
    draws: acc.draws,
    losses: acc.losses,
    score,
    scoreRate: score / games,
    newMs,
    newMoves,
    oldMs,
    oldMoves,
  };
}

export type { Color, GameResult, GameState, EvalFn };

/**
 * Brána fáze 101: cena létavé dámy reálně teče do VÝBĚRU TAHU (ne jen do
 * evaluace izolovaně) a AI ve flying variantě si dámu nedá vzít za muže.
 *
 * Dvě části:
 *  A) Cílený deterministický search (`searchRoot`, bez hodin) na jedné crafted
 *     pozici, s IZOLOVANOU cenou: pravidla generování tahů držíme PEVNÁ (stejný
 *     moveGen ruleset), jedinou proměnnou mezi dvěma běhy je cena dámy – přes
 *     injektovaný `evalFn` (short 130 vs flying 300). Kdyby se cena rozbila
 *     (flying by dostala 130), obě `evalFn` splynou v jednu funkci → search dá
 *     identický tah → aserce „tah se liší" spadne. To je ta ZUB testu: měří
 *     dopad CENY, ne dopad pravidel (dřívější verze mísila obojí a byla slepá).
 *  B) Self-play sanity: engine v pool variantě (flying) porazí náhodného hráče a
 *     nic neprohraje – celá produkční cesta `searchTimed(..., {ruleset})` s
 *     létavou dámou nedělá zjevné blbosti. POZOR: část B NEmá zuby na cenu
 *     (engine porazí random i s cenou 130) – je to sanity celé flying cesty,
 *     ne důkaz ceny; ten nese část A.
 *
 * Pozice v části A byla NALEZENA empiricky (hledáním nad náhodnými flying
 * pozicemi), ne odhadem od stolu.
 */

import {
  advanceState,
  applyMove,
  AMERICAN_RULESET,
  CZECH_RULESET,
  gameResultFromState,
  initialGameState,
  legalMoves,
  POOL_RULESET,
  RUSSIAN_RULESET,
} from '@checkers/rules';
import type { Color, GameResult, Move, Position, Ruleset } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { evaluate, searchRoot } from '../src/index.js';
import type { EvalFn } from '../src/index.js';
import { mulberry32 } from '../src/prng.js';
import { makePosition } from './support/position.js';

/** Kolik černých dam je na desce. */
function blackKings(board: Position['board']): number {
  let n = 0;
  for (const cell of board) {
    if (cell !== null && cell !== undefined && cell.kind === 'king' && cell.color === 'black') {
      n++;
    }
  }
  return n;
}

/** Nejlepší tah černého při daných pravidlech a dané (injektované) evaluaci. */
function bestMove(position: Position, moveGen: Ruleset, evalFn: EvalFn, depth: number): Move {
  const mv = searchRoot(position, depth, evalFn, null, false, moveGen).bestMoves[0];
  if (mv === undefined) {
    throw new Error('searchRoot: pozice bez tahu');
  }
  return mv;
}

/**
 * Deterministické self-play (obě strany stejná `evalFn` i pravidla) `plies`
 * půltahů; vrátí, kolik černých DAM zbude. Bez hodin (searchRoot), takže
 * výsledek nezávisí na rychlosti stroje.
 */
function blackKingsAfterSelfPlay(
  position: Position,
  moveGen: Ruleset,
  evalFn: EvalFn,
  depth: number,
  plies: number,
): number {
  let p = position;
  for (let i = 0; i < plies; i++) {
    if (legalMoves(p, moveGen).length === 0) {
      break;
    }
    const mv = searchRoot(p, depth, evalFn, null, false, moveGen).bestMoves[0];
    if (mv === undefined) {
      break;
    }
    p = applyMove(p, mv, moveGen);
  }
  return blackKings(p.board);
}

describe('cílený search: cena dámy (izolovaně) mění výběr tahu', () => {
  // Crafted pozice (černý na tahu, dáma na poli 27). Nalezeno empiricky.
  const position = makePosition('black', {
    3: 'bm',
    4: 'wm',
    9: 'bm',
    10: 'wm',
    11: 'wm',
    13: 'bm',
    20: 'wk',
    25: 'wm',
    27: 'bk',
    31: 'wm',
  });
  const DEPTH = 4;

  // Dvě evaluace, které se liší VÝHRADNĚ cenou dámy: `evaluate` čte z rulesetu
  // jen pole `king` (american → short 130, pool → flying 300); všechny ostatní
  // složky jsou totožné. Pravidla generování tahů (moveGen) přitom držíme pevná,
  // takže jediná proměnná mezi short a flying během je CENA DÁMY.
  const evalShort: EvalFn = (p) => evaluate(p, AMERICAN_RULESET);
  const evalFlying: EvalFn = (p) => evaluate(p, POOL_RULESET);

  const flyingMoveGen: ReadonlyArray<readonly [string, Ruleset]> = [
    ['pool', POOL_RULESET],
    ['ruská', RUSSIAN_RULESET],
    ['česká', CZECH_RULESET],
  ];

  it.each(flyingMoveGen)('flying cena volí JINÝ tah než short (pravidla %s pevná)', (_name, moveGen) => {
    const short = bestMove(position, moveGen, evalShort, DEPTH);
    const flying = bestMove(position, moveGen, evalFlying, DEPTH);
    const same = short.from === flying.from && JSON.stringify(short.path) === JSON.stringify(flying.path);
    // Rozbitá cena (flying = 130) by obě evalFn slila v jednu → same === true → spadne.
    expect(same).toBe(false);
  });

  it('flying cena dámu podrží, short ji obětuje (pool, 6 půltahů self-play)', () => {
    // Stejná pravidla (pool), jediný rozdíl je cena dámy. Short vede k dohře, kde
    // černý o dámu přijde (0), flying si ji udrží (1).
    expect(blackKingsAfterSelfPlay(position, POOL_RULESET, evalShort, DEPTH, 6)).toBe(0);
    expect(blackKingsAfterSelfPlay(position, POOL_RULESET, evalFlying, DEPTH, 6)).toBe(1);
  });
});

describe('self-play sanity: pool engine vs random', () => {
  const GAMES = 20;
  const TIME_MS = 25;
  const MAX_PLIES = 300;
  const MIN_WINS = 15; // rezerva na variabilitu stroje; klíčové je 0 proher

  it(
    `${String(GAMES)} partií pool (flying): 0 proher, >= ${String(MIN_WINS)} výher`,
    async () => {
      // searchTimed měří reálný čas → import jen zde, ať se strom neimportuje zbytečně.
      const { searchTimed } = await import('../src/index.js');

      let wins = 0;
      let losses = 0;
      let draws = 0;
      const outcomes: string[] = [];

      for (let game = 0; game < GAMES; game++) {
        const engineColor: Color = game % 2 === 0 ? 'black' : 'white';
        const engineRng = mulberry32(game + 1);
        const randomRng = mulberry32(game + 10_001);
        let state = initialGameState(undefined, 'pool');
        let result: GameResult = 'ongoing';

        for (let ply = 0; ply < MAX_PLIES; ply++) {
          result = gameResultFromState(state);
          if (result !== 'ongoing') {
            break;
          }
          const onTurn = state.position.turn === engineColor;
          let move: Move;
          if (onTurn) {
            const { bestMoves } = searchTimed(state.position, { timeMs: TIME_MS, ruleset: POOL_RULESET });
            const picked = bestMoves[Math.floor(engineRng() * bestMoves.length)];
            if (picked === undefined) {
              throw new RangeError('engine: bestMoves prázdné');
            }
            // Nezávislé ověření legality (nedůvěřuj searchi).
            expect(legalMoves(state.position, POOL_RULESET)).toContainEqual(picked);
            move = picked;
          } else {
            const moves = legalMoves(state.position, POOL_RULESET);
            const picked = moves[Math.floor(randomRng() * moves.length)];
            if (picked === undefined) {
              throw new RangeError('random: pozice bez tahů');
            }
            move = picked;
          }
          state = advanceState(state, move);
        }
        if (result === 'ongoing') {
          result = 'draw';
        }

        const engineWin: GameResult = engineColor === 'black' ? 'black-wins' : 'white-wins';
        if (result === engineWin) {
          wins++;
        } else if (result === 'draw') {
          draws++;
        } else {
          losses++;
        }
        outcomes.push(`partie ${String(game + 1)} (engine ${engineColor}): ${result}`);
      }

      const summary = outcomes.join('\n');
      expect.soft(losses, `Engine prohrál v pool:\n${summary}`).toBe(0);
      expect(
        wins,
        `Málo výher pool (${String(wins)}/${String(GAMES)}, remíz ${String(draws)}):\n${summary}`,
      ).toBeGreaterThanOrEqual(MIN_WINS);
    },
    600_000,
  );
});

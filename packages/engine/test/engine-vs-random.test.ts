/**
 * Brána M3 (fáze 15): engine hraje 100 partií proti náhodnému hráči se
 * střídáním barev. Volá se searchTimed + tie-break rng, tedy stejná
 * dvojice, kterou skládá handler; samotný handler (validace, JSON) kryjí
 * handler.test.ts a engine-process.test.ts.
 *
 * Kritéria brány:
 * - engine vyhraje >= 95 partií ze 100 (a nic neprohraje),
 * - KAŽDÝ jeho tah je prvkem legalMoves (kontrola nezávislým voláním
 *   generátoru v testu, ne důvěrou v search),
 * - doba ŽÁDNÉHO tahu nepřekročí tvrdý strop TIME_MS + 500 ms (sladěno
 *   s plánovanou orchestrací M4: kill procesu při timeMs + 500).
 *
 * Na rozdíl od brány fáze 14 už běh NENÍ plně deterministický: searchTimed
 * měří skutečný čas, takže dosažená hloubka (a tedy i vybrané tahy) závisí
 * na rychlosti stroje. Prahy jsou proto voleny s velkou rezervou – engine
 * na hloubce ~4+ proti náhodnému hráči neprohrává; kdyby brána spadla,
 * je to signál chyby v searchi, ne důvod prahy povolit.
 */

import { advanceState, gameResultFromState, initialGameState, legalMoves } from '@checkers/rules';
import type { Color, GameResult, Move, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../src/prng.js';
import { searchTimed } from '../src/search.js';

/** Strop půltahů na partii – pojistka proti nekonečné hře; přes remízová
 * pravidla (80 bez pokroku, opakování) by se sem partie dostat neměla. */
const MAX_PLIES = 300;

/** Měkký limit na tah enginu; malý, ať 100 partií doběhne v minutách. */
const TIME_MS = 25;

/** Tvrdý strop odezvy = timeMs + 500 (kontrakt orchestrace M4). */
const HARD_TIMEOUT_MS = TIME_MS + 500;

const GAMES = 100;
const MIN_WINS = 95;

type Strategy = (position: Position) => Move;

/** Telemetrie běhu: rozložení hloubek a nejpomalejší tah. */
interface Telemetry {
  readonly depthCounts: Map<number, number>;
  maxMoveMs: number;
  moves: number;
  hardTimeoutViolations: string[];
}

function engineStrategy(rng: () => number, telemetry: Telemetry): Strategy {
  return (position) => {
    const started = performance.now();
    const { bestMoves, depth } = searchTimed(position, { timeMs: TIME_MS });
    const elapsed = performance.now() - started;

    telemetry.moves += 1;
    telemetry.maxMoveMs = Math.max(telemetry.maxMoveMs, elapsed);
    telemetry.depthCounts.set(depth, (telemetry.depthCounts.get(depth) ?? 0) + 1);
    if (elapsed >= HARD_TIMEOUT_MS) {
      telemetry.hardTimeoutViolations.push(`tah ${String(telemetry.moves)}: ${elapsed.toFixed(1)} ms`);
    }

    const move = bestMoves[Math.floor(rng() * bestMoves.length)];
    if (move === undefined) {
      throw new RangeError('engineStrategy: rng mimo [0, 1)');
    }
    return move;
  };
}

function randomStrategy(rng: () => number): Strategy {
  return (position) => {
    const moves = legalMoves(position);
    const move = moves[Math.floor(rng() * moves.length)];
    if (move === undefined) {
      throw new RangeError('randomStrategy: pozice bez tahů, nebo rng mimo [0, 1)');
    }
    return move;
  };
}

/** Odehraje partii; každý tah enginu se ověřuje členstvím v legalMoves. */
function playGame(engineColor: Color, seed: number, telemetry: Telemetry): GameResult {
  const engine = engineStrategy(mulberry32(seed), telemetry);
  const random = randomStrategy(mulberry32(seed + 10_000));
  let state = initialGameState();
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const result = gameResultFromState(state);
    if (result !== 'ongoing') {
      return result;
    }
    const engineOnTurn = state.position.turn === engineColor;
    const move = engineOnTurn ? engine(state.position) : random(state.position);
    if (engineOnTurn) {
      expect(legalMoves(state.position)).toContainEqual(move);
    }
    state = advanceState(state, move);
  }
  // Strop dosažen – pro účely brány počítáme jako remízu (ne prohru enginu).
  return 'draw';
}

describe('brána M3: engine vs random hráč s časovou kontrolou', () => {
  it(
    `${String(GAMES)} partií (střídání barev): >= ${String(MIN_WINS)} výher, žádný tah přes tvrdý timeout`,
    () => {
      const telemetry: Telemetry = {
        depthCounts: new Map(),
        maxMoveMs: 0,
        moves: 0,
        hardTimeoutViolations: [],
      };
      let wins = 0;
      let losses = 0;
      let draws = 0;
      const outcomes: string[] = [];
      for (let game = 0; game < GAMES; game++) {
        // Střídání barev po partii: sudá = černé (engine začíná), lichá = bílé.
        const engineColor: Color = game % 2 === 0 ? 'black' : 'white';
        const result = playGame(engineColor, game + 1, telemetry);
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

      const depthSummary = [...telemetry.depthCounts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([depth, count]) => `hloubka ${String(depth)}: ${String(count)}×`)
        .join(', ');
      // Telemetrie do výstupu testu – doklad, že prohlubování reálně pracuje.
      // process.stdout.write místo console.log: ten vitest v tichém režimu polyká.
      process.stdout.write(
        `brána M3: výher ${String(wins)}, remíz ${String(draws)}, proher ${String(losses)}; ` +
          `tahů enginu ${String(telemetry.moves)}, nejpomalejší ${telemetry.maxMoveMs.toFixed(1)} ms; ${depthSummary}\n`,
      );

      const summary = outcomes.join('\n');
      expect.soft(losses, `Engine prohrál partii:\n${summary}`).toBe(0);
      expect
        .soft(
          telemetry.hardTimeoutViolations,
          `Tahy přes tvrdý strop ${String(HARD_TIMEOUT_MS)} ms:\n${telemetry.hardTimeoutViolations.join('\n')}`,
        )
        .toEqual([]);
      expect(
        wins,
        `Málo výher (${String(wins)}/${String(GAMES)}, remíz ${String(draws)}, proher ${String(losses)}):\n${summary}`,
      ).toBeGreaterThanOrEqual(MIN_WINS);
    },
    600_000,
  );
});

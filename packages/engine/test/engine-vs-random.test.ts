/**
 * Brána fáze 14: engine (searchRoot na SEARCH_DEPTH – přesně to, co běží
 * v handleru) hraje série partií proti náhodnému hráči.
 *
 * Kritéria: engine v žádné partii neprohraje, vyhraje jasnou většinu
 * a KAŽDÝ jeho tah je prvkem legalMoves (kontrola nezávislým voláním
 * generátoru v testu, ne důvěrou v search).
 *
 * Vše je seedované → běh je deterministický; prahy tedy nejsou statistika,
 * ale přibitý výsledek. Kdyby po změně enginu spadly, je to signál chyby
 * v searchi (typicky znaménko), ne důvod prahy povolit.
 */

import { advanceState, gameResultFromState, initialGameState, legalMoves } from '@checkers/rules';
import type { Color, GameResult, Move, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../src/prng.js';
import { SEARCH_DEPTH, searchRoot } from '../src/search.js';

/** Strop půltahů na partii – pojistka proti nekonečné hře; přes remízová
 * pravidla (80 bez pokroku, opakování) by se sem partie dostat neměla. */
const MAX_PLIES = 300;

type Strategy = (position: Position) => Move;

function engineStrategy(rng: () => number): Strategy {
  return (position) => {
    const { bestMoves } = searchRoot(position, SEARCH_DEPTH);
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
function playGame(engineColor: Color, seed: number): GameResult {
  const engine = engineStrategy(mulberry32(seed));
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

describe('brána M3: engine vs random hráč', () => {
  it(
    '12 partií (6 za černé, 6 za bílé): žádná prohra, aspoň 10 výher',
    () => {
      let wins = 0;
      let losses = 0;
      let draws = 0;
      const outcomes: string[] = [];
      for (let game = 0; game < 12; game++) {
        const engineColor: Color = game < 6 ? 'black' : 'white';
        const result = playGame(engineColor, game + 1);
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
      expect.soft(losses, `Engine prohrál partii:\n${summary}`).toBe(0);
      expect(wins, `Málo výher (${String(wins)}/12, remíz ${String(draws)}):\n${summary}`).toBeGreaterThanOrEqual(10);
    },
    120_000,
  );
});

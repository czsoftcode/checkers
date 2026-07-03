import { describe, expect, it } from 'vitest';

import type { GameState } from '../src/index.js';
import {
  advanceState,
  formatMove,
  gameResultFromState,
  initialGameState,
  legalMoves,
  parseMove,
} from '../src/index.js';
import { mulberry32 } from './support/prng.js';

const GAMES = 20;
const MAX_PLIES = 5000;

describe('round-trip notace nad reálnými tahy', () => {
  it('každý legální tah navštívených pozic přežije Move → text → Move', () => {
    let checked = 0;
    for (let game = 0; game < GAMES; game++) {
      const random = mulberry32(2000 + game);
      let state: GameState = initialGameState();
      let plies = 0;
      while (gameResultFromState(state) === 'ongoing' && plies < MAX_PLIES) {
        const moves = legalMoves(state.position);
        for (const move of moves) {
          const text = formatMove(move);
          expect(parseMove(text), `tah ${text} se nevrátil identický`).toEqual(move);
        }
        checked += moves.length;
        const move = moves[Math.floor(random() * moves.length)];
        if (move === undefined) {
          throw new Error('PRNG vybral index mimo seznam tahů');
        }
        state = advanceState(state, move);
        plies += 1;
      }
    }
    // Pojistka proti tichému zdegenerování testu (např. 0 iterací).
    expect(checked).toBeGreaterThan(1000);
  });
});

import { describe, expect, it } from 'vitest';

import type { GameResult, GameState } from '../src/index.js';
import { advanceState, gameResultFromState, initialGameState, legalMoves } from '../src/index.js';

/**
 * Mulberry32 – malý deterministický PRNG. Test NESMÍ používat Math.random:
 * se seedem je každý běh stejný, takže zelený test zůstane zelený.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tvrdá mez půltahů na partii. Teoretická horní mez plynoucí z pravidla
 * 80 půltahů je ~16 000 (počet možných „pokroků" × 80); náhodné partie
 * reálně končí do pár set půltahů. 5000 je bezpečný strop – jeho přelezení
 * znamená rozbitou detekci konce, ne smůlu.
 */
const MAX_PLIES = 5000;
const GAMES = 50;

describe('terminace – random vs random vždy skončí', () => {
  it(`${String(GAMES)} seedovaných partií skončí do ${String(MAX_PLIES)} půltahů`, () => {
    const results = new Map<GameResult, number>();
    for (let game = 0; game < GAMES; game++) {
      const random = mulberry32(1000 + game);
      let state: GameState = initialGameState();
      let result = gameResultFromState(state);
      let plies = 0;
      while (result === 'ongoing' && plies < MAX_PLIES) {
        const moves = legalMoves(state.position);
        // Kontrakt fáze 7: ongoing znamená, že tah existuje.
        expect(moves.length).toBeGreaterThan(0);
        const move = moves[Math.floor(random() * moves.length)];
        if (move === undefined) {
          throw new Error('PRNG vybral index mimo seznam tahů');
        }
        state = advanceState(state, move);
        result = gameResultFromState(state);
        plies += 1;
      }
      expect(result, `partie ${String(game)} neskončila do ${String(MAX_PLIES)} půltahů`).not.toBe(
        'ongoing',
      );
      results.set(result, (results.get(result) ?? 0) + 1);
    }
    // Kontrola smyslu, ne přesných čísel: mezi 50 náhodnými partiemi se
    // musí objevit aspoň dva různé výsledky (jen jeden = podezřelý bias).
    expect(results.size).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Random hráč: vybírá rovnoměrně z legálních tahů přes dodaný PRNG.
 */

import type { Strategy } from './game.js';

/**
 * Strategie vybírající rovnoměrně náhodný legální tah. PRNG se předává
 * zvenčí (seedovaný mulberry32), aby byla partie reprodukovatelná.
 */
export function randomPlayer(rng: () => number): Strategy {
  return (_state, moves) => {
    if (moves.length === 0) {
      throw new RangeError('Random hráč dostal prázdný seznam tahů – konec hry má poznat smyčka');
    }
    const index = Math.floor(rng() * moves.length);
    const move = moves[index];
    if (move === undefined) {
      // rng mimo kontrakt [0, 1) – index utekl za konec seznamu.
      throw new RangeError(`Random hráč: rng vrátil hodnotu mimo [0, 1), index ${String(index)}`);
    }
    return move;
  };
}

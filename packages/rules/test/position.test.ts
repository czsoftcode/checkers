import { describe, expect, it } from 'vitest';

import { initialPosition } from '../src/index.js';

describe('initialPosition', () => {
  it('má černé muže na 1-12, prázdno na 13-20, bílé muže na 21-32', () => {
    const { board } = initialPosition();
    expect(board).toHaveLength(32);
    for (let square = 1; square <= 32; square++) {
      const cell = board[square - 1];
      if (square <= 12) {
        expect(cell, `pole ${String(square)}`).toEqual({ color: 'black', kind: 'man' });
      } else if (square <= 20) {
        expect(cell, `pole ${String(square)}`).toBeNull();
      } else {
        expect(cell, `pole ${String(square)}`).toEqual({ color: 'white', kind: 'man' });
      }
    }
  });

  it('na tahu je černý (táhne v partii první)', () => {
    expect(initialPosition().turn).toBe('black');
  });

  it('každé volání vrací nezávislou pozici (žádný sdílený stav)', () => {
    const a = initialPosition();
    const b = initialPosition();
    expect(a).not.toBe(b);
    expect(a.board).not.toBe(b.board);
  });
});

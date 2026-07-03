/**
 * Vytváření pozic.
 */

import { BOARD_SQUARES } from './board.js';
import type { Cell, Position } from './types.js';

/**
 * Výchozí rozestavění americké dámy: černí muži na polích 1–12 (horní tři
 * řady), bílí muži na 21–32 (dolní tři řady), pole 13–20 prázdná.
 * Černý je na tahu (táhne v partii první).
 */
export function initialPosition(): Position {
  const board: Cell[] = [];
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    if (square <= 12) {
      board.push({ color: 'black', kind: 'man' });
    } else if (square >= 21) {
      board.push({ color: 'white', kind: 'man' });
    } else {
      board.push(null);
    }
  }
  return { board, turn: 'black' };
}

/**
 * Textové vykreslení pozice do terminálu.
 *
 * Kódování kamenů je stejné jako v `positionKey` z rules: `m`/`k` černý
 * muž/dáma, `M`/`K` bílý muž/dáma. Prázdná tmavá pole ukazují své PDN
 * číslo 1–32, aby měl člověk čísla polí pro zadání tahu přímo před sebou;
 * světlá (nehrací) pole kreslí tečku.
 */

import { BOARD_SIZE, coordsToSquare, isDarkSquare } from '@checkers/rules';
import type { Piece, Position } from '@checkers/rules';

function pieceCode(piece: Piece): string {
  const code = piece.kind === 'man' ? 'm' : 'k';
  return piece.color === 'black' ? code : code.toUpperCase();
}

/**
 * Vykreslí pozici jako 8 řádků textu (bez koncového \n). Řádek 0 je
 * zadní řada černého (pole 1–4), řádek 7 zadní řada bílého (29–32).
 * Poškozenou desku (chybějící pole) odmítá RangeError.
 */
export function renderPosition(position: Position): string {
  const lines: string[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    let line = '';
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!isDarkSquare(row, col)) {
        line += ' · ';
        continue;
      }
      const square = coordsToSquare(row, col);
      const cell = position.board[square - 1];
      if (cell === undefined) {
        throw new RangeError(`Poškozená pozice: chybí pole ${String(square)}`);
      }
      line += cell === null ? `${String(square).padStart(2)} ` : ` ${pieceCode(cell)} `;
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

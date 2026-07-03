/**
 * Testovací stavba pozic: čitelný zápis kamenů místo ručního skládání
 * pole 32 buněk. Jen pro testy – produkční kód dostává pozice z protokolu
 * nebo z applyMove.
 */

import { applyMove, initialPosition, legalMoves } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';

import { mulberry32 } from '../../src/prng.js';

/** Kód kamene: barva (b/w) + druh (m = muž, k = dáma). */
export type PieceCode = 'bm' | 'bk' | 'wm' | 'wk';

/** Postaví pozici z mapy `{ číslo pole: kód kamene }`. */
export function makePosition(turn: Color, pieces: Record<number, PieceCode>): Position {
  const board: Cell[] = Array.from({ length: 32 }, () => null);
  for (const [square, code] of Object.entries(pieces)) {
    board[Number(square) - 1] = {
      color: code.startsWith('b') ? 'black' : 'white',
      kind: code.endsWith('m') ? 'man' : 'king',
    };
  }
  return { board, turn };
}

/**
 * Zrcadlo pozice: otočení desky o 180° (pole s → 33 − s) + prohození barev.
 * `turn` se předává explicitně, aby šly testovat obě symetrie evaluace
 * (stejná strana na tahu → opačné skóre; prohození i tahu → stejné skóre).
 */
export function mirrorPosition(position: Position, turn: Color): Position {
  const board: Cell[] = Array.from({ length: 32 }, () => null);
  for (let square = 1; square <= 32; square++) {
    const cell = position.board[square - 1];
    if (cell === null || cell === undefined) {
      continue;
    }
    board[32 - square] = {
      color: cell.color === 'black' ? 'white' : 'black',
      kind: cell.kind,
    };
  }
  return { board, turn };
}

/**
 * Rozehraná pozice: `plies` náhodných legálních půltahů od výchozí pozice
 * (seedované, reprodukovatelné). Skončí-li partie dřív, vrací poslední
 * pozici, která ještě měla legální tahy.
 */
export function randomPlayedPosition(seed: number, plies: number): Position {
  const rng = mulberry32(seed);
  let position = initialPosition();
  for (let i = 0; i < plies; i++) {
    const moves = legalMoves(position);
    if (moves.length === 0) {
      break;
    }
    const move = moves[Math.floor(rng() * moves.length)];
    if (move === undefined) {
      throw new RangeError('randomPlayedPosition: index tahu mimo rozsah');
    }
    const next = applyMove(position, move);
    if (legalMoves(next).length === 0) {
      break;
    }
    position = next;
  }
  return position;
}

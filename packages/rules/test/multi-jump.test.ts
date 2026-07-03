import { describe, expect, it } from 'vitest';

import type { Cell, Color, Position } from '../src/index.js';
import { legalMoves } from '../src/index.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };
const BLACK_KING: Cell = { color: 'black', kind: 'king' };

describe('vícenásobný skok – větvení', () => {
  it('z jednoho dopadu dva směry = dva samostatné tahy', () => {
    // Černý muž 9 bere přes 14 na 18; z 18 se větví: přes 22 na 25, nebo přes 23 na 27.
    const position = positionWith(
      [
        [9, BLACK_MAN],
        [14, WHITE_MAN],
        [22, WHITE_MAN],
        [23, WHITE_MAN],
      ],
      'black',
    );
    expect(legalMoves(position)).toEqual([
      { from: 9, path: [18, 25], captures: [14, 22] },
      { from: 9, path: [18, 27], captures: [14, 23] },
    ]);
  });

  it('kratší větev z rozcestí je legální vedle delší (maximum braní se nevyžaduje)', () => {
    // Černý muž 10: větev přes 14 pokračuje na 2 braní (10x17x26),
    // větev přes 15 končí po 1 braní (10x19). Obě jsou legální.
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
        [22, WHITE_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    const moves = legalMoves(position);
    expect(moves).toEqual([
      { from: 10, path: [17, 26], captures: [14, 22] },
      { from: 10, path: [19], captures: [15] },
    ]);
  });

  it('prefix, ze kterého jde brát dál, v množině tahů NENÍ', () => {
    // Stejná pozice: zastavit na 17 (jen 1 braní na větvi přes 14) je nelegální.
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
        [22, WHITE_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    const endsAt17 = legalMoves(position).some((m) => m.path[m.path.length - 1] === 17);
    expect(endsAt17).toBe(false);
  });
});

describe('vícenásobný skok – muž nebere vzad', () => {
  it('první skok muže vzad neexistuje', () => {
    // Černý muž na 18: vpřed (SW) bere přes 22 na 25; vzad (NE) přes 15
    // na 11 by brala jen dáma. Jediný legální tah je 18x25.
    const position = positionWith(
      [
        [18, BLACK_MAN],
        [22, WHITE_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    expect(legalMoves(position)).toEqual([{ from: 18, path: [25], captures: [22] }]);
  });

  it('sekvence muže nepokračuje braním vzad z pole dopadu', () => {
    // Černý muž 9 bere přes 14 na 18. Z 18 stojí bílý na 15 (vzad, NE) –
    // dáma by pokračovala 18x11, muž musí skončit na 18.
    const position = positionWith(
      [
        [9, BLACK_MAN],
        [14, WHITE_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    const moves = legalMoves(position);
    expect(moves).toEqual([{ from: 9, path: [18], captures: [14] }]);
    expect(moves.some((m) => m.path.includes(11))).toBe(false);
  });
});

describe('vícenásobný skok – kruh dámy a zákaz dvojího přeskočení', () => {
  it('dáma obkrouží kruh 4 kamenů oběma směry a vrátí se na výchozí pole', () => {
    // Černá dáma na 18, bílí muži na 6, 7, 14, 15 tvoří kruh:
    // 18 -> 9 (přes 14) -> 2 (přes 6) -> 11 (přes 7) -> 18 (přes 15) a zrcadlově.
    // Pátý skok neexistuje: všechny kameny v kruhu už jsou přeskočené
    // (zákaz dvojího přeskočení ukončí sekvenci po plném kruhu).
    const position = positionWith(
      [
        [18, BLACK_KING],
        [6, WHITE_MAN],
        [7, WHITE_MAN],
        [14, WHITE_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    const moves = legalMoves(position);
    expect(moves).toEqual([
      { from: 18, path: [9, 2, 11, 18], captures: [14, 6, 7, 15] },
      { from: 18, path: [11, 2, 9, 18], captures: [15, 7, 6, 14] },
    ]);
  });

  it('žádný vygenerovaný tah nemá duplicitu v captures; návrat na from je legální', () => {
    const position = positionWith(
      [
        [18, BLACK_KING],
        [6, WHITE_MAN],
        [7, WHITE_MAN],
        [14, WHITE_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    for (const move of legalMoves(position)) {
      expect(new Set(move.captures).size).toBe(move.captures.length);
      expect(move.path[move.path.length - 1]).toBe(move.from);
      expect(move.captures).toHaveLength(4);
    }
  });
});

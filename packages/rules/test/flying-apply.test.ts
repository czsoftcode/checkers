import { describe, expect, it } from 'vitest';

import type { Cell, Color, Position, Ruleset } from '../src/index.js';
import { applyMove, legalMoves } from '../src/index.js';

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

const FLYING: Ruleset = {
  manCaptureBackward: false,
  king: 'flying',
  promoteMidCapture: false,
  kingCapturePriority: false,
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
};

describe('applyMove – klouzavý prostý tah létavé dámy', () => {
  it('dlouhý prostý tah dámy projde a přesune kámen na vzdálené pole', () => {
    // 18 → 5 po NW diagonále (mezipole 14, 9 prázdná).
    const before = positionWith([[18, BLACK_KING]], 'black');
    const after = applyMove(before, { from: 18, path: [5], captures: [] }, FLYING);
    expect(after.board[18 - 1]).toBeNull();
    expect(after.board[5 - 1]).toEqual(BLACK_KING);
    expect(after.turn).toBe('white');
  });

  it('prostý tah dámy PŘES obsazené mezipole vyhodí RangeError', () => {
    // 9 na NW paprsku je obsazené → tah 18 → 5 přeskakuje kámen, což prostý tah nesmí.
    const before = positionWith(
      [
        [18, BLACK_KING],
        [9, WHITE_MAN],
      ],
      'black',
    );
    expect(() => applyMove(before, { from: 18, path: [5], captures: [] }, FLYING)).toThrow(
      RangeError,
    );
  });

  it('prostý tah dámy MIMO diagonálu vyhodí RangeError (teleport)', () => {
    const before = positionWith([[18, BLACK_KING]], 'black');
    // 19 je ve stejné řadě – není na diagonále z 18.
    expect(() => applyMove(before, { from: 18, path: [19], captures: [] }, FLYING)).toThrow(
      RangeError,
    );
  });

  it('threading NENÍ mrtvý: stejný dlouhý tah pod AMERICAN (short) spadne jako teleport', () => {
    const before = positionWith([[18, BLACK_KING]], 'black');
    // Default ruleset = short → 5 nesousedí s 18 → RangeError.
    expect(() => applyMove(before, { from: 18, path: [5], captures: [] })).toThrow(RangeError);
  });

  it('krátký tah dámy (na souseda) projde i ve flying variantě', () => {
    const before = positionWith([[18, BLACK_KING]], 'black');
    const after = applyMove(before, { from: 18, path: [14], captures: [] }, FLYING);
    expect(after.board[14 - 1]).toEqual(BLACK_KING);
  });

  it('muž ve flying variantě zůstává krátký (dlouhý „tah muže" je teleport)', () => {
    const before = positionWith([[10, BLACK_MAN]], 'black');
    // 10 → 19 není soused; flying se muže netýká → RangeError.
    expect(() => applyMove(before, { from: 10, path: [19], captures: [] }, FLYING)).toThrow(
      RangeError,
    );
  });

  it('KAŽDÝ tah z legalMoves(FLYING) projde applyMove(FLYING) bez výjimky', () => {
    // Pojistka proti divergenci geometrie mezi generátorem a validátorem:
    // co generátor pod flying nabídne, musí apply pod flying přijmout.
    const positions: Position[] = [
      positionWith([[18, BLACK_KING]], 'black'), // volná deska, 13 klouzavých tahů
      positionWith(
        [
          [18, BLACK_KING],
          [9, BLACK_MAN], // vlastní kámen krátí NW paprsek
          [11, WHITE_MAN], // cizí kámen krátí NE paprsek
        ],
        'black',
      ),
      positionWith([[29, BLACK_KING]], 'black'), // roh: jediná diagonála
    ];
    for (const position of positions) {
      const moves = legalMoves(position, FLYING);
      expect(moves.length).toBeGreaterThan(0);
      for (const move of moves) {
        const after = applyMove(position, move, FLYING);
        expect(after.turn).not.toBe(position.turn);
      }
    }
  });
});

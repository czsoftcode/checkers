import { describe, expect, it } from 'vitest';

import type { Cell, Color, Position } from '../src/index.js';
import { applyMove, gameResult, initialPosition } from '../src/index.js';

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

describe('gameResult – prohra bez kamenů', () => {
  it('černý na tahu bez kamenů prohrává', () => {
    const position = positionWith([[18, WHITE_MAN]], 'black');
    expect(gameResult(position)).toBe('white-wins');
  });

  it('bílý na tahu bez kamenů prohrává', () => {
    const position = positionWith([[18, BLACK_MAN]], 'white');
    expect(gameResult(position)).toBe('black-wins');
  });
});

describe('gameResult – prohra se zablokovanými kameny (pat neexistuje)', () => {
  it('černý se zablokovanými kameny na tahu prohrává, ne remíza', () => {
    // Fixture ze fáze 4: černí zaklínění o sebe v dolním rohu, bílý daleko.
    const position = positionWith(
      [
        [21, BLACK_MAN],
        [25, BLACK_MAN],
        [29, BLACK_MAN],
        [30, BLACK_MAN],
        [1, WHITE_MAN],
      ],
      'black',
    );
    expect(gameResult(position)).toBe('white-wins');
  });

  it('bílý se zablokovanými kameny na tahu prohrává (zrcadlová pozice)', () => {
    const position = positionWith(
      [
        [12, WHITE_MAN],
        [8, WHITE_MAN],
        [4, WHITE_MAN],
        [3, WHITE_MAN],
        [32, BLACK_MAN],
      ],
      'white',
    );
    expect(gameResult(position)).toBe('black-wins');
  });
});

describe('gameResult – neukončená partie', () => {
  it('výchozí pozice je ongoing pro obě barvy na tahu', () => {
    expect(gameResult(initialPosition())).toBe('ongoing');
    expect(gameResult({ ...initialPosition(), turn: 'white' })).toBe('ongoing');
  });

  it('strana s jediným volným kamenem je ongoing', () => {
    const position = positionWith(
      [
        [18, BLACK_MAN],
        [1, WHITE_MAN],
      ],
      'black',
    );
    expect(gameResult(position)).toBe('ongoing');
  });
});

describe('gameResult – reálný tok partie přes applyMove', () => {
  it('sebrání posledního kamene soupeře ukončí partii', () => {
    const before = positionWith(
      [
        [10, BLACK_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    expect(gameResult(before)).toBe('ongoing');
    const after = applyMove(before, { from: 10, path: [19], captures: [15] });
    expect(gameResult(after)).toBe('black-wins');
  });

  it('tah, který soupeře zablokuje, ukončí partii', () => {
    // Bílý muž na 29 má jediný únik na 25; černý tam z 21 vstoupí a 22 drží,
    // takže skok 29x22 přes 25 je blokovaný. Bílý na tahu nemá nic = prohra.
    const before = positionWith(
      [
        [21, BLACK_MAN],
        [22, BLACK_MAN],
        [29, WHITE_MAN],
      ],
      'black',
    );
    expect(gameResult(before)).toBe('ongoing');
    const after = applyMove(before, { from: 21, path: [25], captures: [] });
    expect(after.turn).toBe('white');
    expect(gameResult(after)).toBe('black-wins');
  });
});

describe('gameResult – poškozená pozice', () => {
  it('vyhazuje RangeError (dědí validaci z legalMoves)', () => {
    const shortBoard: Position = { board: new Array<Cell>(18).fill(null), turn: 'black' };
    expect(() => gameResult(shortBoard)).toThrow(RangeError);
    const badTurn = { board: new Array<Cell>(32).fill(null), turn: 'x' } as unknown as Position;
    expect(() => gameResult(badTurn)).toThrow(RangeError);
  });
});

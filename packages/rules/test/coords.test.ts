import { describe, expect, it } from 'vitest';

import { coordsToSquare, isDarkSquare, squareToCoords } from '../src/index.js';

/**
 * Ručně spočítaná tabulka [pole, řádek, sloupec] podle standardního
 * PDN číslování (pole 1–4 nahoře na straně černého, 29–32 dole u bílého):
 *
 *   . 1 . 2 . 3 . 4     řada 0
 *   5 . 6 . 7 . 8 .     řada 1
 *   . 9 . 10 . 11 . 12  řada 2
 *   13 . 14 . 15 . 16 . řada 3
 *   . 17 . 18 . 19 . 20 řada 4
 *   21 . 22 . 23 . 24 . řada 5
 *   . 25 . 26 . 27 . 28 řada 6
 *   29 . 30 . 31 . 32 . řada 7
 *
 * Záměrně vybraná pole z lichých i sudých řad (posunutý vzor) a z krajů.
 */
const HAND_COMPUTED: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [4, 0, 7],
  [5, 1, 0],
  [8, 1, 6],
  [12, 2, 7],
  [13, 3, 0],
  [18, 4, 3],
  [19, 4, 5],
  [21, 5, 0],
  [24, 5, 6],
  [25, 6, 1],
  [29, 7, 0],
  [32, 7, 6],
];

describe('squareToCoords', () => {
  it.each(HAND_COMPUTED)('pole %i leží na řádku %i, sloupci %i', (square, row, col) => {
    expect(squareToCoords(square)).toEqual({ row, col });
  });

  it.each([0, 33, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'vyhazuje RangeError pro neplatné číslo pole %s',
    (square) => {
      expect(() => squareToCoords(square)).toThrow(RangeError);
    },
  );
});

describe('coordsToSquare', () => {
  it.each(HAND_COMPUTED)('pole %i vznikne z řádku %i, sloupce %i', (square, row, col) => {
    expect(coordsToSquare(row, col)).toBe(square);
  });

  it.each([
    [0, 0],
    [7, 7],
    [3, 3],
    [6, 0],
  ])('vyhazuje RangeError pro světlé políčko row=%i, col=%i', (row, col) => {
    expect(() => coordsToSquare(row, col)).toThrow(RangeError);
  });

  it.each([
    [-1, 0],
    [8, 1],
    [0, 8],
    [1, -1],
    [0.5, 0.5],
    [Number.NaN, 1],
  ])('vyhazuje RangeError pro souřadnice mimo desku row=%s, col=%s', (row, col) => {
    expect(() => coordsToSquare(row, col)).toThrow(RangeError);
  });
});

describe('isDarkSquare', () => {
  it('rozliší tmavá a světlá políčka i pro záporné souřadnice', () => {
    expect(isDarkSquare(0, 1)).toBe(true);
    expect(isDarkSquare(0, 0)).toBe(false);
    expect(isDarkSquare(7, 6)).toBe(true);
    // V JS je (-1) % 2 === -1 – lichý součet musí být tmavý i mimo desku.
    expect(isDarkSquare(-1, 0)).toBe(true);
    expect(isDarkSquare(0, -1)).toBe(true);
    expect(isDarkSquare(-1, -1)).toBe(false);
  });
});

describe('round-trip', () => {
  it('coordsToSquare(squareToCoords(s)) vrací s pro všech 32 polí', () => {
    for (let square = 1; square <= 32; square++) {
      const { row, col } = squareToCoords(square);
      expect(coordsToSquare(row, col)).toBe(square);
    }
  });
});

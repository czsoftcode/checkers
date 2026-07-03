import { describe, expect, it } from 'vitest';

import { DIR, JUMPS, NEIGHBORS, jumpOf } from '../src/index.js';

type DirTargetsLike = readonly [number | null, number | null, number | null, number | null];

/**
 * Ručně spočítané dopady skoků vybraných polí v pořadí směrů
 * [NW, NE, SW, SE] (viz diagram číslování v coords.test.ts).
 * Pole 26 a 17 odpovídají PDN příkladu 26x17x10 z GDD.
 */
const HAND_COMPUTED: readonly (readonly [number, DirTargetsLike])[] = [
  [1, [null, null, null, 10]],
  [4, [null, null, 11, null]],
  [9, [null, 2, null, 18]],
  [11, [2, 4, 18, 20]],
  [14, [5, 7, 21, 23]],
  [17, [null, 10, null, 26]],
  [22, [13, 15, 29, 31]],
  [26, [17, 19, null, null]],
  [29, [null, 22, null, null]],
  [32, [23, null, null, null]],
];

describe('JUMPS', () => {
  it('má rozměr 32×4', () => {
    expect(JUMPS).toHaveLength(32);
    for (const targets of JUMPS) {
      expect(targets).toHaveLength(4);
    }
  });

  it.each(HAND_COMPUTED)('pole %i má dopady skoků [NW, NE, SW, SE] = %j', (square, expected) => {
    expect(JUMPS[square - 1]).toEqual(expected);
  });

  it('kde je definován skok, je ve stejném indexu definován i soused (přeskakované pole)', () => {
    for (let square = 1; square <= 32; square++) {
      for (const dir of [DIR.NW, DIR.NE, DIR.SW, DIR.SE]) {
        const landing = JUMPS[square - 1]?.[dir];
        // != null schválně: chybějící řádek tabulky (undefined) nesmí projít.
        if (landing != null) {
          const jumped = NEIGHBORS[square - 1]?.[dir];
          expect(jumped).not.toBeNull();
          expect(jumped).toBeDefined();
        }
      }
    }
  });
});

describe('jumpOf', () => {
  it('čte tabulku podle čísla pole a směru', () => {
    expect(jumpOf(26, DIR.NW)).toBe(17);
    expect(jumpOf(17, DIR.NE)).toBe(10);
    expect(jumpOf(1, DIR.SE)).toBe(10);
    expect(jumpOf(1, DIR.SW)).toBeNull();
  });

  it.each([0, 33, 1.5])('vyhazuje RangeError pro neplatné číslo pole %s', (square) => {
    expect(() => jumpOf(square, DIR.NW)).toThrow(RangeError);
  });

  it.each([-1, 4, 1.5, Number.NaN])('vyhazuje RangeError pro neplatný směr %s', (dir) => {
    // @ts-expect-error – schválně neplatný směr; typ Direction za běhu nic nezaručuje
    expect(() => jumpOf(1, dir)).toThrow(RangeError);
  });
});

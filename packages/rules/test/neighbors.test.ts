import { describe, expect, it } from 'vitest';

import { DIR, NEIGHBORS, neighborOf } from '../src/index.js';

/**
 * Ručně spočítaní sousedé vybraných polí v pořadí směrů [NW, NE, SW, SE]
 * (viz diagram číslování v coords.test.ts). Výběr pokrývá oba rohy
 * (4 a 29 mají jediného souseda!), kraje, střed a liché i sudé řady.
 */
const HAND_COMPUTED: readonly (readonly [number, DirTargetsLike])[] = [
  [1, [null, null, 5, 6]],
  [4, [null, null, 8, null]],
  [5, [null, 1, null, 9]],
  [8, [3, 4, 11, 12]],
  [11, [7, 8, 15, 16]],
  [13, [null, 9, null, 17]],
  [18, [14, 15, 22, 23]],
  [20, [16, null, 24, null]],
  [22, [17, 18, 25, 26]],
  [29, [null, 25, null, null]],
  [32, [27, 28, null, null]],
];

type DirTargetsLike = readonly [number | null, number | null, number | null, number | null];

describe('NEIGHBORS', () => {
  it('má rozměr 32×4', () => {
    expect(NEIGHBORS).toHaveLength(32);
    for (const targets of NEIGHBORS) {
      expect(targets).toHaveLength(4);
    }
  });

  it.each(HAND_COMPUTED)('pole %i má sousedy [NW, NE, SW, SE] = %j', (square, expected) => {
    expect(NEIGHBORS[square - 1]).toEqual(expected);
  });
});

describe('neighborOf', () => {
  it('čte tabulku podle čísla pole a směru', () => {
    expect(neighborOf(1, DIR.SW)).toBe(5);
    expect(neighborOf(1, DIR.NW)).toBeNull();
    expect(neighborOf(22, DIR.NE)).toBe(18);
    expect(neighborOf(32, DIR.NW)).toBe(27);
  });

  it.each([0, 33, 1.5])('vyhazuje RangeError pro neplatné číslo pole %s', (square) => {
    expect(() => neighborOf(square, DIR.NW)).toThrow(RangeError);
  });

  it.each([-1, 4, 1.5, Number.NaN])('vyhazuje RangeError pro neplatný směr %s', (dir) => {
    // @ts-expect-error – schválně neplatný směr; typ Direction za běhu nic nezaručuje
    expect(() => neighborOf(1, dir)).toThrow(RangeError);
  });
});

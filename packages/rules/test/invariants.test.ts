import { describe, expect, it } from 'vitest';

import type { Direction } from '../src/index.js';
import { ALL_DIRS, DIR, JUMPS, NEIGHBORS } from '../src/index.js';

describe('ALL_DIRS', () => {
  it('obsahuje přesně čtyři směry v pořadí NW, NE, SW, SE', () => {
    // Přibíjí obsah sdílené konstanty: testy níž přes ni iterují, takže
    // omylem vypuštěný směr by jinak invarianty tiše zúžil místo shození.
    expect(ALL_DIRS).toEqual([DIR.NW, DIR.NE, DIR.SW, DIR.SE]);
  });
});

/** Protilehlý směr: NW↔SE (0↔3), NE↔SW (1↔2). */
function opposite(dir: Direction): Direction {
  return (3 - dir) as Direction;
}

function targetsOf(table: typeof NEIGHBORS, square: number): readonly (number | null)[] {
  const targets = table[square - 1];
  if (targets === undefined) {
    throw new Error(`Chybí řádek tabulky pro pole ${String(square)}`);
  }
  return targets;
}

describe.each([
  ['NEIGHBORS', NEIGHBORS],
  ['JUMPS', JUMPS],
])('%s – společné invarianty', (_name, table) => {
  it('každý cíl je celé číslo 1–32 a nikdy pole samotné', () => {
    for (let square = 1; square <= 32; square++) {
      for (const target of targetsOf(table, square)) {
        if (target !== null) {
          expect(Number.isInteger(target)).toBe(true);
          expect(target).toBeGreaterThanOrEqual(1);
          expect(target).toBeLessThanOrEqual(32);
          expect(target).not.toBe(square);
        }
      }
    }
  });

  it('je symetrická: cíl B ve směru d z A znamená cíl A v protisměru z B', () => {
    for (let square = 1; square <= 32; square++) {
      for (const dir of ALL_DIRS) {
        const target = targetsOf(table, square)[dir];
        if (target !== null && target !== undefined) {
          expect(targetsOf(table, target)[opposite(dir)]).toBe(square);
        }
      }
    }
  });

  it('každé pole má aspoň 1 a nejvýš 4 cíle', () => {
    for (let square = 1; square <= 32; square++) {
      const count = targetsOf(table, square).filter((t) => t !== null).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(4);
    }
  });
});

describe('NEIGHBORS – rozložení počtu sousedů', () => {
  /**
   * Ručně odvozeno z diagramu (viz coords.test.ts): jednorohová pole 4 a 29
   * mají jediného souseda, ostatních 12 krajních polí má 2, vnitřních 18
   * polí má 4. Pole se 3 sousedy na této desce neexistuje.
   */
  it('přesně 2 pole s 1 sousedem (4 a 29), 12 se 2, 18 se 4, žádné se 3', () => {
    const bySquare = new Map<number, number>();
    for (let square = 1; square <= 32; square++) {
      const count = targetsOf(NEIGHBORS, square).filter((t) => t !== null).length;
      bySquare.set(square, count);
    }
    const squaresWith = (n: number): number[] =>
      [...bySquare.entries()].filter(([, count]) => count === n).map(([square]) => square);

    expect(squaresWith(1)).toEqual([4, 29]);
    expect(squaresWith(2)).toHaveLength(12);
    expect(squaresWith(3)).toHaveLength(0);
    expect(squaresWith(4)).toHaveLength(18);
  });
});

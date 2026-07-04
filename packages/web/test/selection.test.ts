import { initialPosition } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { selectableAt, targetsFor } from '../src/selection.js';

/** Postaví pozici z řídkého zápisu `{ pole: kámen }` (pole 1–32). */
function position(turn: Color, pieces: Record<number, Cell>): Position {
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  return { board, turn };
}

const blackMan: Cell = { color: 'black', kind: 'man' };
const whiteMan: Cell = { color: 'white', kind: 'man' };

describe('selectableAt', () => {
  const pos = initialPosition(); // černý na tahu

  it('vybere jen kámen strany na tahu', () => {
    expect(selectableAt(pos, 9)).toBe(true); // černý muž
    expect(selectableAt(pos, 21)).toBe(false); // bílý muž – není na tahu
    expect(selectableAt(pos, 15)).toBe(false); // prázdné pole
  });

  it('pole mimo rozsah není vybíratelné (žádná výjimka)', () => {
    expect(selectableAt(pos, 0)).toBe(false);
    expect(selectableAt(pos, 33)).toBe(false);
    expect(selectableAt(pos, 1.5)).toBe(false);
  });
});

describe('targetsFor', () => {
  it('vrátí cíle prostých tahů z výchozí pozice', () => {
    const pos = initialPosition();
    expect(new Set(targetsFor(pos, 9))).toEqual(new Set([13, 14]));
  });

  it('z kamene soupeře nevrací nic (je na tahu druhá strana)', () => {
    const pos = initialPosition();
    expect(targetsFor(pos, 21)).toEqual([]); // bílý, černý na tahu
  });

  it('prázdné pole nemá cíle', () => {
    expect(targetsFor(initialPosition(), 20)).toEqual([]);
  });

  // Povinné braní: černý 5 musí přeskočit bílého 9 (dopad 14). Kámen 11 má sice
  // volné prosté tahy (15, 16), ale při dostupném skoku jsou nelegální.
  describe('povinné braní', () => {
    const pos = position('black', { 5: blackMan, 9: whiteMan, 11: blackMan });

    it('vybraný skákající kámen ukáže dopad skoku', () => {
      expect(targetsFor(pos, 5)).toEqual([14]);
    });

    it('kámen bez skoku nemá žádné cíle, i když by prostý tah byl volný', () => {
      // Kdyby rules nevynucovala braní, vrátilo by se [15, 16] a test padne.
      expect(targetsFor(pos, 11)).toEqual([]);
    });
  });
});

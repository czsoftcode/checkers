import { initialPosition } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { nextTargets, resolveMove, selectableAt, targetsFor } from '../src/selection.js';

/** Postaví pozici z řídkého zápisu `{ pole: kámen }` (pole 1–32). */
function position(turn: Color, pieces: Record<number, Cell>): Position {
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  return { board, turn };
}

const blackMan: Cell = { color: 'black', kind: 'man' };
const whiteMan: Cell = { color: 'white', kind: 'man' };
const blackKing: Cell = { color: 'black', kind: 'king' };

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

describe('nextTargets – doklikávání sekvence', () => {
  // Prostý dvojskok bez větvení: černý 6 přeskočí bílé 10 a 18, cesta [15, 22].
  describe('vícenásobný skok (bez větvení)', () => {
    const pos = position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });

    it('prázdná předpona ukáže první dopad', () => {
      expect(nextTargets(pos, 6, [])).toEqual([15]);
    });

    it('po prvním dopadu ukáže druhý dopad', () => {
      expect(nextTargets(pos, 6, [15])).toEqual([22]);
    });

    it('za posledním dopadem už nic nepokračuje', () => {
      expect(nextTargets(pos, 6, [15, 22])).toEqual([]);
    });
  });

  // Větvení se sdíleným prefixem: dáma na 1 skočí přes 6 na 10, odtud dvě
  // pokračování – přes 7 na 3, nebo přes 14 na 17.
  describe('větvení se sdíleným prvním dopadem', () => {
    const pos = position('black', { 1: blackKing, 6: whiteMan, 7: whiteMan, 14: whiteMan });

    it('první dopad je společný (jen jedno pole)', () => {
      expect(nextTargets(pos, 1, [])).toEqual([10]);
    });

    it('po společném dopadu nabídne obě větve', () => {
      expect(new Set(nextTargets(pos, 1, [10]))).toEqual(new Set([3, 17]));
    });

    it('po zvolené větvi už nic nepokračuje', () => {
      expect(nextTargets(pos, 1, [10, 3])).toEqual([]);
      expect(nextTargets(pos, 1, [10, 17])).toEqual([]);
    });
  });

  it('nesmyslná předpona (neodpovídá žádnému tahu) nemá pokračování', () => {
    const pos = position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });
    expect(nextTargets(pos, 6, [99])).toEqual([]);
  });
});

describe('resolveMove – dokončení tahu', () => {
  it('prostý tah je hotový po jednom dopadu', () => {
    const pos = initialPosition();
    expect(resolveMove(pos, 9, [13])).toEqual({ from: 9, path: [13], captures: [] });
  });

  it('rozpracovaná předpona ještě není hotový tah', () => {
    const pos = position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });
    expect(resolveMove(pos, 6, [15])).toBeNull(); // chybí druhý dopad
  });

  it('celá cesta dvojskoku vydá tah včetně obou braní', () => {
    const pos = position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });
    expect(resolveMove(pos, 6, [15, 22])).toEqual({ from: 6, path: [15, 22], captures: [10, 18] });
  });

  it('každá větev vydá vlastní tah se správným braním', () => {
    const pos = position('black', { 1: blackKing, 6: whiteMan, 7: whiteMan, 14: whiteMan });
    expect(resolveMove(pos, 1, [10, 3])).toEqual({ from: 1, path: [10, 3], captures: [6, 7] });
    expect(resolveMove(pos, 1, [10, 17])).toEqual({ from: 1, path: [10, 17], captures: [6, 14] });
  });

  it('neexistující tah vrací null', () => {
    expect(resolveMove(initialPosition(), 9, [99])).toBeNull();
  });
});

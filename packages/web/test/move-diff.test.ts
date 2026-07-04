import type { Cell, Color, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { diffMove } from '../src/move-diff.js';

const blackMan: Cell = { color: 'black', kind: 'man' };
const whiteMan: Cell = { color: 'white', kind: 'man' };
const blackKing: Cell = { color: 'black', kind: 'king' };

/** Postaví pozici z řídkého zápisu `{ pole: kámen }` (pole 1–32). */
function position(turn: Color, pieces: Record<number, Cell>): Position {
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  return { board, turn };
}

describe('diffMove – prostý tah', () => {
  it('rozezná posun jednoho kamene bez braní', () => {
    const prev = position('black', { 9: blackMan });
    const next = position('white', { 13: blackMan });

    expect(diffMove(prev, next)).toEqual({ from: 9, to: 13, hops: [13], captured: [] });
  });
});

describe('diffMove – skoky', () => {
  it('jednoduchý skok: from/to a jeden sebraný', () => {
    // Černý muž 6 přeskočí bílého 10, dopadne na 15.
    const prev = position('black', { 6: blackMan, 10: whiteMan });
    const next = position('white', { 15: blackMan });

    expect(diffMove(prev, next)).toEqual({ from: 6, to: 15, hops: [15], captured: [10] });
  });

  it('dvojskok: mezidopad i pořadí sebraných sedí', () => {
    // Černý muž 6 přeskočí 10 (dopad 15) a 18 (dopad 22).
    const prev = position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });
    const next = position('white', { 22: blackMan });

    expect(diffMove(prev, next)).toEqual({ from: 6, to: 22, hops: [15, 22], captured: [10, 18] });
  });

  it('kruhový skok dámy (from === to) se složí PO SMĚRU hodinových ručiček', () => {
    // Dáma na 10 obíhá čtyři bílé (15, 23, 22, 14) a vrací se na 10.
    // Po směru hodinových ručiček: 10→19→26→17→10, bere 15,23,22,14.
    const prev = position('black', {
      10: blackKing,
      15: whiteMan,
      23: whiteMan,
      22: whiteMan,
      14: whiteMan,
    });
    const next = position('white', { 10: blackKing });

    expect(diffMove(prev, next)).toEqual({
      from: 10,
      to: 10,
      hops: [19, 26, 17, 10],
      captured: [15, 23, 22, 14],
    });
  });
});

describe('diffMove – pojistka „jeden diff = jeden tah"', () => {
  it('shodné pozice → null (nic se nestalo)', () => {
    const pos = position('black', { 9: blackMan });
    expect(diffMove(pos, pos)).toBeNull();
  });

  it('dva vlastní kameny se přesunuly (dva plies slité) → null', () => {
    const prev = position('black', { 9: blackMan, 10: blackMan });
    const next = position('black', { 13: blackMan, 14: blackMan });
    expect(diffMove(prev, next)).toBeNull();
  });

  it('kámen změnil obsah na místě (neodpovídá tahu) → null', () => {
    const prev = position('black', { 9: blackMan });
    const next = position('white', { 9: blackKing });
    expect(diffMove(prev, next)).toBeNull();
  });

  it('sebraný kámen bez odpovídající cesty → fallback rovný posun', () => {
    // Kámen 9→13, ale „sebraný" 20 neleží na žádné diagonále skoku → hops=[to],
    // sebraný se odebere naráz (captured delší než hops).
    const prev = position('black', { 9: blackMan, 20: whiteMan });
    const next = position('white', { 13: blackMan });
    expect(diffMove(prev, next)).toEqual({ from: 9, to: 13, hops: [13], captured: [20] });
  });
});

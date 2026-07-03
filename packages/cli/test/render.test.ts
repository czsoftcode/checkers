import { initialPosition } from '@checkers/rules';
import type { Cell } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { renderPosition } from '../src/render.js';

describe('renderPosition', () => {
  it('vykreslí výchozí pozici (muži, čísla prázdných polí, tečky)', () => {
    expect(renderPosition(initialPosition())).toBe(
      [
        ' ·  m  ·  m  ·  m  ·  m',
        ' m  ·  m  ·  m  ·  m  ·',
        ' ·  m  ·  m  ·  m  ·  m',
        '13  · 14  · 15  · 16  ·',
        ' · 17  · 18  · 19  · 20',
        ' M  ·  M  ·  M  ·  M  ·',
        ' ·  M  ·  M  ·  M  ·  M',
        ' M  ·  M  ·  M  ·  M  ·',
      ].join('\n'),
    );
  });

  it('kreslí dámy jako k/K na správných polích', () => {
    const board: Cell[] = Array.from({ length: 32 }, () => null);
    board[0] = { color: 'black', kind: 'king' }; // pole 1
    board[31] = { color: 'white', kind: 'king' }; // pole 32
    const lines = renderPosition({ board, turn: 'white' }).split('\n');
    expect(lines[0]).toBe(' ·  k  ·  2  ·  3  ·  4');
    expect(lines[7]).toBe('29  · 30  · 31  ·  K  ·');
  });

  it('odmítne desku s chybějícími poli', () => {
    expect(() => renderPosition({ board: [], turn: 'black' })).toThrow(RangeError);
  });
});

import { applyMove, initialPosition, legalMoves } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { hashPosition } from '../src/zobrist.js';

import { makePosition, randomPlayedPosition } from './support/position.js';

describe('hashPosition – determinismus a bezpečný rozsah', () => {
  it('shodná pozice → shodný otisk (dva nezávisle postavené objekty)', () => {
    const a = makePosition('black', { 13: 'bm', 22: 'wm', 4: 'bk' });
    const b = makePosition('black', { 13: 'bm', 22: 'wm', 4: 'bk' });
    expect(hashPosition(a)).toBe(hashPosition(b));
  });

  it('otisk je vždy bezpečný celý integer v rozsahu [0, 2^53)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const key = hashPosition(randomPlayedPosition(seed, seed % 20));
      expect(Number.isSafeInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(0);
      expect(key).toBeLessThan(2 ** 53);
    }
  });
});

describe('hashPosition – citlivost na změny', () => {
  it('obrat strany na tahu mění otisk', () => {
    const black = makePosition('black', { 13: 'bm', 22: 'wm' });
    const white = makePosition('white', { 13: 'bm', 22: 'wm' });
    expect(hashPosition(black)).not.toBe(hashPosition(white));
  });

  it('přesun kamene na jiné pole mění otisk', () => {
    const before = makePosition('black', { 13: 'bm', 22: 'wm' });
    const after = makePosition('black', { 14: 'bm', 22: 'wm' });
    expect(hashPosition(before)).not.toBe(hashPosition(after));
  });

  it('jiný druh kamene na stejném poli mění otisk', () => {
    const man = makePosition('black', { 13: 'bm', 22: 'wm' });
    const king = makePosition('black', { 13: 'bk', 22: 'wm' });
    expect(hashPosition(man)).not.toBe(hashPosition(king));
  });

  it('jiná barva kamene na stejném poli mění otisk', () => {
    const black = makePosition('black', { 13: 'bm', 22: 'wm' });
    const white = makePosition('black', { 13: 'wm', 22: 'wm' });
    expect(hashPosition(black)).not.toBe(hashPosition(white));
  });

  it('reálný tah (applyMove) mění otisk', () => {
    const start = initialPosition();
    const move = legalMoves(start)[0];
    if (move === undefined) {
      throw new Error('Výchozí pozice nemá legální tah – nemožné.');
    }
    expect(hashPosition(start)).not.toBe(hashPosition(applyMove(start, move)));
  });

  it('různé rozehrané pozice mají různé otisky (bez kolize na malé sadě)', () => {
    const keys = new Set<number>();
    let count = 0;
    for (let seed = 1; seed <= 50; seed++) {
      for (let plies = 4; plies <= 12; plies += 2) {
        keys.add(hashPosition(randomPlayedPosition(seed, plies)));
        count++;
      }
    }
    // Různé (seed, plies) můžou dát transpozicí tutéž pozici → povolíme malý
    // pokles; cílem je vyloučit HRUBOU kolizi (shodné otisky různých pozic).
    expect(keys.size).toBeGreaterThan(count * 0.9);
  });

  it('poškozená deska (díra) je odmítnuta RangeError', () => {
    const board = Array.from({ length: 32 }, () => null) as (null | undefined)[];
    board[10] = undefined;
    const broken = { board, turn: 'black' as const };
    expect(() => hashPosition(broken as never)).toThrow(RangeError);
  });
});

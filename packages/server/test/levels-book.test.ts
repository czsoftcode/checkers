/**
 * Allowlist úrovní s knihou zahájení (fáze 56).
 *
 * ZUBY: očekávání je `Record<GameLevel, boolean>` → přidání úrovně do `LEVELS`
 * nezkompiluje, dokud se tady vědomě nerozhodne, jestli knihu má. Test tak
 * nedovolí, aby nová plnosilová úroveň knihu tiše zdědila (nebo o ni přišla).
 */

import { describe, expect, it } from 'vitest';

import { LEVELS, levelUsesBook } from '../src/index.js';
import type { GameLevel } from '../src/index.js';

const EXPECTED_USES_BOOK: Record<GameLevel, boolean> = {
  professional: true,
  championship: true,
  education: true,
  intermediate: false,
  beginner: false,
};

describe('levelUsesBook – které úrovně konzultují knihu', () => {
  it('každá úroveň má očekávané zařazení', () => {
    for (const level of LEVELS) {
      expect(levelUsesBook(level)).toBe(EXPECTED_USES_BOOK[level]);
    }
  });

  it('oslabené úrovně (beginner, intermediate) knihu NEmají', () => {
    expect(levelUsesBook('beginner')).toBe(false);
    expect(levelUsesBook('intermediate')).toBe(false);
  });
});

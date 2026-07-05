/**
 * Kontrakt úrovní obtížnosti a jejich mapy na páky síly. Čte se REÁLNÁ mapa
 * `STRENGTH_BY_LEVEL` z produkčního kódu (ne kopie čísel), aby test hlídal
 * skutečný zdroj pravdy sdílený serverem i store.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_LEVEL, LEVELS, STRENGTH_BY_LEVEL } from '../src/index.js';

describe('úrovně obtížnosti', () => {
  it('výchozí úroveň je Profesionál (zpětně kompatibilní chování)', () => {
    expect(DEFAULT_LEVEL).toBe('professional');
    expect(LEVELS).toContain('professional');
    expect(LEVELS).toContain('beginner');
  });

  it('Profesionál nemá žádné páky (engine dostane dnešní požadavek beze změny)', () => {
    expect(STRENGTH_BY_LEVEL.professional).toBeUndefined();
  });

  it('Začátečník má strop hloubky a nenulovou nepozornost (reálně slabší)', () => {
    const beginner = STRENGTH_BY_LEVEL.beginner;
    expect(beginner).toBeDefined();
    expect(beginner?.maxDepth).toBeGreaterThanOrEqual(1);
    expect(beginner?.carelessness).toBeGreaterThan(0);
    expect(beginner?.carelessness).toBeLessThanOrEqual(1);
  });

  it('každá úroveň v LEVELS má záznam v mapě síly', () => {
    for (const level of LEVELS) {
      expect(level in STRENGTH_BY_LEVEL).toBe(true);
    }
  });
});

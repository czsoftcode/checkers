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

  it('Pokročilý je uprostřed: hlubší a pozornější než Začátečník, ale s páky (ne plná síla)', () => {
    const intermediate = STRENGTH_BY_LEVEL.intermediate;
    const beginner = STRENGTH_BY_LEVEL.beginner;
    expect(intermediate).toBeDefined();
    // Má páky (na rozdíl od Profesionála = undefined) → není plná síla.
    expect(intermediate).not.toBeUndefined();
    // Vidí hlouběji než Začátečník (hloubka je dominantní páka síly).
    expect(intermediate?.maxDepth).toBeGreaterThan(beginner?.maxDepth ?? 0);
    // Méně nepozorný než Začátečník (spolehlivější, ale pořád potrestatelný).
    expect(intermediate?.carelessness).toBeGreaterThan(0);
    expect(intermediate?.carelessness).toBeLessThan(beginner?.carelessness ?? 1);
  });

  it('Výuka hraje soupeře plnou silou (undefined) – rozdíl je jen v klientské nápovědě', () => {
    expect(LEVELS).toContain('education');
    // Shodná síla jako Profesionál: soupeř plnou silou, žádné páky. Výukovost je
    // čistě klientská (zobrazení nápovědy), server ji do síly soupeře nepromítá.
    expect(STRENGTH_BY_LEVEL.education).toBeUndefined();
  });

  it('Mistrovství hraje soupeře plnou silou (undefined) – liší se jen vynuceným zahájením', () => {
    expect(LEVELS).toContain('championship');
    // Shodná síla jako Profesionál: žádné páky. Rozdíl Mistrovství je JEN vynucený
    // 3-move ballot losovaný serverem, ne slabší/silnější engine – to hlídá store,
    // ne tahle mapa.
    expect(STRENGTH_BY_LEVEL.championship).toBeUndefined();
  });

  it('každá úroveň v LEVELS má záznam v mapě síly', () => {
    for (const level of LEVELS) {
      expect(level in STRENGTH_BY_LEVEL).toBe(true);
    }
  });
});

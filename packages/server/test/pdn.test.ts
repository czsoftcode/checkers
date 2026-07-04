/**
 * Unit testy serializace celé partie do PDN (`formatGamePdn`). Čistá funkce,
 * testuje se přímo – hlavičkové tagy, full-move číslování (černý+bílý), lichý
 * počet půltahů, všechny výsledkové tokeny a odmítnutí rozehrané partie.
 */

import { describe, expect, it } from 'vitest';

import type { Move } from '@checkers/rules';
import { formatGamePdn } from '../src/index.js';

// Reálné legální jednoduché tahy zahájení (sousední pole → `formatMove` je vezme).
const B1: Move = { from: 11, path: [15], captures: [] }; // 11-15
const W1: Move = { from: 22, path: [18], captures: [] }; // 22-18
const B2: Move = { from: 9, path: [13], captures: [] }; //  9-13
const W2: Move = { from: 23, path: [19], captures: [] }; // 23-19

// Pevné datum – bez závislosti na dnešku (Date.now v testu je nedeterminismus).
const DATE = new Date(2026, 0, 5); // 5. ledna 2026 → "2026.01.05"

describe('formatGamePdn – hlavička', () => {
  it('obsahuje všech 7 povinných STR tagů se správnými hodnotami', () => {
    const pdn = formatGamePdn([B1, W1], 'draw', DATE);
    expect(pdn).toContain('[Event "Checkers"]');
    expect(pdn).toContain('[Site "local"]');
    expect(pdn).toContain('[Date "2026.01.05"]');
    expect(pdn).toContain('[Round "-"]');
    expect(pdn).toContain('[White "Engine"]');
    expect(pdn).toContain('[Black "Human"]');
    expect(pdn).toContain('[Result "1/2-1/2"]');
  });

  it('měsíc i den doplní vedoucí nulou', () => {
    const pdn = formatGamePdn([B1], 'black-wins', new Date(2026, 2, 9)); // březen, 9.
    expect(pdn).toContain('[Date "2026.03.09"]');
  });
});

describe('formatGamePdn – movetext a číslování', () => {
  it('sudý počet půltahů: 1. black white 2. black white', () => {
    const pdn = formatGamePdn([B1, W1, B2, W2], 'white-wins', DATE);
    expect(pdn.trimEnd().endsWith('1. 11-15 22-18 2. 9-13 23-19 1-0')).toBe(true);
  });

  it('lichý počet půltahů: poslední číslo nese jen černý půltah', () => {
    const pdn = formatGamePdn([B1, W1, B2], 'black-wins', DATE);
    expect(pdn.trimEnd().endsWith('1. 11-15 22-18 2. 9-13 0-1')).toBe(true);
  });

  it('končí novým řádkem', () => {
    const pdn = formatGamePdn([B1], 'black-wins', DATE);
    expect(pdn.endsWith('\n')).toBe(true);
  });
});

describe('formatGamePdn – výsledkové tokeny', () => {
  it('black-wins → 0-1', () => {
    expect(formatGamePdn([B1], 'black-wins', DATE).trimEnd().endsWith('0-1')).toBe(true);
  });
  it('white-wins → 1-0', () => {
    expect(formatGamePdn([B1, W1], 'white-wins', DATE).trimEnd().endsWith(' 1-0')).toBe(true);
  });
  it('draw → 1/2-1/2', () => {
    expect(formatGamePdn([B1], 'draw', DATE).trimEnd().endsWith('1/2-1/2')).toBe(true);
  });
});

describe('formatGamePdn – hranice', () => {
  it('prázdný seznam tahů: hlavička + samotný token, bez pádu a bez čísla tahu', () => {
    const pdn = formatGamePdn([], 'draw', DATE);
    expect(pdn).toContain('[Result "1/2-1/2"]');
    expect(pdn.trimEnd().endsWith('1/2-1/2')).toBe(true);
    expect(pdn).not.toMatch(/\d+\.\s/); // žádné „N. " (číslo tahu) v movetextu
  });

  it('rozehraná partie (ongoing) je programová chyba → RangeError', () => {
    expect(() => formatGamePdn([B1], 'ongoing', DATE)).toThrow(RangeError);
  });
});

/**
 * Unit testy serializace celé partie do PDN (`formatGamePdn`). Čistá funkce,
 * testuje se přímo – anonymní hlavičkové tagy (GDPR: bez jmen hráčů), UTC
 * datum + čas, full-move číslování (černý+bílý) s tahy pod sebou, lichý počet
 * půltahů, všechny výsledkové tokeny a odmítnutí rozehrané partie.
 */

import { describe, expect, it } from 'vitest';

import type { Move } from '@checkers/rules';
import { formatGamePdn } from '../src/index.js';

// Reálné legální jednoduché tahy zahájení (sousední pole → `formatMove` je vezme).
const B1: Move = { from: 11, path: [15], captures: [] }; // 11-15
const W1: Move = { from: 22, path: [18], captures: [] }; // 22-18
const B2: Move = { from: 9, path: [13], captures: [] }; //  9-13
const W2: Move = { from: 23, path: [19], captures: [] }; // 23-19

// Pevné datum v UTC – bez závislosti na dnešku i na časové zóně serveru.
// 5. ledna 2026, 14:03:07 UTC → "2026.01.05" / "14:03:07".
const DATE = new Date(Date.UTC(2026, 0, 5, 14, 3, 7));

describe('formatGamePdn – hlavička', () => {
  it('obsahuje anonymní STR tagy se správnými hodnotami', () => {
    const pdn = formatGamePdn([B1, W1], 'draw', DATE);
    expect(pdn).toContain('[Event "American Checkers"]');
    expect(pdn).toContain('[Site "local"]');
    expect(pdn).toContain('[UTCDate "2026.01.05"]');
    expect(pdn).toContain('[UTCTime "14:03:07"]');
    expect(pdn).toContain('[Round "-"]');
    // GDPR: žádná jména hráčů – jen anonymní „?".
    expect(pdn).toContain('[White "?"]');
    expect(pdn).toContain('[Black "?"]');
    expect(pdn).toContain('[Result "1/2-1/2"]');
    // Žádné pozůstatky původních natvrdo zadaných jmen.
    expect(pdn).not.toContain('Engine');
    expect(pdn).not.toContain('Human');
  });

  it('měsíc, den, hodinu, minutu i sekundu doplní vedoucí nulou (v UTC)', () => {
    const pdn = formatGamePdn([B1], 'black-wins', new Date(Date.UTC(2026, 2, 9, 4, 5, 6)));
    expect(pdn).toContain('[UTCDate "2026.03.09"]');
    expect(pdn).toContain('[UTCTime "04:05:06"]');
  });

  it('čas je v UTC, ne v lokální zóně serveru', () => {
    // Okamžik zvolený tak, aby se UTC lišilo od většiny lokálních zón.
    const pdn = formatGamePdn([B1], 'draw', new Date(Date.UTC(2026, 5, 15, 23, 30, 0)));
    expect(pdn).toContain('[UTCDate "2026.06.15"]');
    expect(pdn).toContain('[UTCTime "23:30:00"]');
  });
});

describe('formatGamePdn – movetext a číslování (tahy pod sebou)', () => {
  it('každý číslovaný tah je na samostatném řádku', () => {
    const pdn = formatGamePdn([B1, W1, B2, W2], 'white-wins', DATE);
    // Movetext je oddělený prázdným řádkem od hlaviček.
    const movetext = pdn.split('\n\n')[1]?.trimEnd() ?? '';
    expect(movetext.split('\n')).toEqual(['1. 11-15 22-18', '2. 9-13 23-19', '1-0']);
  });

  it('lichý počet půltahů: poslední řádek nese jen černý půltah', () => {
    const pdn = formatGamePdn([B1, W1, B2], 'black-wins', DATE);
    const movetext = pdn.split('\n\n')[1]?.trimEnd() ?? '';
    expect(movetext.split('\n')).toEqual(['1. 11-15 22-18', '2. 9-13', '0-1']);
  });

  it('končí novým řádkem', () => {
    const pdn = formatGamePdn([B1], 'black-wins', DATE);
    expect(pdn.endsWith('\n')).toBe(true);
  });
});

describe('formatGamePdn – výsledkové tokeny', () => {
  it('black-wins → 0-1', () => {
    expect(formatGamePdn([B1], 'black-wins', DATE).trimEnd().endsWith('\n0-1')).toBe(true);
  });
  it('white-wins → 1-0', () => {
    expect(formatGamePdn([B1, W1], 'white-wins', DATE).trimEnd().endsWith('\n1-0')).toBe(true);
  });
  it('draw → 1/2-1/2', () => {
    expect(formatGamePdn([B1], 'draw', DATE).trimEnd().endsWith('\n1/2-1/2')).toBe(true);
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

describe('formatGamePdn – varianta (fáze 103)', () => {
  it('default (bez varianty) = americká: Event American Checkers + Variant american', () => {
    const pdn = formatGamePdn([B1], 'black-wins', DATE);
    expect(pdn).toContain('[Event "American Checkers"]');
    expect(pdn).toContain('[Variant "american"]');
  });

  it('každá varianta zapíše svůj tag Variant i lidský Event', () => {
    const cases = [
      ['pool', 'Pool Checkers'],
      ['russian', 'Russian Draughts'],
      ['czech', 'Czech Draughts'],
    ] as const;
    for (const [variant, event] of cases) {
      const pdn = formatGamePdn([B1], 'draw', DATE, variant);
      expect(pdn).toContain(`[Variant "${variant}"]`);
      expect(pdn).toContain(`[Event "${event}"]`);
    }
  });

  it('létavá dáma: dlouhý tah dámy se ve flying variantě zapíše (bez pádu na „teleport")', () => {
    // 18-5 je dlouhý (nesousední) tah po diagonále. V americké notaci je to teleport
    // a `formatMove` by padl – server proto MUSÍ dát `formatMove` ruleset varianty.
    const longKingMove: Move = { from: 18, path: [5], captures: [] };
    expect(() => formatGamePdn([longKingMove], 'black-wins', DATE, 'russian')).not.toThrow();
    expect(formatGamePdn([longKingMove], 'black-wins', DATE, 'russian')).toContain('18-5');
    // Bez varianty (american, krátká dáma) je to naopak programová chyba → RangeError,
    // což potvrzuje, že ruleset varianty se opravdu propisuje do formátování.
    expect(() => formatGamePdn([longKingMove], 'black-wins', DATE)).toThrow(RangeError);
  });
});

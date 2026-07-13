/**
 * Zuby pro `[Event]` / `[Variant]` v PDN archivu napříč VŠEMI nabízenými
 * variantami (fáze 116 – italská přidána do `VARIANT_IDS`).
 *
 * `pvp-archive-ws.test.ts` ověřuje archivaci end-to-end, ale jen pro AMERICKOU.
 * Tady kontrolujeme, že `formatGamePdn` zapíše SPRÁVNÝ název události a id
 * varianty pro KAŽDOU variantu z registru – hlavně že italská dokončená partie
 * nese `[Event "Italian Draughts"]` (brána fáze 116), ne tichý fallback na
 * americkou. Iteruje se `VARIANT_IDS`, takže přidání varianty bez záznamu
 * v `EVENT_NAME` (server) by tenhle test shodil.
 *
 * Očekávané názvy jsou zde RUČNÍ ORACLE (cross-module kontrakt): kdyby se
 * `EVENT_NAME` v archive.ts prohodilo (russian → „Czech Draughts"), assert to
 * chytí – testuje reálný výstup, ne kopii mapy.
 */

import { describe, expect, it } from 'vitest';
import { VARIANT_IDS } from '@checkers/rules';
import type { VariantId } from '@checkers/rules';

import { formatGamePdn } from '../src/index.js';

/** Ruční oracle: id varianty → očekávaný `[Event]` název (musí sedět na EVENT_NAME). */
const EXPECTED_EVENT: Record<VariantId, string> = {
  american: 'American Checkers',
  pool: 'Pool Checkers',
  russian: 'Russian Draughts',
  czech: 'Czech Draughts',
  italian: 'Italian Draughts',
};

// Pevné datum (bez závislosti na wall clocku) – tagy data/času nás tu nezajímají.
const DATE = new Date(Date.UTC(2026, 6, 13, 10, 0, 0));

describe('formatGamePdn – [Event]/[Variant] pro každou nabízenou variantu', () => {
  it('VARIANT_IDS obsahuje italian (brána fáze 116)', () => {
    expect(VARIANT_IDS).toContain('italian');
  });

  it.each(VARIANT_IDS.map((v) => [v] as const))(
    '%s: PDN nese správný [Event] i [Variant]',
    (variant) => {
      // Prázdný seznam tahů = movetext jen výsledkový token; tagy se sestaví plně.
      const pdn = formatGamePdn([], 'black-wins', DATE, variant);
      expect(pdn).toContain(`[Event "${EXPECTED_EVENT[variant]}"]`);
      expect(pdn).toContain(`[Variant "${variant}"]`);
    },
  );

  it('italská NEspadne na americký [Event] (tichý fallback by byl chyba)', () => {
    const pdn = formatGamePdn([], 'white-wins', DATE, 'italian');
    expect(pdn).toContain('[Event "Italian Draughts"]');
    expect(pdn).not.toContain('[Event "American Checkers"]');
    expect(pdn).toContain('[Variant "italian"]');
  });
});

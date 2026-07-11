/**
 * Registr variant (fáze 100): id → Ruleset.
 *
 * ZUBY: registr je nové místo tiché chyby – překlep v mapě ('russian' → český
 * ruleset) rozehraje JINOU hru. Proto se každé id kontroluje na KONKRÉTNÍ pole
 * rulesetu (ne jen „něco vrátil"), a neznámé id MUSÍ vyhodit, ne tiše
 * defaultnout na americkou. Kdyby někdo mapu propojil špatně nebo nechal
 * `rulesetForVariant` defaultovat, tyto testy padnou.
 */

import { describe, expect, it } from 'vitest';

import {
  AMERICAN_RULESET,
  CZECH_RULESET,
  POOL_RULESET,
  RUSSIAN_RULESET,
  VARIANT_IDS,
  isVariantId,
  rulesetForVariant,
} from '../src/index.js';
import type { Ruleset, VariantId } from '../src/index.js';

describe('rulesetForVariant – každé id mapuje na správný ruleset', () => {
  const cases: [VariantId, Ruleset][] = [
    ['american', AMERICAN_RULESET],
    ['pool', POOL_RULESET],
    ['russian', RUSSIAN_RULESET],
    ['czech', CZECH_RULESET],
  ];

  for (const [id, expected] of cases) {
    it(`${id} → ruleset se správnými poli`, () => {
      const rs = rulesetForVariant(id);
      // Referenční identita (mapa ukazuje na tu SPRÁVNOU konstantu)...
      expect(rs).toBe(expected);
      // ...i kontrola konkrétních polí, ať překlep mapy (jiná, ale platná
      // konstanta) neprojde jen proto, že „něco vrátil".
      expect(rs.manCaptureBackward).toBe(expected.manCaptureBackward);
      expect(rs.king).toBe(expected.king);
      expect(rs.promoteMidCapture).toBe(expected.promoteMidCapture);
      expect(rs.kingCapturePriority).toBe(expected.kingCapturePriority);
    });
  }

  it('VARIANT_IDS pokrývá právě známá id (nic nechybí, nic navíc)', () => {
    expect([...VARIANT_IDS].sort()).toEqual(['american', 'czech', 'pool', 'russian']);
  });
});

describe('rulesetForVariant – neznámé id vyhazuje, NEdefaultuje', () => {
  it('neznámý string → RangeError (ne tichá americká)', () => {
    // Cast: simulujeme hodnotu přišlou zvenčí (wire), která typem prošla.
    expect(() => rulesetForVariant('checkers' as VariantId)).toThrow(RangeError);
  });

  it('undefined/prázdný string → RangeError', () => {
    expect(() => rulesetForVariant(undefined as unknown as VariantId)).toThrow(RangeError);
    expect(() => rulesetForVariant('' as VariantId)).toThrow(RangeError);
  });

  it('vlastnost prototypu (constructor/toString) NEprojde jako ruleset', () => {
    // Bez hasOwnProperty by indexace REGISTRY['constructor'] vrátila funkci
    // z prototypu (truthy) a tiše prošla – to je přesně ta tichá koruce.
    expect(() => rulesetForVariant('constructor' as VariantId)).toThrow(RangeError);
    expect(() => rulesetForVariant('toString' as VariantId)).toThrow(RangeError);
  });
});

describe('isVariantId – runtime brána pro vstup zvenčí', () => {
  it('true pro každé známé id', () => {
    for (const id of VARIANT_IDS) {
      expect(isVariantId(id)).toBe(true);
    }
  });

  it('false pro neznámé/nestringové vstupy', () => {
    expect(isVariantId('checkers')).toBe(false);
    expect(isVariantId('')).toBe(false);
    expect(isVariantId(undefined)).toBe(false);
    expect(isVariantId(null)).toBe(false);
    expect(isVariantId(42)).toBe(false);
    expect(isVariantId('constructor')).toBe(false);
  });
});

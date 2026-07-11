import { afterEach, describe, expect, it } from 'vitest';
import { VARIANT_IDS } from '@checkers/rules';
import { setLocale, t } from '../src/i18n.js';
import type { MessageKey } from '../src/i18n.js';

/** Zobrazovací klíče názvů variant (musí sedět na `VARIANT_LABEL_KEYS` v lobby). */
const VARIANT_KEYS: Record<string, MessageKey> = {
  american: 'variant.american',
  pool: 'variant.pool',
  russian: 'variant.russian',
  czech: 'variant.czech',
};

afterEach(() => {
  setLocale('en'); // vrať default, ať se nepromítne do jiných souborů
});

describe('i18n – názvy variant + aria pickeru', () => {
  it('každá varianta z registru má neprázdný název v cs i en', () => {
    for (const id of VARIANT_IDS) {
      const key = VARIANT_KEYS[id];
      expect(key, `chybí klíč pro variantu ${id}`).toBeDefined();
      if (key === undefined) {
        continue;
      }
      setLocale('cs');
      expect(t(key).length).toBeGreaterThan(0);
      setLocale('en');
      expect(t(key).length).toBeGreaterThan(0);
    }
  });

  it('konkrétní překlady (cs vs en) sedí, Pool je v obou stejný', () => {
    setLocale('cs');
    expect(t('variant.american')).toBe('Americká');
    expect(t('variant.russian')).toBe('Ruská');
    expect(t('variant.czech')).toBe('Česká');
    expect(t('variant.pool')).toBe('Pool');
    setLocale('en');
    expect(t('variant.american')).toBe('American');
    expect(t('variant.russian')).toBe('Russian');
    expect(t('variant.czech')).toBe('Czech');
    expect(t('variant.pool')).toBe('Pool');
  });

  it('aria-label pickeru existuje v obou jazycích', () => {
    setLocale('cs');
    expect(t('lobby.variantAria').length).toBeGreaterThan(0);
    setLocale('en');
    expect(t('lobby.variantAria').length).toBeGreaterThan(0);
  });
});

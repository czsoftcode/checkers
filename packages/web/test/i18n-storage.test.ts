// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCALES,
  getLocale,
  initLocale,
  isLocale,
  loadStoredLocale,
  resolveInitialLocale,
  saveLocale,
} from '../src/i18n.js';

/**
 * Ruční volba jazyka (fáze 84): LocalStorage vrstva + startovní resolver s precedencí
 * uložená volba → prohlížeč → fallback. Běží v jsdom, protože sahá na `localStorage`
 * i `navigator.languages`. Zuby: testy 5-8 by spadly, kdyby resolver bral prohlížeč
 * NAD uloženou volbou, nebo kdyby uložené hodnotě slepě věřil bez validace.
 */

const STORAGE_KEY = 'checkers.locale';

/** Podvrhne prohlížeči seznam jazyků (vlastní property zastíní getter jsdom). */
function setBrowserLanguages(languages: readonly string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
}

/** Podvrhne jednotné `navigator.language` (fallback, když `languages` je prázdné). */
function setBrowserLanguage(language: string): void {
  Object.defineProperty(window.navigator, 'language', {
    value: language,
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  setBrowserLanguages([]);
  setBrowserLanguage('en-US'); // vrať jsdom default, ať #4 nepřeteče do dalších testů
  vi.restoreAllMocks();
  // Jedináček aktivního jazyka: vrať ho na detekci, ať test neovlivní další.
  initLocale();
});

describe('LOCALES / isLocale', () => {
  it('LOCALES je jediný zdroj pravdy: cs, en v tomto pořadí', () => {
    expect(LOCALES.map((l) => l.locale)).toEqual(['cs', 'en']);
  });

  it('isLocale: podporované true, cokoli jiného false', () => {
    expect(isLocale('cs')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale('CS')).toBe(false); // guard je case-sensitive; prefix normalizuje detectLocale
  });
});

describe('saveLocale / loadStoredLocale', () => {
  it('saveLocale zapíše volbu do LocalStorage', () => {
    saveLocale('cs');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('cs');
  });

  it('loadStoredLocale vrátí uloženou platnou hodnotu', () => {
    localStorage.setItem(STORAGE_KEY, 'en');
    expect(loadStoredLocale()).toBe('en');
  });

  it('nic uloženo → null', () => {
    expect(loadStoredLocale()).toBeNull();
  });

  it('neznámá hodnota („de") → null (nedůvěřuje slepě úložišti)', () => {
    localStorage.setItem(STORAGE_KEY, 'de');
    expect(loadStoredLocale()).toBeNull();
  });

  it('poškozená hodnota (JSON smetí) → null', () => {
    localStorage.setItem(STORAGE_KEY, '{"x":1}');
    expect(loadStoredLocale()).toBeNull();
  });

  it('nedostupné úložiště (getItem vyhodí, privátní režim) → null, ne pád', () => {
    // Zub proti odstranění try/catch: bez něj by SecurityError probublal ven.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled');
    });
    expect(loadStoredLocale()).toBeNull();
    spy.mockRestore();
  });

  it('saveLocale spolkne selhání zápisu (kvóta/privátní režim), nevyhodí', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveLocale('cs')).not.toThrow();
    spy.mockRestore();
  });
});

describe('resolveInitialLocale – precedence uložená volba → prohlížeč → fallback', () => {
  it('uložené „cs" přebije prohlížeč hlásící „en"', () => {
    setBrowserLanguages(['en-US']);
    saveLocale('cs');
    expect(resolveInitialLocale()).toBe('cs');
    expect(getLocale()).toBe('cs'); // resolver zároveň nastaví aktivní jazyk
  });

  it('uložené „en" přebije prohlížeč hlásící „cs" (opačný směr)', () => {
    setBrowserLanguages(['cs-CZ']);
    saveLocale('en');
    expect(resolveInitialLocale()).toBe('en');
    expect(getLocale()).toBe('en');
  });

  it('bez uložené volby spadne na detekci prohlížeče', () => {
    setBrowserLanguages(['cs-CZ']);
    expect(resolveInitialLocale()).toBe('cs');
  });

  it('poškozená uložená hodnota spadne na detekci prohlížeče, ne na fallback', () => {
    setBrowserLanguages(['cs-CZ']);
    localStorage.setItem(STORAGE_KEY, 'de');
    expect(resolveInitialLocale()).toBe('cs');
  });

  it('bez uložené volby a bez podporovaného jazyka prohlížeče → fallback en', () => {
    setBrowserLanguages(['fr-FR']);
    expect(resolveInitialLocale()).toBe('en');
  });

  it('prázdné navigator.languages → spadne na jednotné navigator.language', () => {
    // Privacy režim: `languages` bývá prázdné pole. Detekce musí sáhnout na `.language`.
    // Zub proti smazání fallbacku v browserLanguages (return [] místo čtení .language).
    setBrowserLanguages([]);
    setBrowserLanguage('cs-CZ');
    expect(resolveInitialLocale()).toBe('cs');
  });
});

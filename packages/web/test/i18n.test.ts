import { afterEach, describe, expect, it } from 'vitest';

import { detectLocale, getLocale, initLocale, setLocale, t, variantLabel } from '../src/i18n.js';

/**
 * Aktivní jazyk je modulový jedináček – aby jeden test neovlivnil druhý přes
 * ponechaný stav, po každém ho vrátíme na detekci z prohlížeče (initLocale).
 */
afterEach(() => {
  initLocale();
});

describe('detectLocale', () => {
  it('„cs-CZ" → cs (bere prefix, ne celý tag)', () => {
    expect(detectLocale(['cs-CZ'])).toBe('cs');
  });

  it('„en-US" → en', () => {
    expect(detectLocale(['en-US'])).toBe('en');
  });

  it('nepodporovaný jazyk („de") → fallback en', () => {
    expect(detectLocale(['de'])).toBe('en');
  });

  it('prázdný seznam → fallback en', () => {
    expect(detectLocale([])).toBe('en');
  });

  it('bere PRVNÍ podporovaný podle pořadí (de, cs, en → cs)', () => {
    expect(detectLocale(['de', 'cs', 'en'])).toBe('cs');
  });

  it('přeskočí nepodporovaný na začátku (fr-FR, en-GB → en)', () => {
    expect(detectLocale(['fr-FR', 'en-GB'])).toBe('en');
  });

  it('velikost písmen nerozhoduje („CS" → cs)', () => {
    expect(detectLocale(['CS'])).toBe('cs');
  });
});

describe('t – překlad a interpolace', () => {
  it('vrátí text aktivního jazyka (cs vs en)', () => {
    setLocale('cs');
    expect(t('lobby.title')).toBe('Herní místnosti');
    setLocale('en');
    expect(t('lobby.title')).toBe('Game rooms');
  });

  it('dosadí {nick} do šablony', () => {
    setLocale('cs');
    expect(t('lobby.challengeFrom', { nick: 'Eva' })).toBe('Eva tě vyzývá na partii');
    setLocale('en');
    expect(t('lobby.challengeFrom', { nick: 'Eva' })).toBe('Eva challenges you to a game');
  });

  it('dosadí i číselný parametr (přes String())', () => {
    setLocale('cs');
    expect(t('lobby.nickTaken', { suggestion: 42 })).toContain('42');
  });

  it('dosadí i nulu (číslo 0), ne prázdno – zub proti falsy-testu místo === undefined', () => {
    setLocale('cs');
    // Kdyby interpolace testovala truthy (`!value`) místo `=== undefined`, nula by
    // zmizela. Nula je validní hodnota a MUSÍ se dosadit doslova.
    expect(t('lobby.nickTaken', { suggestion: 0 })).toContain('0');
  });

  it('nedodaný placeholder zůstane doslova (hlasitá stopa, ne prázdno)', () => {
    setLocale('cs');
    expect(t('lobby.waitingFor')).toContain('{nick}');
  });
});

describe('app.title – titulek stránky', () => {
  it('má odlišný překlad v obou jazycích', () => {
    setLocale('cs');
    expect(t('app.title')).toBe('Americká dáma');
    setLocale('en');
    expect(t('app.title')).toBe('American Checkers');
  });
});

describe('variantLabel – sdílený holý název varianty', () => {
  it('přeloží každou variantu do aktivního jazyka (cs)', () => {
    setLocale('cs');
    expect(variantLabel('american')).toBe('Americká');
    expect(variantLabel('russian')).toBe('Ruská');
    expect(variantLabel('czech')).toBe('Česká');
    // Pool nemá zavedený český název → v obou jazycích „Pool".
    expect(variantLabel('pool')).toBe('Pool');
  });

  it('přepne s jazykem (en)', () => {
    setLocale('en');
    expect(variantLabel('american')).toBe('American');
    expect(variantLabel('russian')).toBe('Russian');
    expect(variantLabel('czech')).toBe('Czech');
  });
});

describe('setLocale / getLocale', () => {
  it('setLocale přepíše aktivní jazyk čtený přes getLocale', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    setLocale('cs');
    expect(getLocale()).toBe('cs');
  });
});

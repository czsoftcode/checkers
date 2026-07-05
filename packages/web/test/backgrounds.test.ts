import { describe, expect, it } from 'vitest';

import { pickBackground } from '../src/backgrounds.js';

describe('pickBackground', () => {
  const urls = ['/a.webp', '/b.webp', '/c.webp'];

  it('deterministicky vybere prvek podle rng', () => {
    // rng() v [0,1) → index = floor(rng * délka). 0 → první, ~0.5 → prostřední, ~0.99 → poslední.
    expect(pickBackground(urls, () => 0)).toBe('/a.webp');
    expect(pickBackground(urls, () => 0.5)).toBe('/b.webp');
    expect(pickBackground(urls, () => 0.99)).toBe('/c.webp');
  });

  it('vrací vždy prvek ze seznamu', () => {
    for (const r of [0, 0.1, 0.33, 0.5, 0.7, 0.999]) {
      expect(urls).toContain(pickBackground(urls, () => r));
    }
  });

  it('prázdný seznam → undefined bez výjimky', () => {
    expect(pickBackground([], () => 0.5)).toBeUndefined();
    expect(pickBackground([], () => 0)).toBeUndefined();
  });

  it('rng vracející přesně 1 (mimo kontrakt) index nepřeteče', () => {
    // Math.floor(1 * 3) = 3 → mimo pole; clamp na poslední prvek, ne undefined.
    expect(pickBackground(urls, () => 1)).toBe('/c.webp');
  });

  it('jeden prvek → vždy on', () => {
    expect(pickBackground(['/only.webp'], () => 0)).toBe('/only.webp');
    expect(pickBackground(['/only.webp'], () => 0.99)).toBe('/only.webp');
  });

  it('exclude se nikdy nevrátí napříč indexy rng', () => {
    // Vyloučíme prostřední. Pool = ['/a', '/c']; ať rng vrátí cokoli, '/b' nesmí padnout.
    for (const r of [0, 0.1, 0.33, 0.49, 0.5, 0.7, 0.99, 1]) {
      expect(pickBackground(urls, () => r, '/b.webp')).not.toBe('/b.webp');
    }
  });

  it('exclude posune distribuci na pool.length, ne urls.length', () => {
    // Pool po vyloučení '/b' = ['/a', '/c'] (délka 2). rng 0 → '/a', 0.5 → '/c'.
    // Kdyby se losovalo přes urls.length (3), 0.5 by dalo '/b' – to by byla chyba.
    expect(pickBackground(urls, () => 0, '/b.webp')).toBe('/a.webp');
    expect(pickBackground(urls, () => 0.5, '/b.webp')).toBe('/c.webp');
  });

  it('jediný obrázek == exclude → fallback vrátí právě on', () => {
    // Pool by byl prázdný; radši zopakovat pozadí než vrátit undefined.
    expect(pickBackground(['/only.webp'], () => 0, '/only.webp')).toBe('/only.webp');
    expect(pickBackground(['/only.webp'], () => 0.99, '/only.webp')).toBe('/only.webp');
  });

  it('zastaralý exclude mimo seznam → normální výběr', () => {
    // '/x' v seznamu není → nic se nevyřadí, chová se jako bez exclude.
    expect(pickBackground(urls, () => 0, '/x.webp')).toBe('/a.webp');
    expect(pickBackground(urls, () => 0.5, '/x.webp')).toBe('/b.webp');
    expect(pickBackground(urls, () => 0.99, '/x.webp')).toBe('/c.webp');
  });

  it('exclude undefined → beze změny oproti výběru bez exclude', () => {
    for (const r of [0, 0.33, 0.5, 0.99]) {
      expect(pickBackground(urls, () => r, undefined)).toBe(pickBackground(urls, () => r));
    }
  });

  it('prázdný seznam → undefined i s exclude', () => {
    expect(pickBackground([], () => 0.5, '/whatever.webp')).toBeUndefined();
  });
});

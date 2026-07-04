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
});

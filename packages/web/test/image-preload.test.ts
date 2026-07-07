import { describe, expect, it } from 'vitest';

import { preloadImages } from '../src/image-preload.js';

/**
 * Falešný `Image`: po nastavení `src` asynchronně (microtask) vyvolá `onload`,
 * nebo `onerror`, pokud je URL v `failUrls`. Tak jde deterministicky otestovat,
 * že `preloadImages` sečte výsledky správně, bez reálného načítání.
 */
function fakeImageFactory(failUrls: ReadonlySet<string>): () => HTMLImageElement {
  return () => {
    const img = {
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set src(value: string) {
        void Promise.resolve().then(() => {
          if (failUrls.has(value)) {
            this.onerror?.();
          } else {
            this.onload?.();
          }
        });
      },
    };
    return img as unknown as HTMLImageElement;
  };
}

describe('preloadImages', () => {
  const urls = ['/black.webp', '/white.webp', '/black_queen.webp', '/white_queen.webp'];

  it('všechny obrázky se načtou → true', async () => {
    const ok = await preloadImages(urls, fakeImageFactory(new Set()));
    expect(ok).toBe(true);
  });

  it('jediný obrázek selže → false (žádný mix webp/fallback)', async () => {
    const ok = await preloadImages(urls, fakeImageFactory(new Set(['/white_queen.webp'])));
    expect(ok).toBe(false);
  });

  it('všechny selžou → false', async () => {
    const ok = await preloadImages(urls, fakeImageFactory(new Set(urls)));
    expect(ok).toBe(false);
  });

  it('prázdný seznam → false (není co zapnout), bez volání factory', async () => {
    let called = false;
    const factory = (): HTMLImageElement => {
      called = true;
      return fakeImageFactory(new Set())();
    };
    const ok = await preloadImages([], factory);
    expect(ok).toBe(false);
    expect(called).toBe(false);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { BOARD_IMG_CLASS, boardImageUrl, enableBoardImage } from '../src/board-image.js';
import { enablePieceImages, PIECES_IMG_CLASS, pieceImageUrls } from '../src/piece-images.js';

/**
 * Falešný `Image`: po nastavení `src` asynchronně (microtask) vyvolá `onload`, nebo
 * `onerror`, když je URL v `failUrls`. Umožní deterministicky ověřit, že enable
 * funkce přidají SPRÁVNOU třídu na kořen podle výsledku načtení – bez reálného
 * načítání (v jsdom by se `onload`/`onerror` nikdy nevyvolaly a promise by visela).
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

/** Počká, až doběhnou microtasky (Promise.all + navazující .then v enable funkci). */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('enablePieceImages', () => {
  it('při načtení všech kamenů přidá pieces-img na kořen', async () => {
    const root = document.createElement('div');
    enablePieceImages(root, fakeImageFactory(new Set()));
    await flush();
    expect(root.classList.contains(PIECES_IMG_CLASS)).toBe(true);
  });

  it('když jediný kámen selže, třídu NEpřidá (žádný mix)', async () => {
    const root = document.createElement('div');
    enablePieceImages(root, fakeImageFactory(new Set([pieceImageUrls[0]!])));
    await flush();
    expect(root.classList.contains(PIECES_IMG_CLASS)).toBe(false);
  });

  it('bez Image v prostředí (createImage=null) nic neudělá', async () => {
    const root = document.createElement('div');
    enablePieceImages(root, null);
    await flush();
    expect(root.className).toBe('');
  });

  it('přidá právě pieces-img, ne board-img (zub proti prohození tříd)', async () => {
    const root = document.createElement('div');
    enablePieceImages(root, fakeImageFactory(new Set()));
    await flush();
    expect(root.className).toBe(PIECES_IMG_CLASS);
  });
});

describe('enableBoardImage', () => {
  it('při načtení desky přidá board-img na kořen', async () => {
    const root = document.createElement('div');
    enableBoardImage(root, fakeImageFactory(new Set()));
    await flush();
    expect(root.classList.contains(BOARD_IMG_CLASS)).toBe(true);
  });

  it('když se deska nenačte, třídu NEpřidá', async () => {
    const root = document.createElement('div');
    enableBoardImage(root, fakeImageFactory(new Set([boardImageUrl])));
    await flush();
    expect(root.classList.contains(BOARD_IMG_CLASS)).toBe(false);
  });

  it('přidá právě board-img, ne pieces-img (zub proti prohození tříd)', async () => {
    const root = document.createElement('div');
    enableBoardImage(root, fakeImageFactory(new Set()));
    await flush();
    expect(root.className).toBe(BOARD_IMG_CLASS);
  });
});

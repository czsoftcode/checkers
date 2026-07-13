// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  BOARD_IMG_CLASS,
  boardImageUrl,
  enableBoardImage,
  italianBoardImageUrl,
} from '../src/board-image.js';
import {
  enablePieceImages,
  italianPieceImageUrls,
  PIECES_IMG_CLASS,
  pieceImageUrls,
} from '../src/piece-images.js';

/**
 * Falešný `Image`: po nastavení `src` asynchronně (microtask) vyvolá `onload`, nebo
 * `onerror`, když je URL v `failUrls`. Umožní deterministicky ověřit, že enable
 * funkce přidají SPRÁVNOU třídu na kořen podle výsledku načtení – bez reálného
 * načítání (v jsdom by se `onload`/`onerror` nikdy nevyvolaly a promise by visela).
 * `requested` sbírá všechny nastavené `src`, ať jde ověřit, KTERÉ URL varianta žádá.
 */
function fakeImageFactory(
  failUrls: ReadonlySet<string>,
  requested: string[] = [],
): () => HTMLImageElement {
  return () => {
    const img = {
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set src(value: string) {
        requested.push(value);
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
    enablePieceImages(root, 'american', fakeImageFactory(new Set()));
    await flush();
    expect(root.classList.contains(PIECES_IMG_CLASS)).toBe(true);
  });

  it('když jediný kámen selže, třídu NEpřidá (žádný mix)', async () => {
    const root = document.createElement('div');
    enablePieceImages(root, 'american', fakeImageFactory(new Set([pieceImageUrls[0]!])));
    await flush();
    expect(root.classList.contains(PIECES_IMG_CLASS)).toBe(false);
  });

  it('bez Image v prostředí (createImage=null) nic neudělá', async () => {
    const root = document.createElement('div');
    enablePieceImages(root, 'american', null);
    await flush();
    expect(root.className).toBe('');
  });

  it('přidá právě pieces-img, ne board-img (zub proti prohození tříd)', async () => {
    const root = document.createElement('div');
    enablePieceImages(root, 'american', fakeImageFactory(new Set()));
    await flush();
    expect(root.className).toBe(PIECES_IMG_CLASS);
  });

  it('americká přednačte ČERNÉ kameny, ne červené (regrese: žádné red.webp)', async () => {
    const root = document.createElement('div');
    const requested: string[] = [];
    enablePieceImages(root, 'american', fakeImageFactory(new Set(), requested));
    await flush();
    expect(requested).toEqual([...pieceImageUrls]);
    expect(requested.some((u) => u.includes('red'))).toBe(false);
  });

  it('italská přednačte ČERVENÉ „black" kameny (red/red_queen), bílé sdílené', async () => {
    const root = document.createElement('div');
    const requested: string[] = [];
    enablePieceImages(root, 'italian', fakeImageFactory(new Set(), requested));
    await flush();
    expect(requested).toEqual([...italianPieceImageUrls]);
    // italská nesmí žádat americké „black" kameny
    expect(requested).not.toContain(pieceImageUrls[0]);
    // Nezávisle na konstantě: musí být přítomné červené „black" kameny (red/red_queen).
    expect(requested.some((u) => u.includes('red.webp'))).toBe(true);
    expect(requested.some((u) => u.includes('red_queen.webp'))).toBe(true);
    expect(root.classList.contains(PIECES_IMG_CLASS)).toBe(true);
  });
});

describe('enableBoardImage', () => {
  it('při načtení desky přidá board-img na kořen', async () => {
    const root = document.createElement('div');
    enableBoardImage(root, 'american', fakeImageFactory(new Set()));
    await flush();
    expect(root.classList.contains(BOARD_IMG_CLASS)).toBe(true);
  });

  it('když se deska nenačte, třídu NEpřidá', async () => {
    const root = document.createElement('div');
    enableBoardImage(root, 'american', fakeImageFactory(new Set([boardImageUrl])));
    await flush();
    expect(root.classList.contains(BOARD_IMG_CLASS)).toBe(false);
  });

  it('přidá právě board-img, ne pieces-img (zub proti prohození tříd)', async () => {
    const root = document.createElement('div');
    enableBoardImage(root, 'american', fakeImageFactory(new Set()));
    await flush();
    expect(root.className).toBe(BOARD_IMG_CLASS);
  });

  it('americká přednačte game_board, ne right_game_board (regrese)', async () => {
    const root = document.createElement('div');
    const requested: string[] = [];
    enableBoardImage(root, 'american', fakeImageFactory(new Set(), requested));
    await flush();
    expect(requested).toEqual([boardImageUrl]);
    // Nezávisle na konstantě: americká URL nese `game_board`, NE `right_game_board`.
    expect(requested[0]).toMatch(/game_board/);
    expect(requested[0]).not.toMatch(/right_game_board/);
  });

  it('italská přednačte right_game_board (otočená deska)', async () => {
    const root = document.createElement('div');
    const requested: string[] = [];
    enableBoardImage(root, 'italian', fakeImageFactory(new Set(), requested));
    await flush();
    expect(requested).toEqual([italianBoardImageUrl]);
    expect(requested).not.toContain(boardImageUrl);
    // Nezávislý string-check (chytne i záměnu OBSAHU konstanty, ne jen za americkou).
    expect(requested[0]).toMatch(/right_game_board/);
    expect(root.classList.contains(BOARD_IMG_CLASS)).toBe(true);
  });
});

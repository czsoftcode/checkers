/**
 * Volitelné OBRÁZKOVÉ kameny (webp) místo CSS gradientu.
 *
 * Ve `assets/` jsou čtyři webp kameny (man i dáma, obě barvy). Chceme je použít,
 * ale JEN když se opravdu načtou – jinak deska spadne zpět na dnešní CSS vzhled
 * (gradient + korunka přes `::before`). Proto se webp NEzapínají natvrdo v CSS:
 * `enablePieceImages` nejdřív ověří načtení všech čtyř a teprve při úspěchu přidá
 * na `.board` třídu {@link PIECES_IMG_CLASS}, pod kterou CSS obrázky použije.
 *
 * Buď VŠECHNY, nebo ŽÁDNÝ: kdyby se načetla jen část, deska by míchala webp kámen
 * s gradientovou dámou – radši jednotný fallback. Ověření načtení dělá sdílené
 * `preloadImages` (viz `image-preload.ts`, testováno v `test/image-preload.test.ts`).
 *
 * CSP: samotné obrázky používá `styles.css` přes `url(...)` (Vite je při buildu
 * přepíše na hashované cesty, stejně jako pozadí) – žádný inline styl. Tady jen
 * přepínáme třídu přes `classList`, což CSP neřeší.
 */

import type { VariantId } from '@checkers/rules';

import blackUrl from './assets/black.webp?url';
import blackQueenUrl from './assets/black_queen.webp?url';
import redUrl from './assets/red.webp?url';
import redQueenUrl from './assets/red_queen.webp?url';
import whiteUrl from './assets/white.webp?url';
import whiteQueenUrl from './assets/white_queen.webp?url';
import { preloadImages } from './image-preload.js';

/** Třída na `.board`, pod kterou `styles.css` použije webp a skryje CSS korunku. */
export const PIECES_IMG_CLASS = 'pieces-img';

/**
 * URL všech čtyř webp kamenů. Musí odpovídat `url(...)` ve `styles.css` – Vite
 * ze stejného souboru vygeneruje stejnou hashovanou cestu, takže co tady ověříme
 * načtením, to CSS opravdu použije.
 */
export const pieceImageUrls: readonly string[] = [blackUrl, whiteUrl, blackQueenUrl, whiteQueenUrl];

/**
 * URL kamenů ITALSKÉ varianty: vnitřní „black" nahrazuje ČERVENÝ kámen
 * (`red.webp`/`red_queen.webp`), „white" zůstává sdílený. Musí odpovídat
 * `url(...)` ve `styles.css` (`.board.variant-italian.pieces-img .piece.black`).
 */
export const italianPieceImageUrls: readonly string[] = [redUrl, whiteUrl, redQueenUrl, whiteQueenUrl];

/** Sada URL kamenů pro variantu: italská má červené „black", ostatní sdílejí černé. */
function pieceUrlsFor(variant: VariantId): readonly string[] {
  return variant === 'italian' ? italianPieceImageUrls : pieceImageUrls;
}

/**
 * Fire-and-forget: zkusí načíst webp kameny a při úspěchu přidá
 * {@link PIECES_IMG_CLASS} na `root` (`.board`). Při neúspěchu neudělá nic a deska
 * zůstane na CSS fallbacku.
 *
 * `createImage` se injektuje kvůli testu (ať jde ověřit přidání třídy bez reálného
 * načítání); ve hře je výchozí `() => new Image()`. Výchozí hodnota je `null`, když
 * v prostředí není `Image` (čistý Node bez DOM) – pak funkce nic neudělá.
 * POZOR na jsdom (testy): tam `Image` EXISTUJE, takže se `new Image()` vytvoří, ale
 * jsdom bez `resources:'usable'` obrázky nenačítá → `onload`/`onerror` nevystřelí a
 * promise zůstane viset (třída se nikdy nepřidá). Fallback v board-view testech
 * proto drží tímto „nikdy nenačte", ne guardem výše – guard chrání jen čistý Node.
 */
export function enablePieceImages(
  root: HTMLElement,
  variant: VariantId,
  createImage: (() => HTMLImageElement) | null = typeof Image === 'function'
    ? (): HTMLImageElement => new Image()
    : null,
): void {
  if (createImage === null) {
    return;
  }
  void preloadImages(pieceUrlsFor(variant), createImage).then((ok) => {
    if (ok) {
      root.classList.add(PIECES_IMG_CLASS);
    }
  });
}

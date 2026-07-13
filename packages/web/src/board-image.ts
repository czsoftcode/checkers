/**
 * Volitelná OBRÁZKOVÁ deska (webp) místo barevných polí.
 *
 * `assets/game_board.webp` je hotová dřevěná šachovnice 8×8. Roztáhne se přes
 * `.board` jako jedno pozadí (`background-size: 100% 100%` ve `styles.css`) a
 * jednotlivá pole (`.square`) se zprůhlední, ať dřevo prosvítá; zvýraznění pak
 * kreslí poloprůhledný overlay. Zapíná se STEJNĚ jako obrázkové kameny: teprve po
 * ověření, že se obrázek načte, přidá `enableBoardImage` na `.board` třídu
 * {@link BOARD_IMG_CLASS}. Při chybě/jsdom zůstanou dnešní barevná pole (fallback).
 *
 * POZOR na zarovnání: obrázek nese vlastní 8×8 mřížku a musí lícovat s DOM mřížkou
 * polí. Roztažení 1:1 přes čtvercovou desku to drží jen když je mřížka v obrázku
 * rovnoměrná; drobné rozsladění zvýraznění/kamenů vůči dřevu je očekávané riziko
 * této cesty (viz alternativa „dlaždice na pole").
 *
 * CSP: obrázek řeší `styles.css` přes `url(...)` (Vite → hashovaná cesta), tady
 * jen přepínáme třídu přes `classList`.
 */

import type { VariantId } from '@checkers/rules';

import boardUrl from './assets/game_board.webp?url';
import italianBoardUrl from './assets/right_game_board.webp?url';
import { preloadImages } from './image-preload.js';

/** Třída na `.board`, pod kterou `styles.css` použije obrázkovou desku. */
export const BOARD_IMG_CLASS = 'board-img';

/** URL obrázku desky. Musí odpovídat `url(...)` ve `styles.css` (stejný Vite hash). */
export const boardImageUrl: string = boardUrl;

/**
 * URL desky ITALSKÉ varianty (`right_game_board.webp`). Jiná kresba dřeva, ale
 * STEJNÁ parita hracích polí jako `game_board.webp` (tmavé vlevo nahoře i vpravo
 * dole), takže lícuje se stejnou DOM mřížkou bez rotace. Musí odpovídat
 * `url(...)` ve `styles.css` (`.board.variant-italian.board-img`).
 */
export const italianBoardImageUrl: string = italianBoardUrl;

/** URL desky pro danou variantu: italská má vlastní obrázek, ostatní sdílejí americký. */
function boardUrlFor(variant: VariantId): string {
  return variant === 'italian' ? italianBoardImageUrl : boardImageUrl;
}

/**
 * Fire-and-forget: zkusí načíst obrázek desky PRO DANOU VARIANTU a při úspěchu
 * přidá {@link BOARD_IMG_CLASS} na `root` (`.board`). Při neúspěchu neudělá nic a
 * deska zůstane na barevných polích. Výběr obrázku podle varianty (italská →
 * `right_game_board.webp`, ostatní → `game_board.webp`); samotné přepnutí na
 * správný obrázek řeší `styles.css` přes `.variant-italian`, tady jen přednačteme
 * odpovídající URL, ať se třída přidá teprve po jistotě načtení.
 *
 * `createImage` se injektuje kvůli testu; ve hře je výchozí `() => new Image()`,
 * a `null` když v prostředí `Image` není (čistý Node) – pak funkce nic neudělá.
 * Chování v jsdom je stejné jako u {@link enablePieceImages}: `Image` tam existuje,
 * ale nic se nenačte, takže promise visí a třída se nepřidá (fallback drží tímto,
 * ne guardem).
 */
export function enableBoardImage(
  root: HTMLElement,
  variant: VariantId,
  createImage: (() => HTMLImageElement) | null = typeof Image === 'function'
    ? (): HTMLImageElement => new Image()
    : null,
): void {
  if (createImage === null) {
    return;
  }
  void preloadImages([boardUrlFor(variant)], createImage).then((ok) => {
    if (ok) {
      root.classList.add(BOARD_IMG_CLASS);
    }
  });
}

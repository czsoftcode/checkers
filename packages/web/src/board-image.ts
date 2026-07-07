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

import boardUrl from './assets/game_board.webp?url';
import { preloadImages } from './image-preload.js';

/** Třída na `.board`, pod kterou `styles.css` použije obrázkovou desku. */
export const BOARD_IMG_CLASS = 'board-img';

/** URL obrázku desky. Musí odpovídat `url(...)` ve `styles.css` (stejný Vite hash). */
export const boardImageUrl: string = boardUrl;

/**
 * Fire-and-forget: zkusí načíst obrázek desky a při úspěchu přidá
 * {@link BOARD_IMG_CLASS} na `root` (`.board`). Při neúspěchu neudělá nic a deska
 * zůstane na barevných polích.
 *
 * `createImage` se injektuje kvůli testu; ve hře je výchozí `() => new Image()`,
 * a `null` když v prostředí `Image` není (čistý Node) – pak funkce nic neudělá.
 * Chování v jsdom je stejné jako u {@link enablePieceImages}: `Image` tam existuje,
 * ale nic se nenačte, takže promise visí a třída se nepřidá (fallback drží tímto,
 * ne guardem).
 */
export function enableBoardImage(
  root: HTMLElement,
  createImage: (() => HTMLImageElement) | null = typeof Image === 'function'
    ? (): HTMLImageElement => new Image()
    : null,
): void {
  if (createImage === null) {
    return;
  }
  void preloadImages([boardImageUrl], createImage).then((ok) => {
    if (ok) {
      root.classList.add(BOARD_IMG_CLASS);
    }
  });
}

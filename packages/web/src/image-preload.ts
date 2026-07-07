/**
 * Sdílené ověření načtení obrázků. Používají ho obrázkové kameny
 * (`piece-images.ts`) i obrázková deska (`board-image.ts`): oba chtějí přepnout
 * vzhled na webp AŽ po jistotě, že se obrázky opravdu načtou, jinak zůstat na CSS
 * fallbacku. Logika je oddělená od DOM, aby šla testovat bez reálného načítání
 * (injektovatelná továrna na `Image` – viz `test/image-preload.test.ts`).
 */

/**
 * Ověří, že se NAČTOU VŠECHNY zadané obrázky. Vrátí `true`, jen když každý skončí
 * událostí `load`; jediný `error` (chybějící soubor, poškozený obrázek) → `false`.
 * Prázdný seznam → `false` (není co zapnout). `createImage` se injektuje kvůli
 * testu; ve hře je to `() => new Image()`. Nikdy nevyhazuje ani neodmítá promise.
 */
export function preloadImages(
  urls: readonly string[],
  createImage: () => HTMLImageElement,
): Promise<boolean> {
  if (urls.length === 0) {
    return Promise.resolve(false);
  }
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<boolean>((resolve) => {
          const img = createImage();
          img.onload = (): void => resolve(true);
          img.onerror = (): void => resolve(false);
          img.src = url;
        }),
    ),
  ).then((results) => results.every(Boolean));
}

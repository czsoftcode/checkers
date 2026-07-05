/**
 * Globální příprava testů běžících v jsdom.
 *
 * jsdom neimplementuje `HTMLMediaElement.prototype.play()` – při volání vypíše
 * „Not implemented: HTMLMediaElement's play() method" a hodí výjimku. Produkční
 * kód to korektně spolkne (viz `safePlay` v `sound.ts`), ale jsdom tu hlášku
 * stejně vypíše dřív, než výjimku hodí, a zaplevelí výstup testů. Tady `play()`
 * nahradíme neškodným no-opem vracejícím splněný příslib – shim testového
 * prostředí, ne změna chování aplikace.
 *
 * V node prostředí (`HTMLMediaElement` neexistuje) se nic nestane.
 */
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = (): Promise<void> => Promise.resolve();
  // Pause je také „not implemented"; ať shim pokrývá i případné budoucí použití.
  HTMLMediaElement.prototype.pause = (): void => undefined;
}

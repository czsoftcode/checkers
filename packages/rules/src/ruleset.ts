/**
 * Ruleset – parametry varianty, které mění chování generátoru tahů.
 *
 * Záměrně MINIMÁLNÍ: obsahuje jen to, co už tato fáze čte v `moves.ts`.
 * Další pole (`flying` dáma, proměna uprostřed braní `promoteMidCapture`,
 * priorita/maximum braní) se dolijí, až je bude číst reálný kód – ne dřív,
 * ať nevznikne dead config.
 *
 * Varianta patří do GameState / metadat místnosti, NE do hashované Position
 * (Zobrist zůstává position-only) – Ruleset se proto protahuje parametrem,
 * ne polem pozice.
 */
export interface Ruleset {
  /** Smí muž brát i dozadu? Americká dáma: ne (bere jen vpřed). */
  readonly manCaptureBackward: boolean;
  /** Dosah dámy. `'short'` = o 1 pole jako dnes; `'flying'` přijde ve fázi B. */
  readonly king: 'short';
}

/**
 * Výchozí ruleset = americká dáma (English draughts). Muž bere jen vpřed,
 * dáma krátká. Slouží jako default všude, kde volající ruleset (zatím)
 * nepředává – proto se dosavadní chování nemění.
 */
export const AMERICAN_RULESET: Ruleset = {
  manCaptureBackward: false,
  king: 'short',
};

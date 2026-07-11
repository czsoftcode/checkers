/**
 * Ruleset – parametry varianty, které mění chování generátoru tahů.
 *
 * Záměrně MINIMÁLNÍ: obsahuje jen to, co reálně čte generátor / apply / notace.
 * Další pole (proměna uprostřed braní `promoteMidCapture`, priorita/maximum
 * braní) se dolijí, až je bude číst reálný kód – ne dřív, ať nevznikne dead
 * config.
 *
 * Varianta patří do GameState / metadat místnosti, NE do hashované Position
 * (Zobrist zůstává position-only) – Ruleset se proto protahuje parametrem,
 * ne polem pozice.
 */
export interface Ruleset {
  /** Smí muž brát i dozadu? Americká dáma: ne (bere jen vpřed). */
  readonly manCaptureBackward: boolean;
  /**
   * Dosah dámy. `'short'` = o 1 pole (americká); `'flying'` = létavá dáma,
   * klouže po diagonále přes prázdná pole, dokud nenarazí na kámen nebo okraj
   * (ruská, česká, pool). Braní létavé dámy je zatím MIMO řez (fáze B2).
   */
  readonly king: 'short' | 'flying';
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

/**
 * Pool checkers (American pool checkers, APCA): muž bere vpřed i VZAD, dáma je
 * LÉTAVÁ (klouže po diagonále, turecký úder). Proměna: muž, který během braní
 * dosáhne dámské řady, se proměd na dámu a KONČÍ tah – nepokračuje v braní
 * (viz `extendJumps` v moves.ts). Tím se pool liší od ruské, kde muž po proměně
 * uprostřed braní pokračuje jako dáma (zatím neimplementováno). Proměna
 * uprostřed braní proto NENÍ samostatné pole Rulesetu – „stop" je společné
 * chování s americkou a plyne z generátoru, ne z configu.
 */
export const POOL_RULESET: Ruleset = {
  manCaptureBackward: true,
  king: 'flying',
};

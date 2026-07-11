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
  /**
   * Proměna UPROSTŘED braní: muž, který během skokové sekvence DOPADNE na
   * proměnnou (poslední) řadu, se v tom okamžiku stává létavou dámou a MUSÍ,
   * může-li, pokračovat v braní letmo (ruská dáma). `false` = muž braním na
   * proměnné řadě KONČÍ (americká, pool). Vyžaduje `king: 'flying'`, jinak
   * by po proměně neměl kam klouzat – kombinace `promoteMidCapture` bez
   * létavé dámy nemá v této vlně variant smysl a generátor ji nepoužívá.
   */
  readonly promoteMidCapture: boolean;
}

/**
 * Výchozí ruleset = americká dáma (English draughts). Muž bere jen vpřed,
 * dáma krátká. Slouží jako default všude, kde volající ruleset (zatím)
 * nepředává – proto se dosavadní chování nemění.
 */
export const AMERICAN_RULESET: Ruleset = {
  manCaptureBackward: false,
  king: 'short',
  promoteMidCapture: false,
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
  promoteMidCapture: false,
};

/**
 * Ruská dáma (Russian draughts, „шашки"): jako pool (muž bere vpřed i VZAD,
 * dáma LÉTAVÁ, turecký úder), ale s PROMĚNOU UPROSTŘED BRANÍ – muž, který
 * během skokové sekvence dopadne na proměnnou řadu, se HNED stává létavou
 * dámou a pokračuje v braní letmo. Tím jediným polem (`promoteMidCapture`)
 * se ruská liší od pool; do proměny (hloubka < 7 z otevírací pozice) jsou
 * stromy tahů pool a ruské PROKAZATELNĚ shodné (viz perft-russian.test.ts).
 */
export const RUSSIAN_RULESET: Ruleset = {
  manCaptureBackward: true,
  king: 'flying',
  promoteMidCapture: true,
};

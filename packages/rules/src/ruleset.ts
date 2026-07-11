/**
 * Ruleset – parametry varianty, které mění chování generátoru tahů.
 *
 * Záměrně MINIMÁLNÍ: každé pole reálně čte generátor / apply / legalMoves –
 * žádný dead config. Nové pole se přidává teprve, až je čte kód (tak přibylo
 * `promoteMidCapture` pro ruskou a `kingCapturePriority` pro českou). Pravidlo
 * MAXIMA braní (musí brát nejvíc) záměrně chybí – žádná varianta této vlny ho
 * nepoužívá; dolije se, až bude na řadě mezinárodní dáma.
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
  /**
   * Kvalitativní PŘEDNOST braní dámou (česká varianta): existuje-li mezi
   * legálními skoky aspoň jeden, kde bere DÁMA, MUSÍ hráč brát dámou – všechny
   * skoky mužem se vypustí. Jde jen o kvalitu (dáma > muž), NE o maximum
   * (nemusí brát nejvíc kamenů). `false` = žádná přednost, skoky muže i dámy
   * jsou rovnocenné (americká, pool, ruská). Filtr žije v `legalMoves`
   * (public gate), ne v generátoru – stavební bloky zůstávají beze změny.
   */
  readonly kingCapturePriority: boolean;
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
  kingCapturePriority: false,
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
  kingCapturePriority: false,
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
  kingCapturePriority: false,
};

/**
 * Česká dáma (Czech draughts, „dáma"): muž bere JEN VPŘED (na rozdíl od pool a
 * ruské – `manCaptureBackward: false`), dáma je LÉTAVÁ (`king: 'flying'`),
 * proměna až NA KONCI tahu (`promoteMidCapture: false`, jako pool – NE ruská
 * proměna uprostřed braní) a platí KVALITATIVNÍ PŘEDNOST braní dámou
 * (`kingCapturePriority: true`): může-li v pozici brát dáma, hráč MUSÍ brát
 * dámou. Žádné pravidlo maxima – jen kvalita dámy nad mužem.
 *
 * Otevírací perft se v mělkých hloubkách kryje s americkou (muž jen vpřed,
 * dámy ještě nejsou) – to je zadarmo cross-check bitu `manCaptureBackward`.
 * Zdroj pravidel potvrzen uživatelem (český hráč) + brainking.com.
 */
export const CZECH_RULESET: Ruleset = {
  manCaptureBackward: false,
  king: 'flying',
  promoteMidCapture: false,
  kingCapturePriority: true,
};

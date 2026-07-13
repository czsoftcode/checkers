/**
 * Ruleset – parametry varianty, které mění chování generátoru tahů.
 *
 * Většina polí reálně čte generátor / apply / legalMoves. VÝJIMKA (fáze 111):
 * `mustCaptureMaximum`, `capturePriority` a `manCannotCaptureKing` jsou tři
 * pole italské varianty, která zatím PŘEDBÍHAJÍ svého čtenáře – deklarují se
 * a plní defaulty do všech variant, ale `legalMoves` je ještě NEČTE. Italská
 * pravidla (generační omezení, maximum, FID priorita) dorazí ve fázích IT-2
 * až IT-5; do té doby jsou tato pole u italské SPÍCÍ (viz `ITALIAN_RULESET`
 * a jeho registrace mimo `VARIANT_IDS`). Ostatní varianty je mají na defaultu,
 * takže se jejich chování nemění.
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
  /**
   * Pravidlo MAXIMA braní (italská, mezinárodní): existuje-li více braní,
   * hráč MUSÍ zvolit to, které bere NEJVÍC kamenů. `false` = žádné maximum,
   * stačí brát cokoli (americká, pool, ruská, česká). Fáze 111 pole jen
   * deklaruje; `legalMoves` ho zatím NEČTE (vynucení přijde v IT-2..IT-5).
   */
  readonly mustCaptureMaximum: boolean;
  /**
   * PRIORITA braní podle italských pravidel (FID). `'italianFull'` = plná
   * italská kaskáda kritérií (maximum → braní dámou → nejvíc dam → …).
   * `'none'` = žádná italská priorita (americká, pool, ruská; česká má svou
   * vlastní kvalitativní přednost přes `kingCapturePriority`, sem NEpatří).
   * Enum je ZÁMĚRNĚ osekaný – `'kingQuality'` se nepřidává, nikdo by ho
   * nepoužil. Fáze 111 pole jen deklaruje; `legalMoves` ho zatím NEČTE.
   */
  readonly capturePriority: 'none' | 'italianFull';
  /**
   * Zákaz braní dámy MUŽEM (italská): muž NESMÍ přeskočit (brát) dámu –
   * takové braní je nelegální. `false` = muž bere dámu i kámen bez rozdílu
   * (americká, pool, ruská, česká). Fáze 111 pole jen deklaruje; `legalMoves`
   * ho zatím NEČTE (vynucení přijde v IT-2..IT-5).
   */
  readonly manCannotCaptureKing: boolean;
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
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
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
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
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
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
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
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
};

/**
 * Italská dáma (Italian draughts, „dama italiana"): muž bere JEN VPŘED
 * (`manCaptureBackward: false`), dáma je KRÁTKÁ (`king: 'short'`, o 1 pole –
 * NE létavá), proměna až na konci tahu (`promoteMidCapture: false`). Navíc tři
 * italská specifika: MUSÍ se brát maximum kamenů (`mustCaptureMaximum: true`),
 * plná FID priorita braní (`capturePriority: 'italianFull'`) a muž NESMÍ brát
 * dámu (`manCannotCaptureKing: true`).
 *
 * SPÍCÍ (fáze 111): tři nová pole `legalMoves` zatím NEČTE, takže tenhle
 * ruleset se chová jako „muž vpřed + krátká dáma", dokud nedorazí vynucení
 * v IT-2..IT-5. Registruje se mimo `VARIANT_IDS` (viz variant.ts) – je ZNÁMÝ
 * (`isVariantId('italian')=true`), ale NENÍ v nabídce lobby, takže k němu
 * nevede dosažitelná herní cesta a spící vlajky nemůžou tiše rozehrát partii.
 */
export const ITALIAN_RULESET: Ruleset = {
  manCaptureBackward: false,
  king: 'short',
  promoteMidCapture: false,
  kingCapturePriority: false,
  mustCaptureMaximum: true,
  capturePriority: 'italianFull',
  manCannotCaptureKing: true,
};

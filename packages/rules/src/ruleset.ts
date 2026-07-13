/**
 * Ruleset – parametry varianty, které mění chování generátoru tahů.
 *
 * Většina polí reálně čte generátor / apply / legalMoves. ČÁSTEČNÁ VÝJIMKA
 * (italská): `manCannotCaptureKing` už AKTIVNÍ JE – generátor skoků
 * (`extendJumps` v moves.ts, fáze 112) podle něj prořezává braní muže přes dámu.
 * `mustCaptureMaximum` je AKTIVNÍ od fáze IT-3 (moves.ts, `legalMoves` filtruje
 * jen skoky s maximálním počtem braných kamenů). Poslední pole `capturePriority`
 * zatím SPÍ – deklaruje se a plní default do všech variant, ale žádný čtenář ho
 * ještě nečte (FID kvalitativní priorita dorazí ve fázi IT-4). Ostatní varianty
 * mají všechna tři pole na defaultu, takže se jejich chování nemění.
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
   * stačí brát cokoli (americká, pool, ruská, česká). AKTIVNÍ (fáze IT-3):
   * `legalMoves` po posbírání skoků ponechá jen množinu s maximem `captures.length`
   * (KVANTITA, bez vážení dámy). Flag-vázané – pro `false` se filtr nespustí.
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
   * (americká, pool, ruská, česká). AKTIVNÍ (fáze 112): generátor skoků
   * `extendJumps` prořezává už při GENERACI každý segment, kde by muž
   * přeskakoval dámu (i uprostřed multi-skoku). Prořez žije JEN v `extendJumps`;
   * varianty s letmým mužem (`promoteMidCapture: true` → `extendRussianManJumps`)
   * ho zatím neřeší – žádný ruleset ale `manCannotCaptureKing` s letmým mužem
   * nekombinuje, takže mezera je momentálně nedosažitelná.
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
 * PLNĚ AKTIVNÍ: `manCannotCaptureKing` respektuje generátor skoků (fáze 112 –
 * muž nepřeskočí dámu), `mustCaptureMaximum` vynucuje `legalMoves` (fáze IT-3 –
 * jen maximum braných kamenů) a `capturePriority: 'italianFull'` běží FID
 * kvalitativní kaskádou (fáze IT-4). Jádro je perft-ověřené (fáze IT-5,
 * perft-italian.test.ts) a od fáze 116 je italská ve `VARIANT_IDS` (v nabídce
 * lobby, AIvP i PvP). Zbývající kroky (otočená deska/red-white assety, doladěná
 * AI, ověřená PvP autorita) jsou IT-7+ – na dev je varianta hratelná, ale nic
 * se nepublikuje před IT-11.
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

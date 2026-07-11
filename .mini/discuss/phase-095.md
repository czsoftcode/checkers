# Phase 95 — Létavá dáma: braní (generátor + apply)

## Intent
Naučit generátor (`moves.ts` / `extendJumps`) a validátor (`apply.ts`) brát létavou dámou:
klouzavý skok (přijeď k prvnímu soupeři z dálky přes prázdná pole, dopadni na libovolné
prázdné pole za ním) včetně vícenásobného braní z dopadu. Notace flying braní a perft jsou
MIMO řez (fáze B2b / B3) — v izolaci je zatím nic nevolá, flying se do reálné hry zapojí až v D.

## Key decisions
- **Referenční varianta = pool checkers.** Nejjednodušší flying (bere letmo, muž i dozadu, žádná
  priorita, žádná proměna uprostřed braní). Standardní pool/ruský výklad létavého braní se zapíše
  NATVRDO do test fixtures jako zdroj pravdy — žádný externí federační dokument se nepřipíná,
  fixture JE reference. (Priorita braní dámou = česká a proměna uprostřed = ruská patří do fáze C.)
- **Tři pravidla létavého braní (potvrzeno uživatelem):**
  - (a) Dopad na LIBOVOLNÉ volné pole za braným kamenem (volba hráče, ne povinně první ani nejdál);
    každý dopad = samostatný tah/větev.
  - (b) ŽÁDNÉ povinné maximum — kratší braní legální i když existuje delší (jako americká). Povinné
    maximum je non-goal vlny.
  - (c) TURECKÝ ÚDER — brané kameny zůstávají na desce jako PŘEKÁŽKY až do konce sekvence: nelze je
    brát dvakrát, nelze přes ně přejet ani na ně dopadnout; všechny se smažou naráz na konci tahu.
- **Dvě cesty braní (potvrzeno).** Krátká dáma + muž = dnešní kód BEZE ZMĚNY (okamžité odebrání,
  krok-2 přes neighborOf/jumpOf). Létavá dáma = NOVÁ klouzavá cesta s tureckým úderem. Chrání to
  americká čísla (perft 1-6) i POŘADÍ tahů (selfplay/opening determinismus). Cena = malá duplikace,
  vědomě přijatá; sjednocení do jedné turecké cesty se ODMÍTÁ (riziko změny pořadí amerických tahů).
- Detekce létavé dámy: `piece.kind === 'king' && ruleset.king === 'flying'` (stejně jako už dělá
  B1 pro prostý tah v apply.ts).

## Watch out for
- **Turecký úder je korektnostní mina.** Dnešní okamžité odebrání (`board[over-1]=null` v extendJumps)
  je pro flying ŠPATNĚ: pozdější dlouhý segment může přejet přes dřív brané pole. Paritní argument
  v komentáři extendJumps ("dopady a braní se nikdy nepotkají") platí JEN pro krok-2 krátký skok,
  ne pro klouzání. Nová cesta musí držet brané kameny na desce jako blokery a mazat je až na konci.
- **Cross-module kontrakt generátor ↔ apply.** Oba se musí shodnout na sémantice "braný, ale ještě
  na desce": blokuje pohyb, nelze brát dvakrát, odebrán na konci. apply.ts dnes maže captures PRŮBĚŽNĚ
  ve smyčce — pro flying to musí odložit na konec, zrcadlově ke generátoru. Golden test ať ověřuje
  REÁLNÝ kód obou stran (generuj → aplikuj → zkontroluj desku), ne jen jednu stranu.
- **Americká brána.** Krátká cesta (muž + short dáma) musí zůstat bajt-identická — nejen množina, ale
  i POŘADÍ tahů (na něm visí selfplay seed a opening testy). Zajištěno větvením na flying; starou cestu
  nesahat.
- **Muž v poolu NENÍ létavý.** Bere krok-2 skokem (+ manCaptureBackward už z fáze 93), turecký úder
  timing muže neovlivní (parita), takže muž zůstává na staré cestě. V B2 se muž a dáma nemíchají
  (proměna uprostřed = fáze C).
- **Golden testy testují můj výklad.** Ruční očekávané hodnoty = riziko, že testuju vlastní chybu.
  Použít učebnicové flying pozice s jednoznačnou odpovědí a před reportem pustit NEZÁVISLÉHO sub-agenta
  (čerstvý kontext) na adversarial review — fáze sahá na chybové/geometrické cesty i kontrakt mezi
  moduly (viz CLAUDE.md).
- **Notace a perft mimo řez.** Golden testy asserují Move objekty přímo, ne přes formatMove/parseMove.
  Flying braní se do PDN/perftu dostane až v B2b/B3.

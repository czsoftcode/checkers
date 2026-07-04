# Phase 24 — Vzdání hry a nová hra

## Intent
Testovací vybavení pro session člověk vs. počítač: web klient dostane nad deskou
řádek se stavem partie a dvě tlačítka – „Vzdávám hru" (aktivní jen za běhu partie)
a „Nová hra" (aktivní jen po skončení partie). Vzdání zapíše partii do `.pdn` a
NEspustí novou partii automaticky – nová partie vzniká výhradně klikem „Nová hra".

Pravidla ani archivace se v jádru nemění: `GameResult` už zná `white-wins` a
`RESULT_TOKEN` už mapuje `white-wins → "1-0"`. Vzdání člověka (černý) = výhra
bílého (počítač). Fáze je tedy: serverová nadstavba (vynucený výsledek mimo
pravidla) + endpoint + kus UI skořápky kolem existující desky.

## Key decisions
- **Vynucený výsledek mimo pravidla.** Do záznamu partie (store) přibude
  `forcedResult` (nebo `resignedBy`). Vznikne JEDINÁ funkce
  `efektivníVýsledek(record) = forcedResult ?? gameResultFromState(state)` a
  všechna dnešní volání `gameResultFromState` na straně serveru jdou přes ni:
  `gameToDto`, `maybeArchive`, kontrola „je konec?" v POST /moves (člověk),
  `maybeTriggerEngine`, a OBĚ terminační kontroly v `runEngineMove`.
- **Endpoint** `POST /games/:id/resign`: nastaví `forcedResult = white-wins`,
  archivuje přes `markArchived` + `writeGamePdn`, vrátí `GameDto`
  s `result: "white-wins"`. Bez těla. Bez kontroly, kdo je na tahu (vzdát lze
  kdykoli za běhu). Chyby: 404 `game_not_found`; 409 `game_over`, když je partie
  už terminální (přirozený konec i opakované vzdání). Reuse `ERROR_CODES.gameOver`,
  nový kód není potřeba.
- **Kdo se vzdává:** natvrdo černý (člověk) → vyhrává bílý, stejně jako je engine
  napevno bílý (`ENGINE_COLOR`). Platí i v manuálním režimu bez enginu.
- **Klient – vzdání během pollingu (1a):** „Vzdávám hru" nejdřív počká na doběhnutí
  právě běžícího requestu (single-flight `busy`), pak vzdání spolehlivě odešle –
  klik nesmí tiše propadnout. Během čekání tlačítko zablokovat proti dvojímu
  odeslání.
- **Potvrzení vzdání:** dvoukrokové INLINE potvrzení, žádný nativní `confirm()`
  (CSP + preference uživatele). Klik „Vzdávám hru" → „Opravdu vzdát? [Ano] [Zrušit]",
  teprve „Ano" odešle.
- **„Nová hra" = úklid controlleru:** nejdřív `dispose()` starého controlleru
  (zabít polling interval), pak `POST /games` a vykreslení nového. Dnes to
  neexistuje (`main.ts` = „restart přes obnovení stránky").
- **UI text:** „Počítač" místo „Engine" (např. „Vyhrál počítač", „Vzdal jsi –
  vyhrál počítač"). PDN tag `[White "Engine"]` ZŮSTÁVÁ (archivační kontrakt fixovaný
  testy), nemění se.
- **Vizuál minimální:** řádek stavu (na tahu / konec: výsledek) + dvě tlačítka,
  bez animací a modálů. Styl přes třídy v `styles.css` (žádné inline styly – CSP).

## Watch out for
- **Linchpin efektivního výsledku.** Vzdání NEmění stav pravidel – pozice zůstává
  `ongoing`. Když jediné místo (hlavně guardy v `runEngineMove` PO `await`) čte
  `gameResultFromState` napřímo místo efektivního výsledku, engine zahraje tah do
  vzdané partie a/nebo ji re-archivuje. Test se zuby: dočasně rozbít guard → test
  musí padnout.
- **Právě jednou.** Vzdání volá `markArchived` PŘED `writeGamePdn` (stejně jako tah);
  `markArchived` je atomický check-and-set → dvojí zápis nehrozí ani při závodu
  vzdání × dotahující engine.
- **`gameToDto` musí nést vynucený výsledek.** Dnes odvozuje result čistě ze stavu.
  Předat mu record / efektivní výsledek; DTO zůstává čisté, ale aktualizovat jeho
  testy.
- **Závod s enginem.** Vzdání ve chvíli `engineStatus === 'thinking'`: engine job se
  po `await bestmove` probere, přes efektivní výsledek uvidí terminál a skončí do
  `idle` bez aplikace tahu. Engine proces se NEzabíjí; `engineStatus` může v záznamu
  krátce zůstat `thinking`, než job doběhne – UI ukazuje konec bez ohledu na to.
- **Životní cyklus „Nová hra".** `dispose()` MUSÍ zavolat `clearInterval`, jinak
  poběží dva pollery. Rozdělaný fetch starého controlleru se může dořešit do už
  odpojeného DOM – neškodné, ale nesmí překreslit novou desku (nový controller má
  vlastní `gameId`/stav).
- **Stav tlačítek řídí server.** Enable/disable se odvozuje z `result` pozorovaného
  ze serveru (přes poll i odpovědi POST): `result !== 'ongoing'` → „Nová hra" on,
  „Vzdávám hru" off. Controller musí výsledek předat skořápce (callback).
- **Manuální režim (bez enginu).** Vzdání funguje pořád (černý → bílý). Archivace
  je vázaná na `pdnDir`; když chybí (testy, manuál), zápis se neprovede – to je
  vědomé, ne chyba.
- **PDN nerozlišuje vzdání od přirozené výhry** (obojí `1-0`). Přijato, mimo rozsah.
- **Testy se zuby (server):** vzdání běžící partie → `result: white-wins` + `<id>.pdn`
  s tokenem `1-0`; dvojí vzdání → 409 + PRÁVĚ jeden soubor; po vzdání pokus enginu
  o `bestmove` je no-op/odmítnut (guard přes efektivní výsledek). Bez enginu vzdání
  taky projde.
- **Bez inline stylů/scriptů (CSP).** Tlačítka a stav stylovat třídami v `styles.css`.

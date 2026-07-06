# Phase 47 — Serverový los ballotu: Mistrovství

**Goal:** Při založení partie na úrovni Mistrovství server vylosuje seedovatelným PRNG jeden ballot z THREE_MOVE_BALLOTS a jeho tři půltahy přehraje autoritativní cestou advanceState (stejnou jako tah hráče), takže partie začíná v ověřené popballotové pozici s bílým (AI) na tahu; každý nasazený ballot je legální ověřenou serverovou cestou a seedovaný los je v testu deterministický. Rozsah je jen server – klientský výběr úrovně a orientace desky patří do navazující fáze.

## Steps
- [done] Úroveň championship v levels.ts
- [done] Seedovatelný picker ballotu na serveru
- [done] Los + nasazení v store.create (+ ballotIndex)
- [done] POST /games spustí engine po ballotu
- [done] Testy se zuby
- [done] Verifikace + nezávislý self-review

## Auto-commit
- Phase 47: Serverový los ballotu: Mistrovství

## Discussion
# Phase 47 — Serverový los ballotu: Mistrovství

## Intent
Přidat serverovou úroveň Mistrovství, která hraje plnou silou (jako Profesionál),
ale partie začíná vynuceným třítahovým zahájením (3-move ballot). Při založení
partie server vylosuje jeden ballot z `THREE_MOVE_BALLOTS` (rules, fáze 46),
nasadí ho a od výsledné pozice (bílý na tahu) se hraje volně. Rozsah je JEN server
— klientský výběr úrovně, orientace desky a zobrazení názvu zahájení jsou navazující
fáze.

## Key decisions
- **Nová úroveň:** interní hodnota anglicky podle konvence (`championship`),
  čeština až v UI (příště). Do `LEVELS` v `packages/server/src/levels.ts`.
  `STRENGTH_BY_LEVEL.championship = undefined` (plná síla = Profesionál, jen s
  vynuceným zahájením). `DEFAULT_LEVEL` zůstává `professional` — Mistrovství je
  opt-in. Přidání do `LEVELS` automaticky rozšíří zod `z.enum(LEVELS)` v
  `createGameBodySchema` (app.ts) i typ `GameLevel`.
- **Los + nasazení v `store.create`:** začít `initialGameState()` a tři půltahy
  vylosovaného ballotu PŘEHRÁT přes `advanceState` (stejná autoritativní cesta
  jako tah hráče/enginu). NE nasazovat hotovou pozici z `playBallot` — přehrání
  udrží počítadla remízy (půltahy bez pokroku, historie pozic pro opakování)
  správně; „nasaď pozici" by je vynulovalo. Ballot tak přirozeně skončí jako
  první 3 tahy v `moves` → i v archivním PDN.
- **Legalita = přes rules:** `playBallot` už páruje from+cíl proti `legalMoves`
  a na neshodě throwuje; jeho výstup jsou reálné `Move`. Přehrání přes
  `advanceState` je proto dostatečně „ověřená serverová cesta". Extra
  `findLegalMove` na každý ballot tah je redundantní (leave to plan, spíš ne).
- **RNG patří na server** (rules ho vědomě odmítá). Injektovat SEEDOVATELNÝ picker
  (default založený na `Math.random`) do `GameStore` — nejspíš přes konstruktor
  `new GameStore(pickBallot?)`, aby test stavěl store přímo se seedovaným pickerem
  a měl deterministické zuby. Zvážit mulberry32 (existuje v `packages/cli/src/prng.ts`)
  — NEimportovat z cli; případně malá kopie čisté funkce do serveru.
- **Uložit identitu ballotu:** do `StoredGame`/`GameRecord` přidat `ballotIndex`
  (index do decku, `null` pro neballotové partie) + jednorázový serverový log při
  losu. Zdroj pravdy zůstává deck v rules; ukládá se jen index. Vystavení v DTO
  (`gameToDto`) pro pozdější UI název zahájení je levné a aditivní — leave to plan,
  spíš ano.
- **POST /games musí spustit engine:** po ballotu je na tahu bílý = engine.
  Dnešní `POST /games` engine NEspouští (jen `/moves` přes `maybeTriggerEngine`).
  Přidat volání `maybeTriggerEngine` po `store.create` — ten už si sám hlídá
  `turn === ENGINE_COLOR`, takže pro neballotové partie (černý na tahu) je no-op.
  Asynchronně: odpověď se vrátí hned s `engineStatus: 'thinking'`, klient dotáhne
  pollingem GET (konvence jako `/moves`).

## Watch out for
- **Invariant po ballotu (fáze 46):** `turn === 'white'`, černých = 12, bílých
  ∈ {11, 12} (8 ze 156 zahájení má braní na 3. půltahu, ubývá jen bílý). NENÍ
  pravda „12:12, nula braní". Test to musí kontrolovat pro reálně nasazený ballot.
- **Selhání enginu = MIMO scope (parita).** Dead-lock „status `error`, bílý na
  tahu, člověk (černý) nemá jak táhnout" existuje UŽ TEĎ u všech úrovní (po každém
  tahu člověka). Mistrovství jen přidává, že to může nastat na tahu 0. Neřešit tady
  — Mistrovství se zachová jako zbytek (klient založí novou partii). `bestmove` má
  retry na timeout uvnitř; serverový retry transient neřeší podruhé. Doporučeno
  založit samostatnou backlog položku (obecné zotavení z `error` napříč úrovněmi).
- **Zuby testů:**
  - Unit (`GameStore` se seedovaným pickerem): `create('championship')` →
    deterministický `ballotIndex`; `position.turn==='white'`; černých 12, bílých
    11–12; `moves.length===3`. Neballotová úroveň → `ballotIndex===null`, výchozí
    rozestavění, černý na tahu.
    Zub: dočasně rozbít cílové pole jednoho ballotu (v rules) → `playBallot` throw
    → `create` throw hlasitě. Přehrávat REÁLNOU cestou rules, netestovat mock.
  - API (buildApp + fake engine): `POST /games {level:'championship'}` → 201,
    `engineStatus` přejde na `thinking`, po dotažení přibude 4. tah (bílý táhl
    PRVNÍ). Ověřuje, že `POST /games` spouští engine — bez toho by partie tiše
    stála a nikdo by nezačal.
- **Férovost (mimo scope):** člověk hraje vždy černou; ballot se v turnaji hraje
  2× s prohozenými barvami, tady ne → jednotlivá partie může být mírně nevyvážená.
  Řeší až případná fáze volby barvy.
- **Zpětná kompatibilita:** stávající partie/testy bez `level` i s ostatními
  úrovněmi musí běžet beze změny — `ballotIndex===null`, žádný los, žádný engine
  trigger na POST /games (černý na tahu).

## Run report
---
phase: 47
verdict: done
steps:
  - title: "Úroveň championship v levels.ts"
    status: done
  - title: "Seedovatelný picker ballotu na serveru"
    status: done
  - title: "Los + nasazení v store.create (+ ballotIndex)"
    status: done
  - title: "POST /games spustí engine po ballotu"
    status: done
  - title: "Testy se zuby"
    status: done
  - title: "Verifikace + nezávislý self-review"
    status: done
verify:
  - title: "Reálný engine (ne stub) po ballotu odehraje bílého do limitu"
    detail: "Nový integrační bod: POST /games teď u Mistrovství spouští engine hned při založení. V CI je ověřený jen in-process stubem (engine-move.test); s reálným podprocesem enginu tenhle konkrétní start (bílý táhne první z popballotové pozice) v testech neběží. Plné odklikání navíc čeká na klientskou fázi – Mistrovství zatím nejde vybrat z UI."
---

# Phase 47 — report z auto session

## Co je hotové
Server umí úroveň Mistrovství (`championship`): při `POST /games` s touto úrovní
vylosuje jeden ze 156 třítahových zahájení a nasadí ho. Partie začíná
popballotovou pozicí s **bílým (engine) na tahu** a třemi tahy v historii; engine
se proto spouští **už při založení** (u ostatních úrovní začíná černý/člověk, tam
je to no-op → zpětně kompatibilní).

Konkrétně:
- `levels.ts`: `championship` v `LEVELS`, `STRENGTH_BY_LEVEL.championship = undefined`
  (plná síla jako Profesionál; rozdíl je jen vynucené zahájení).
- `prng.ts` (nový): kopie `mulberry32` (NEimportuje se z cli/rules – vědomá duplicita).
- `store.ts`: konstruktor bere injektovaný `rng` (default `Math.random`); `seedBallot`
  vylosuje index, `playBallot` spáruje tahy proti reálným `legalMoves`, tři `Move`
  se přehrají přes `advanceState`. `ballotIndex` (index nebo `null`) je nové pole
  v `StoredGame`/`GameRecord`.
- `dto.ts`: `GameDto.ballotIndex` (aditivní pole, klient ho zatím nemusí číst).
- `app.ts`: `buildApp` propouští `rng` do store; `POST /games` po `create` loguje
  vylosovaný ballot a volá `maybeTriggerEngine`, odpověď nese čerstvý `engineStatus`.

## Testy (zuby)
- `ballot.test.ts` (nový): deterministický los na seed; invariant po ballotu
  (bílý na tahu, černých 12, bílých 11–12, 3 tahy); **všech 156 ballotů** projde
  reálnou cestou rules (řízený rng přes střed intervalu); neballotové úrovně →
  `ballotIndex null`, výchozí rozestavění; rozbitý rng → `RangeError` (guard).
- `engine-move.test.ts`: Mistrovství → 201, bílý na tahu, `engineStatus 'thinking'`,
  engine dotáhne na pozadí (překlopí na černého) = **engine táhl první**; kontrolní
  test, že professional POST engine NEspustí.
- `levels.test.ts`, `dto.test.ts` doplněny/opraveny (nový 6. arg `gameToDto`).
- Celá suite zelená: server 122/122, rules/cli/engine/web beze změny. Lint + typecheck čisté.

## Nezávislý self-review (čerstvý kontext)
Sub-agent proběhl mutačně (rozbil produkční kód, spustil testy, vrátil zpět).
**Žádný blokující nález.** Ověřeno, že testy chytnou: posun indexu o 1, „vždy index 0",
vypnutý guard i mock místo reálné cesty. Chybové cesty (NaN/záporný/≥1 rng) končí
hlasitým `RangeError`. `engineStatus 'thinking'` v odpovědi je deterministický (žádný
race – `runEngineMove` se zastaví na prvním `await`).

Nálezy nízké závažnosti a jak jsem s nimi naložil:
1. **Odůvodnění přehrání přes advanceState bylo v komentáři nepravdivé** – tvrdilo,
   že čítače remízy „musí odrážet tři půltahy, ne začínat od nuly". Realita: všech
   156 ballotů má na 3. půltahu pokrok, takže čítače končí na nule tak jako tak;
   přehrání je funkčně ekvivalentní převzetí hotové pozice. **Opraveno** – komentář
   teď říká pravdu (přehrání drží jeden zdroj pravdy o tvaru `GameState` a je robustní,
   ne že mění chování). Není to bug, jen zavádějící zdůvodnění.
2. **Web klient neaktualizován** – `server-client.ts` nezná `championship` ani
   `ballotIndex`. Záměrně: rozsah je jen server, runtime guard extra pole ignoruje,
   nic se nerozbije. Mistrovství zatím **nejde vybrat z UI** – to je navazující fáze.
3. `console.log` na každou Mistrovství partii je vědomý (log losu kvůli
   ověřitelnosti/férovosti), ne chyba.

## Vědomě mimo rozsah
- **Zotavení z `error` po pádu enginu** (i na tahu 0 u Mistrovství) – stávající
  chování napříč všemi úrovněmi, ne specifikum této fáze. Doporučeno založit
  samostatnou backlog položku (probráno v diskusi).
- **Klientský výběr úrovně + orientace desky + název zahájení** – navazující fáze.
- **Volba barvy / turnajová férovost** (2× s prohozenými barvami) – jiná fáze;
  člověk hraje vždy černou.

## Poznámka
Padl jeden reálný trade-off (přehrání ballotu přes `advanceState` vs. převzetí
hotové pozice z `playBallot`). Není to ostrá křižovatka se zamítnutou alternativou –
obě cesty dají identický stav – takže ADR asi netřeba. Pokud to chceš zachytit,
`/mini:decision` před `/mini:done`.

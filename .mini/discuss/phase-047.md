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

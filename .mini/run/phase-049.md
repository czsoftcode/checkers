---
phase: 49
verdict: done
steps:
  - title: "Server: ballotMoves do GameDto"
    status: done
  - title: "Klient: kontrakt server-client (ballotMoves)"
    status: done
  - title: "Klient: intro animace ballotu v controlleru"
    status: done
  - title: "Test controlleru: intro probehne pred tahem enginu"
    status: done
  - title: "Klient: odemknuti zvuku na gestu vyberu urovne"
    status: done
  - title: "Verifikace + nezavisly self-review"
    status: done
---

# Fáze 49 — report z auto session

## Co je hotové
- **Server (`dto.ts`, `app.ts`):** `GameDto` nese nové pole `ballotMoves: MoveDto[] | null`.
  U Mistrovství ho `dtoFor` odvodí z prvních tří tahů historie (`record.moves.slice(0,3)`),
  jinak `null`. Ukázalo se, že není potřeba nové úložné pole ve store – ballot UŽ JE
  prvními třemi tahy historie (store je tam nasadí při zakládání), takže se jen serializují.
- **Klient kontrakt (`server-client.ts`):** `GameDto` + runtime guard `isGameDto` přijímají
  `ballotMoves` (do hloubky přes `isMoveDto`); `undefined`/rozbitý tvar/nevalidní prvek se
  odmítne jako drift (ServerError při parsování), ne až pádem v `applyMove`.
- **Klient intro (`controller.ts`):** na startu Mistrovství s právě 3 ballot tahy se deska
  usadí na výchozí rozestavění a `runBallotIntro` po jednom přehraje tři půltahy (reuse
  `board-view.update` → animace i zvuky). Ballot běží POMALEJI než hra, ať je sledovatelný:
  jeden půltah ~500 ms (`BALLOT_HOP_MS = 500` přepíše délku skoku jen pro ballot přes nový
  volitelný parametr `board-view.update(state, hopMs?)`; globální rychlost hry se nemění) +
  `BALLOT_INTRO_GAP_MS = 150` PŘED KAŽDÝM tahem (i prvním). Mezipozice si klient skládá
  z `initialPosition` přes `resolveMove`+`applyMove`.
  - Oprava po ruční verifikaci: první půltah se původně přehrál BEZ animace („skočil"
    na cíl). Příčina: `runBallotIntro` běží synchronně z továrny controlleru, dřív než
    app-shell připne desku do DOM → první `view.update` počítal souřadnice z
    `getBoundingClientRect()` na neukotvené desce (nuly). Fix: pauza `sleep` je teď PŘED
    každým tahem (včetně prvního), takže první `update` proběhne až po připnutí desky.
    V jsdom (bez layoutu/WAAPI) se tahle chyba neprojeví → jen ruční ověření v prohlížeči.
  Fallback: jiná délka než 3 / neodehratelné tahy → přeskočí intro a vykreslí rovnou
  post-ballot pozici (kosmetika nesmí zablokovat partii).
- **Audio (`app-shell.ts`):** skořápka vlastní JEDEN sdílený `SoundPlayer` a předává ho
  každému controlleru; na gestu (výběr úrovně / „Nová hra") ho synchronně `unlock()`ne, ať
  ballot i první tah enginu (hrají dřív, než se hráč dotkne desky) nezůstanou potichu.

## Nezávislý self-review našel a opravil BLOCKER
Sub-agent v čerstvém kontextu odhalil reálnou díru, kterou checklist „stejného mozku"
nechytil: gate `await lastRender` v pollu je UVNITŘ větve `engineJustMoved`. Během intra
ale engine teprve přemýšlí → poll vrací nezměněnou popballotovou pozici (bílý na tahu) →
`engineJustMoved` false → gate se přeskočí a `applyServerState → render()` by uprostřed
animace ballotu překreslil desku na post-ballot pozici (v produkci s reálným WAAPI = rozbité
intro). Původní test to nechytil (jsdom bez WAAPI + fake `getGame` vracel rovnou tah enginu).

**Oprava:** flag `introPlaying` pozdrží polling po celou dobu intra (poll se přeskočí jako
při `busy`/`dragging`); shodí se v `.finally` po doběhnutí/přerušení intra. Přidán test se
zuby: během intra se `getGame` vůbec nezavolá; bez gate by poll server dotázal a test padne.
Zároveň podle nálezu zpřísněna délka ballotu na přesně `=== 3`.

## Verifikace
- `pnpm -r typecheck` zelené, `pnpm lint` čisté.
- Testy: web 207, server 125, cli 24, engine 250 – vše zelené. Web build (Vite) prošel
  (JS bundle 32 kB; nové importy z `@checkers/rules` do klienta se zabalily bez problému).
- Nové testy se zuby: server `api.test` (odehrání `ballotMoves` z `initialPosition` == `dto.position`),
  klient `controller-championship` (pořadí 3× dopad před tahem enginu; polling se během intra
  přeskočí; fallback bez ballotMoves), `server-client` (guard odmítne rozbité `ballotMoves`),
  `app-shell` (gesto odemkne sdílený player a předá ho controlleru).

## Rozhodnutí k zaznamenání (ADR)
Padlo jedno vědomé rozhodnutí, které z kódu později nebude zřejmé: **server posílá ballot
tahy v DTO** (varianta B), i když to práci na klientu nezmenšilo (deska stejně skládá
mezipozice z `initialPosition`). Důvod: jediný zdroj pravdy o tazích + čitelný test kontraktu.
Zvažovaná a zamítnutá varianta A (klient si tahy dopočítá z `ballotIndex`) by nevyžadovala
změnu drátu. Zvaž `/mini:decision` před `/mini:done`.

## Na co dát pozor u další práce
- „Per-úroveň čas na přemýšlení" (todo 29) a jméno zahájení v UI jsou pořád mimo rozsah.
- Zvuk po reloadu s uloženou Mistrovství zůstává potichu (limit prohlížeče) – viz `verify`.

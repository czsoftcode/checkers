# Phase 49 — Animace losovaného ballotu

**Goal:** U úrovně Mistrovství klient po startu partie nejdřív vykreslí výchozí rozestavění a pak klasickou rychlostí hry po jednom animuje tři půltahy vylosovaného ballotu (včetně případného braní) se zvuky pohybu a dopadu, a teprve po doběhnutí ballotu nechá naskočit první tah enginu.

## Steps
- [done] Server: ballotMoves do GameDto
- [done] Klient: kontrakt server-client (ballotMoves)
- [done] Klient: intro animace ballotu v controlleru
- [done] Test controlleru: intro probehne pred tahem enginu
- [done] Klient: odemknuti zvuku na gestu vyberu urovne
- [done] Verifikace + nezavisly self-review

## Auto-commit
- Phase 49: Animace losovaného ballotu

## Discussion
# Phase 49 — Animace losovaného ballotu

## Intent
U úrovně Mistrovství dnes klient dostane od serveru už rozehranou desku (pozice PO
ballotu, bílý = engine na tahu) + jen `ballotIndex`; tři vynucené půltahy zahájení
hráč nikdy nevidí — deska rovnou naskočí prvním tahem enginu. Fáze má tři půltahy
ballotu VIZUÁLNĚ přehrát: klient nejdřív vykreslí výchozí rozestavění a pak po jednom
animuje tři půltahy (včetně případného braní — některé ballot mají 3. půltah jako skok,
např. Double Cross 14x23) herní rychlostí se zvuky pohybu/dopadu. Teprve po doběhnutí
ballotu se pustí první tah enginu. Čistě klientská UX vrstva + jedno rozšíření DTO;
serverová autorita a pravidla se nemění.

## Key decisions
- **Zdroj tahů = server (rozhodnutí uživatele).** Do `GameDto` přibude pole s tahy
  ballotu (`MoveDto[] | null`, `null` mimo Mistrovství). Zdroj = `playBallot(ballot).moves`,
  které store už při zakládání počítá (store.ts:158) — je potřeba je uložit do záznamu
  partie a serializovat přes `moveToDto`. Jediný zdroj pravdy je server; klient tahy
  jen dostane, nedopočítává je z indexu. Pole je v DTO konstantní po celou partii
  (posílá se i v každém pollu) — klient ho použije JEN jednou na startu; pár bytů navíc
  je přijatelné, ať nemusí vzniknout zvláštní create-only cesta.
- **Rytmus:** ~250 ms pauza mezi půltahy (rozeznatelnost tří tahů); rychlost pohybu
  kamene beze změny — reuse existující animace `board-view.update` (HOP_MS = 300).
- **Zvuk (autoplay):** odemknout audio na gestu výběru úrovně v přepínači. Doporučená
  realizace: app-shell vytvoří JEDEN `SoundPlayer`, na `change`/„Nová hra" gestu zavolá
  `player.unlock()` SYNCHRONNĚ (ještě v rámci gesta, před `await createGame`) a předá ho
  controlleru přes už existující `options.soundPlayer`. Odemknutí HTMLAudioElementu je
  page-global, takže probuzení v gestu povolí i pozdější (ballotové + engine) zvuky.

## Watch out for
- **POŘADÍ vykreslení je kritické.** `board-view.update` animuje z DIFFU proti svému
  POSLEDNĚ vykreslenému stavu. Intro proto MUSÍ nejdřív `view.settle(výchozí pozice)`
  (z `initialPosition` z rules), teprve pak `view.update` pro každý půltah. Kdyby se
  napřed vykreslila post-ballot pozice (dnešní `void render()` na konci factory),
  první `update` by diffoval post-ballot→půltah1 a animoval nesmysl.
- **Sekvencování proti pollingu (jádro fáze).** Polling běží od startu a první tah
  enginu je na serveru už rozjetý. Intro nastavit jako `lastRender = introPromise`;
  poll už dnes před tahem enginu dělá `await lastRender` (controller.ts:347), takže se
  engine tah přehraje AŽ po doběhnutí ballotu. `position` (stavová proměnná) přitom
  NECHAT na post-ballot pozici (`game.position`) — `engineJustMoved(position, dto)`
  (bílý→černý) tak funguje beze změny; intro sahá jen na `view`, ne na `position`.
- **Mezipozice si skládá klient.** I když server pošle tahy, deska animuje z rozdílu
  DVOU pozic. Klient musí z `initialPosition` aplikovat poslané tahy (`applyMove` +
  dohledání tahu jako `findLegalMove`/`resolveMove`) a poskládat posloupnost pozic,
  kterou pak krmí do `view.update`.
- **Test se zuby (cross-module kontrakt server↔klient).** Aplikace poslaných
  `ballotMoves` na `initialPosition` MUSÍ skončit přesně na `dto.position`. Controller
  test: fake klient vrátí championship DTO {level:'championship', ballotMoves:[…],
  position: post-ballot}; ověřit, že intro animuje právě ty 3 tahy a skončí na
  `dto.position`, a že engine tah (z následného `getGame`) se aplikuje AŽ PO intru.
  Kdyby se tahy a pozice rozešly, sekvence nedojde na `dto.position` → test padne.
- **Fallback / robustnost:** když `ballotMoves` chybí/je prázdné/nesedí (nemělo by u
  championship nastat), přeskočit intro a vykreslit rovnou post-ballot pozici (dnešní
  chování) — animace je kosmetika, nesmí shodit partii.
- **Dispose během intra** („Nová hra" uprostřed animace): smyčka intra musí kontrolovat
  `disposed` a přestat volat `view.update`; `view.dispose()` ukončí běžící WAAPI. Žádné
  soubory/stav po sobě nenechává (čistě UI).
- **Zvuk po reloadu s uloženou volbou Mistrovství:** auto-start (app-shell:560) běží BEZ
  gesta → ballot proběhne POTICHU. Limit prohlížeče, ne chyba; animace je vizuálně OK.
  Fresh load bez uložené volby = Profesionál (default), takže bez regrese.
- **Vstup je během intra přirozeně zamčený** (turn = bílý ≠ HUMAN_COLOR → `handleClick`
  i `canDrag` padají hned na začátku). Ověřit, netřeba přidávat další zámek.
- **Status box** hlásí bílý/thinking i během intra — je to pravda (engine počítá na
  serveru), neměnit.
- **Zpětná kompatibilita:** ostatní úrovně `ballotMoves = null` → žádné intro, tok beze
  změny. Serverové testy DTO/kontraktu + klientský `isGameDto` musí nové pole přijmout.
- **Fáze sahá na kontrakt mezi moduly a vstupní sekvenci → u `mini do` pustit nezávislý
  sub-agent self-review** (čerstvý kontext) dle projektového CLAUDE.md.

## Run report
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

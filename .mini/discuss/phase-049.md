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

# Dáma - vícevariantní checkers

## What I'm building
Prohlížečová dáma ve VÍCE variantách (první vlna: americká, ruská, česká, pool checkers - vše 8×8, diagonální, stejné rozestavění) ve dvou režimech: (1) single-player proti AI, který běží CELÝ v prohlížeči bez herního serveru - publikovatelný statický build (itch.io); u AIvP je jen výběr varianty. (2) multiplayer dvou lidí přes autoritativní VPS server, kde jsou ČTYŘI fixní varianta-lobby (jedna místnost = jedna varianta). Jeden klient, dva backendy: AI všech variant se počítá lokálně v prohlížeči, PvP jde přes server. Server je jediná autorita nad pravidly a stavem PvP - nepřijme nelegální tah v dané variantě.

## Who it's for
Dvě publika jedním klientem: (a) sólo hráč, který si zahraje proti AI v libovolné variantě kdekoliv z prohlížeče bez serveru (itch.io i jinde); (b) dva lidští hráči proti sobě v jedné variantě přes web, okruh hráčů si zajišťuje autor.

## Approach
- Vícevariantní jádro: pravidla varianty jsou objekt Ruleset (braní muže dozadu ano/ne, dáma krátká/létavá, proměna uprostřed braní, priorita braní, váhy hodnocení, opening book?), protažený do legalMoves/applyMove a odvozených (notation, perft). Varianta žije v GameState / metadatech místnosti, NE v hashované Position (Zobrist zůstává position-only). Americké chování = default ruleset schovaný za totéž rozhraní.
- Létavá dáma jako sdílené jádro: klouzavé (paprskové) generování pohybu i braní dámy napsané JEDNOU, sdílené všemi flying variantami (ruská, česká, pool). Vyžaduje přepis validace v apply.ts a notation.ts z pevného kroku 1/2 na paprskové segmenty.
- Perft na variantu: každá varianta má vlastní perft proti JEDNOMU zafixovanému zdroji pravidel (federaci) - jemný tisk pravidel se mezi variantami liší, generátor bez nezávislého ověření tiše lže.
- Lobby řízené registrem variant (data-driven), aby přidání další varianty byl nový záznam, ne přepis UI.
- Autorita PvP: server je jediný zdroj pravdy pro multiplayer, validuje KAŽDÝ tah sdílenou knihovnou rules podle Ruleset dané místnosti. Klient je nedůvěryhodný.
- Pravidla jednou: knihovna rules (čistý TS, nulové I/O), sdílená serverem, klientem i enginem. Páteří testů je perft + fixtures na každou variantu.
- Hybrid AI vs. PvP: hra proti AI (všech variant) běží CELÁ v prohlížeči (rules + engine search + výběr tahu ve Web Workeru, ať ~1s search nezmrazí UI). PvP dál potřebuje autoritativní server.
- Jeden klient, dva backendy: LocalClient (AI, v prohlížeči) + HttpClient (PvP, server) za jedním rozhraním. Server AI nepočítá.
- Sdílený zdroj logiky AI (@checkers/ai): server i prohlížeč staví výběr tahu z JEDNOHO kódu; per-varianta jen jiné váhy hodnocení (létavá dáma je řádově cennější než krátká).
- Mistrovství a losování zahájení (3-move ballot) zůstávají JEN pro americkou variantu; ostatní varianty jedou jako volná hra proti AI + PvP. Výuková nápověda (/hint lokálně) funguje ve všech variantách.
- Přepnutí varianty rozehranou partii zahodí a začne novou; volba varianty se pamatuje v LocalStorage, default je americká.
- Síla přes hloubku, ne čas (offline): strop maxDepth 12 pro silné úrovně; definice síly nezávislá na rychlosti zařízení. Server zůstává časový.
- Publikovatelný statický build: Vite dist/ jako zip, AI (všechny varianty) bez herního serveru. PvP z cross-origin hostingu (itch) míří na VPS → CORS + WSS + absolutní URL serveru.
- Real-time PvP přes WebSocket; stav PvP partie v paměti serveru (reconnection po krátkém výpadku, restart serveru partie maže, timeout nečinnosti uvolní partii).
- Orientace desky: každý hráč vidí desku ze své strany.
- PDN archiv dokončených partií (AI i PvP) zůstává, jednosměrný zápis; do PDN se zapisuje i varianta.
- Endgame databáze a Rust engine mimo (podmíněné).

## Non-goals
- Nepřidávej varianty s povinným maximem braní (brazilská, španělská, italská) v této vlně - Ruleset je zatím bez vrstvy maxima.
- Nepřidávej varianty s jinou geometrií (turecká, arménská, thajská) ani desku 10×10 - to nejsou moduly, ale jiné hry.
- Nedělej Mistrovství ani 3-move ballot pro nové varianty - Mistrovství zůstává jen americké.
- Nepřidávej uživatelem zakládané/pojmenované PvP místnosti - jen čtyři fixní varianta-lobby (registr je rozšiřitelný, ale první vlna = přesně tyto čtyři).
- Nedělej per-varianta opening book - flying varianty běží bez knihy (neutrálně).
- Neukládej variantu do hashované Position (rozbilo by Zobrist/TT) - varianta patří do GameState/metadat místnosti.
- Nepřidávej PWA ani service worker - "offline" = bez herního serveru, ne letadlový režim.
- Nepřidávej nativní mobilní appku.
- Neduplikuj logiku AI - book, úrovně i výběr tahu mají jediný zdroj (@checkers/ai).
- Neaplikuj strop hloubky 12 na server - je to jen offline parametr.
- Nepřidávej účty, registraci ani hesla - jen přezdívka.
- Nepřidávej žebříčky, rating ani automatický matchmaking - párování je jen výzvou v rámci varianta-lobby.
- Nepřidávej šachové hodiny (jen timeout nečinnosti).
- Nepřidávej diváky, chat ani diskovou perzistenci stavu partie (výjimka: jednosměrný PDN archiv).
- Nepřidávej undo ani in-app analýzu odehraných partií.
- Nestav endgame databázi ani Rust engine v této verzi.

## Success criteria
- V lobby (AIvP) zvolím jednu ze čtyř variant a odehraju kompletní partii proti AI CELÉ v prohlížeči BEZ herního serveru; publikovatelný statický build zahrnuje všechny čtyři.
- Refaktor na Ruleset nezměnil americkou variantu: dosavadní perft 1-6 a všechny testy zelené BEZE ZMĚNY čísel.
- Každá nová varianta má perft ověřený proti jednomu zafixovanému zdroji pravidel.
- Létavá dáma (ruská/česká/pool) generuje i validuje dlouhé tahy a vícenásobné braní správně; ruská proměna UPROSTŘED braní funguje (muž se na proměnné řadě hned mění na dámu a bere dál).
- AI ve flying variantě netahá zjevné blbosti (per-varianta váhy hodnocení; self-play sanity, ne turnajová síla).
- PvP: čtyři fixní varianta-lobby; hráči téže varianty se vidí, vyzvou a odehrají partii; přijetí výzvy = souhlas s variantou.
- Server je autorita PvP: nepřijme nelegální tah v dané variantě od žádného hráče.
- Přepnutí varianty rozehranou partii zahodí a začne novou; volba se pamatuje mezi spuštěními.
- PvP i AIvP fungují z cross-origin hostingu (itch) přes VPS pro PvP.

## Main constraints
Stack varianta A: TypeScript všude (pnpm workspaces, Node 24 LTS, Fastify + zod, Vite + vanilla TS klient, Vitest). Real-time PvP přes WebSocket (@fastify/websocket), server zůstává autoritou PvP a validuje podle Ruleset dané místnosti. Klient spouští engine i v prohlížeči (Web Worker) pro offline AI všech variant; publikovatelný statický build (Vite dist/) bez PWA/service workeru; PvP z cross-origin hostingu vyžaduje CORS + WSS. Engine je TS; Rust engine je pozdější PODMÍNĚNÝ krok. Ruleset se protahuje ~8 call sites (engine, web, ai, server); varianta v GameState/metadatech místnosti, ne v Position.

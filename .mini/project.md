# Americká dáma - Checkers

## What I'm building
Hra americké dámy (English draughts) v prohlížeči ve dvou režimech: (1) single-player proti AI, který běží CELÝ v prohlížeči bez herního serveru - publikovatelný statický build (např. itch.io); (2) multiplayer dvou lidí přes web s autoritativním VPS serverem (společná místnost, vstup pod přezdívkou, výzva do partie, víc partií současně). Jeden klient, dva backendy: AI se počítá lokálně, PvP jde přes server. Server zůstává jedinou autoritou nad pravidly a stavem PvP - nepřijme nelegální tah od žádného hráče.

## Who it's for
Dvě publika jedním klientem: (a) sólo hráč, který si zahraje proti AI kdekoliv z prohlížeče bez serveru (itch.io i jinde); (b) dva lidští hráči proti sobě přes web, okruh hráčů si zajišťuje autor. AI proti počítači je nově plnohodnotný publikační cíl, ne jen vedlejší režim.

## Approach
- Autorita PvP: server je jediný zdroj pravdy pro multiplayer, validuje KAŽDÝ tah hráče sdílenou knihovnou rules. Klient je nedůvěryhodný. (Proti podvádění mezi lidmi lokální autorita nestačí - proto PvP nejde bez serveru.)
- Pravidla jednou: knihovna rules (čistý TS, nulové I/O), sdílená serverem, klientem i enginem. Páteří testů je perft 1-6 + fixtures.
- Hybrid AI vs. PvP: hra proti AI běží CELÁ v prohlížeči (rules + engine search + opening book + výběr tahu lokálně, ve Web Workeru, ať ~1s search nezmrazí UI). PvP dál potřebuje autoritativní server.
- Jeden klient, dva backendy: LocalClient (AI, v prohlížeči) + HttpClient (PvP, server), oba za jedním rozhraním. AI se přesouvá ze serveru do prohlížeče i pro hlavní web - server přestává počítat AI (engine podproces, /games AI, /hint na serveru časem zesvětlí; PvP engine nepoužívá).
- Sdílený zdroj logiky AI (@checkers/ai): server i prohlížeč staví výběr tahu z JEDNOHO kódu (opening book + mapování úroveň→síla + orchestrace book→search→chooseMove), aby se online a offline síla nerozešly. Shodu hlídá kontraktní test nad reálným kódem obou stran.
- Síla přes hloubku, ne čas (offline): Profesionál/Mistrovství/Výuka dostanou v offline větvi strop maxDepth 12 - definice síly nezávislá na rychlosti zařízení (změřeno na dev Ryzen7: medián hloubky 12 v 1s; po testu na mobilu lze změnit). Server zůstává časový (hloubka 11-17); malý online/offline rozdíl v koncovce je vědomě přijatý.
- Publikovatelný statický build: Vite dist/ jako zip, AI bez herního serveru. PvP z cross-origin hostingu (itch) míří na VPS → server musí umět CORS a WSS s certifikátem, klient absolutní URL serveru. itch sandbox / cross-origin WS je známé integrační riziko.
- Real-time PvP: soupeřův tah přes WebSocket, server rozešle stav jen zúčastněné dvojici.
- Stav PvP partie v paměti serveru: reconnection po krátkém výpadku; restart serveru partie maže (žádná disková perzistence stavu). Nečinná/opuštěná partie se po timeoutu uvolní.
- Orientace desky: každý hráč vidí desku ze své strany (volba barvy a otočení zachována).
- PDN archiv dokončených partií zůstává (jednosměrný zápis, nenačítá se zpět).
- Endgame databáze a Rust engine mimo (podmíněné); rozhodnutí z fáze 65 platí jako záznam.

## Non-goals
- Nepřidávej PWA ani service worker - "offline" znamená bez herního serveru (statický build), NE plný letadlový režim bez internetu; načtení stránky internet potřebuje.
- Nepřidávej nativní mobilní appku - cílem je build v prohlížeči.
- Neduplikuj logiku AI - book, úrovně i výběr tahu mají jediný zdroj (@checkers/ai), ne ručně držené kopie mezi serverem a klientem.
- Neaplikuj strop hloubky 12 na server - je to jen offline parametr; server zůstává časový, ať se dnešní online síla nezmění.
- Nepřidávej účty, registraci ani hesla - hráč se identifikuje jen přezdívkou.
- Nepřidávej žebříčky, rating ani automatický matchmaking - párování je jen výzvou.
- Nepřidávej šachové hodiny / časový limit na tah (jen timeout nečinnosti).
- Nepřidávej diváky / sledování cizí partie v této verzi.
- Nepřidávej chat mezi hráči v této verzi.
- Nepřidávej diskovou perzistenci stavu partie (výjimka: jednosměrný PDN archiv).
- Nestav endgame databázi ani Rust engine v této verzi (podmíněné).
- Nepřidávej undo.
- Nepřidávej in-app procházení ani analýzu odehraných partií.
- Neměň variantu dámy - zůstáváme u americké.

## Success criteria
- Hra proti AI (všechny úrovně vč. nápovědy Výuka a losování Mistrovství) je hratelná v prohlížeči BEZ herního serveru; existuje publikovatelný statický build.
- AI běží ve Web Workeru - ~1s search nezmrazí UI.
- Online i offline AI staví výběr tahu z jednoho zdroje (@checkers/ai); kontraktní test potvrzuje shodu server vs. lokální na tutéž pozici + seed + úroveň.
- Offline síla je definovaná hloubkou (strop 12), nezávislá na rychlosti zařízení.
- Dva hráči se připojí do místnosti pod přezdívkou, vyzvou se a odehrají partii; tah jednoho se objeví druhému v reálném čase.
- Server je autorita PvP: nepřijme nelegální tah od žádného z hráčů.
- PvP funguje i z cross-origin hostingu (itch) přes VPS (CORS/WSS/absolutní URL).
- Víc PvP partií běží současně a nezávisle; stav se doručí jen správné dvojici.
- Po krátkém výpadku sítě hráč naváže do rozehrané PvP partie; restart serveru partie maže.
- Nabídka remízy i vzdání jdou druhému člověku; po konci lze začít novou partii.
- Nečinná/opuštěná partie se po timeoutu uvolní.
- Perft 1-6 sedí; všechny testy z pastí (GDD 2.7) zelené.

## Main constraints
Stack varianta A: TypeScript všude (pnpm workspaces, Node 24 LTS, Fastify + zod, Vite + vanilla TS klient, Vitest). Real-time PvP přes WebSocket (@fastify/websocket), server zůstává autoritou PvP. Klient spouští engine i v prohlížeči (Web Worker) pro offline AI; publikovatelný statický build (Vite dist/) bez PWA/service workeru; PvP z cross-origin hostingu vyžaduje CORS + WSS na serveru. Node 24 je vědomé rozhodnutí (fáze 11, nález 10-1). Engine je TS; Rust engine je pozdější PODMÍNĚNÝ krok, jako nativní podproces za stejným protokolem - žádný WASM.

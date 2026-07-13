# Dáma - vícevariantní checkers

## What I'm building
Prohlížečová dáma ve VÍCE variantách ve dvou vlnách. PRVNÍ VLNA (hotová): americká, ruská, česká, pool checkers - vše 8×8, diagonální, stejné rozestavění, BEZ povinného maxima braní. DRUHÁ VLNA přidává varianty s povinným MAXIMEM braní; začíná ITALSKOU s plnou FID prioritou. Dva režimy: (1) single-player proti AI, který běží CELÝ v prohlížeči bez herního serveru - publikovatelný statický build (itch.io); u AIvP je jen výběr varianty. (2) multiplayer dvou lidí přes autoritativní VPS server, kde je jedna fixní varianta-lobby na variantu (jedna místnost = jedna varianta). Jeden klient, dva backendy: AI všech variant se počítá lokálně v prohlížeči, PvP jde přes server. Server je jediná autorita nad pravidly a stavem PvP - nepřijme nelegální tah v dané variantě (u italské včetně maxima a priority).

## Who it's for
Dvě publika jedním klientem: (a) sólo hráč, který si zahraje proti AI v libovolné variantě kdekoliv z prohlížeče bez serveru (itch.io i jinde); (b) dva lidští hráči proti sobě v jedné variantě přes web, okruh hráčů si zajišťuje autor.

## Approach
- Vícevariantní jádro: pravidla varianty jsou objekt Ruleset (braní muže dozadu ano/ne, dáma krátká/létavá, proměna uprostřed braní, priorita braní, nově MAXIMUM braní + kvalitativní priorita, muž nesmí brát dámu), protažený do legalMoves/applyMove a odvozených (notation, perft). Varianta žije v GameState / metadatech místnosti, NE v hashované Position (Zobrist zůstává position-only).
- Vrstva maxima jako nová pole Rulesetu: mustCaptureMaximum (kvantita) + capturePriority enum (none | kingQuality | italianFull) + manCannotCaptureKing. Plná FID kaskáda (nejvíc kamenů → přednost dámou → nejvíc dam → nejdřív braná dáma) je schovaná za jednu enum hodnotu a implementovaná KONKRÉTNÍM kódem, ne obecným frameworkem. Nová varianta s maximem = nová enum hodnota + konkrétní větev, ne přepis.
- Vrstva maxima/priority je striktně ADITIVNÍ větev v legalMoves, aktivní JEN italským flagem. Americká/pool/ruská/česká generují tahy beze změny - jejich perft 1-6 musí zůstat s identickými čísly.
- "Muž nesmí brát dámu" je GENERAČNÍ omezení (prořezává cesty braní už při generaci skoků), ne post-filtr - jinak vyjde špatné maximum a server pustí nelegální tah.
- Otočená deska italské (černé pole vpravo dole) je řešená ČISTĚ vizuálně: rotace renderu + vlastní assety (right_game_board.webp, red/white kameny) jen pro italskou. Engine, parita polí, číslování, Zobrist i perft zůstávají na stejném souřadném systému jako americká - hra je izomorfní zrcadlově otočené americké desce.
- Perft na variantu: každá varianta má vlastní perft proti JEDNOMU zafixovanému zdroji pravidel; italská proti FID (Federazione Italiana Dama). Adversariální fixtures na prioritu: 2-braní NESMÍ projít, když existuje 3-braní; braní mužem neprojde, když jde brát dámou; muž nepřeskočí dámu.
- Létavá dáma jako sdílené jádro pro flying varianty (ruská/česká/pool); italská má dámu KRÁTKOU (jako americká).
- Lobby řízené registrem variant (data-driven), aby přidání další varianty byl nový záznam, ne přepis UI.
- Autorita PvP: server je jediný zdroj pravdy, validuje KAŽDÝ tah sdílenou knihovnou rules podle Ruleset dané místnosti; u italské včetně maxima a priority. Klient je nedůvěryhodný.
- Pravidla jednou: knihovna rules (čistý TS, nulové I/O), sdílená serverem, klientem i enginem. Páteří testů je perft + fixtures na každou variantu.
- Hybrid AI vs. PvP: hra proti AI (všech variant) běží CELÁ v prohlížeči (rules + engine search + výběr tahu ve Web Workeru). PvP dál potřebuje autoritativní server.
- Jeden klient, dva backendy: LocalClient (AI, v prohlížeči) + HttpClient (PvP, server) za jedním rozhraním. Server AI nepočítá.
- Sdílený zdroj logiky AI (@checkers/ai): server i prohlížeč staví výběr tahu z JEDNOHO kódu; per-varianta jen jiné váhy hodnocení. Italská má krátkou dámu → váhy blízké americké, self-play sanity (ne turnajová síla).
- Mistrovství a losování zahájení (3-move ballot) zůstávají JEN pro americkou variantu; ostatní varianty (včetně italské) jedou jako volná hra proti AI + PvP. Výuková nápověda (/hint lokálně) funguje ve všech variantách.
- Přepnutí varianty rozehranou partii zahodí a začne novou; volba varianty se pamatuje v LocalStorage, default je americká.
- Síla přes hloubku, ne čas (offline): strop maxDepth 12 pro silné úrovně. Server zůstává časový.
- Publikovatelný statický build: Vite dist/ jako zip, AI (všechny varianty) bez herního serveru. PvP z cross-origin hostingu (itch) míří na VPS → CORS + WSS + absolutní URL serveru.
- Real-time PvP přes WebSocket; stav PvP partie v paměti serveru (reconnection po krátkém výpadku, restart serveru partie maže, timeout nečinnosti uvolní partii).
- Orientace desky: každý hráč vidí desku ze své strany.
- PDN archiv dokončených partií (AI i PvP) zůstává, jednosměrný zápis; do PDN se zapisuje i varianta.

## Non-goals
- Nepřidávej varianty s POVINNÝM MAXIMEM braní mimo italskou v tomto kroku - brazilská ani španělská ještě ne (vrstva maxima teď vzniká kvůli italské; další varianty jsou samostatné fáze).
- Nepřidávej varianty s jinou geometrií (turecká, arménská, thajská) ani desku 10×10 - to nejsou moduly, ale jiné hry.
- NEmodeluj italskou otočenou desku jako změnu souřadnic - žádný zásah do parity polí, číslování nebo Zobristu v board.ts. Orientace je POUZE vizuální rotace renderu.
- NEstav obecný framework/komparátor priority braní "pro budoucí varianty" - jen enum + konkrétní větev. Skládatelný jazyk priorit se přidá, až bude reálně víc variant, které ho sdílejí.
- NEměň generování tahů ani perft čísla stávajících variant (americká/pool/ruská/česká) - vrstva maxima je aditivní, aktivní jen italským flagem.
- Neimplementuj oficiální FID číslování polí 1-32 v PDN - důsledek vizuální rotace; projekt PDN jen zapisuje, nečte.
- NErestyluj ostatní varianty - red/white kameny a right_game_board jsou jen pro italskou.
- Nedělej Mistrovství ani 3-move ballot pro nové varianty (včetně italské) - Mistrovství zůstává jen americké.
- Nepřidávej uživatelem zakládané/pojmenované PvP místnosti - jen fixní varianta-lobby, jedna na variantu.
- Nedělej per-varianta opening book - italská (ani flying varianty) běží bez knihy.
- Neukládej variantu do hashované Position - varianta patří do GameState/metadat místnosti.
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
- V lobby (AIvP) zvolím italskou a odehraju kompletní partii proti AI CELÉ v prohlížeči BEZ herního serveru; publikovatelný statický build zahrnuje i italskou.
- Perft italské je ověřený proti FID zdroji, VČETNĚ maxima, kvalitativní priority a pravidla "muž nesmí brát dámu".
- Vynucení maxima a FID priority: klient i SERVER odmítnou tah, který nebere maximum nebo nectí prioritu. Adversariální fixtures to dokazují (2-braní neprojde když existuje 3-braní; braní mužem neprojde když jde brát dámou; muž nepřeskočí dámu).
- Refaktor vrstvy maxima NEZMĚNIL stávající varianty: perft 1-6 americké/pool/ruské/české a všechny testy zelené BEZE ZMĚNY čísel.
- Italská má krátkou dámu, muž i braní jen dopředu, proměna na poslední řadě ukončí tah (nemění se uprostřed braní).
- AI v italské netahá zjevné blbosti (self-play sanity, ne turnajová síla).
- PvP: italská má vlastní fixní lobby; hráči se vidí, vyzvou a odehrají partii; server je autorita nad italskými pravidly.
- Otočená deska + red/white assety fungují JEN pro italskou; ostatní varianty vizuálně netknuté.
- Přepnutí varianty rozehranou partii zahodí; volba se pamatuje mezi spuštěními.
- Italská AIvP i PvP fungují z cross-origin hostingu (itch) přes VPS pro PvP.

## Main constraints
Stack varianta A: TypeScript všude (pnpm workspaces, Node 24 LTS, Fastify + zod, Vite + vanilla TS klient, Vitest). Real-time PvP přes WebSocket (@fastify/websocket), server zůstává autoritou PvP a validuje podle Ruleset dané místnosti. Klient spouští engine i v prohlížeči (Web Worker) pro offline AI všech variant; publikovatelný statický build (Vite dist/) bez PWA/service workeru; PvP z cross-origin hostingu vyžaduje CORS + WSS. Engine je TS; Rust engine je pozdější PODMÍNĚNÝ krok. Ruleset se protahuje ~8 call sites (engine, web, ai, server); varianta v GameState/metadatech místnosti, ne v Position. Italská přidává vrstvu maxima+priority do legalMoves (aditivní), otočenou desku řeší jen render.

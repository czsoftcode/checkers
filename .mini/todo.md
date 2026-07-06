# Ideas & changes

> Archive of future ideas and changes for this project. Managed by `mini todo`
> (`add` / `done` / `remove`); `mini next` offers the open items as candidate
> phase ideas. You can also edit this checklist by hand.
- [x] [M0] Kostra monorepa + CI: pnpm workspaces (balíčky rules/engine/server/web), TS strict, Vitest, lint, GitHub Actions (lint+test na push). Brána: prázdný test zelený v CI.
- [x] [M1] Typy a deska: Color/Cell/Position/Move, číslování polí 1-32, převod souřadnic, předpočítané tabulky NEIGHBORS[32][4] a JUMPS[32][4]. Brána: unit testy převodu a sousedů.
- [x] [M1] Prosté tahy: rozestavění (černý 1-12, bílý 21-32, černý začíná), generátor tahů bez braní - muž jen vpřed o 1, dáma všesměr o 1 (NENÍ dálková). Brána: testy včetně dáma jen o 1 pole.
- [x] [M1] Braní jednoduché: skok přes soupeře na prázdné pole za ním, povinnost braní (při existenci skoku generátor nevrací prostý tah), muž bere jen vpřed, dáma všesměr. Brána: testy povinného braní.
- [x] [M1] Vícenásobný skok: rekurze + větvení z jednoho dopadu, kámen nelze přeskočit 2x v sekvenci, volba kratší větve je legální. Brána: testy multi-skoků a větvení (GDD 2.7).
- [x] [M1] Proměna: muž na poslední řadě soupeře se stává dámou; proměna UPROSTŘED skoku tah okamžitě ukončuje (nepokračuje). Brána: golden testy proměny.
- [x] [M1] Aplikace tahu + konec hry: applyMove, detekce prohry hráče bez legálního tahu (i s kameny na desce, pat neexistuje). Brána: testy konce hry.
- [x] [M1] Remízová pravidla: trojí opakování pozice se stejnou stranou na tahu, 80 půltahů bez braní/tahu mužem (čítač pliesWithoutProgress, reset správně). Brána: testy remíz + garance terminace.
- [x] [M1] PDN zápis tahu: 22-18 (prostý), 26x17x10 (skok). Brána: testy notace obou směrů.
- [x] [M1] Perft + fixtures: funkce perft(N), ověření hodnot 1-6 (7/49/302/1469/7361/36768) proti NEZÁVISLÉMU zdroji, sdílené fixtures/*.json. BRÁNA M1: perft 1-6 sedí, všechny testy z 2.7 zelené. Nic mimo rules nevzniká dřív.
- [x] [M2] CLI hra: random vs random (musí vždy terminovat díky pravidlu 80 půltahů) a člověk vs random v terminálu. Brána: odehratelná partie bez UI a serveru = důkaz kompletnosti rules.
- [x] [M3] Engine protokol: samostatný proces, JSON Lines přes stdin/stdout (hello, bestmove, error, pole id + protocol), řádkový buffer (ne data event naslepo). Brána: hello a bestmove přes skutečný podproces.
- [x] [M3] Search jádro: negamax + alfa-beta, evaluace v1 (muž 100, dáma 130, bonus za zadní řadu, drobný postup). Brána: vybírá jen legální tahy, poráží random hráče.
- [x] [M3] Časová kontrola: iterativní prohlubování 1..N s měkkým limitem (vrací poslední KOMPLETNÍ iteraci, ne rozdělanou), quiescence - prodloužení o půltah při povinných skocích. BRÁNA M3: porazí random >=95 % ze 100, nikdy nepřekročí tvrdý timeout.
- [x] [M3] Síla pro cíl (i): silnější poziční evaluace (mobilita, kontrola dvojitého rohu) + transpoziční tabulky + Zobrist hash. Brána: self-play nová vs stará verze prokáže zlepšení (>=200 partií, střídání barev).
- [x] [M4] Server API: Fastify + zod, POST /games, GET /games/:id, POST /games/:id/moves, in-memory Map úložiště, 404 pro neexistující partii, 409 illegal_move + legalMoves. Brána: kompletní partie přes curl.
- [x] [M4] Orchestrace enginu: podproces + fronta (v1 sériově), NIKDY synchronně v handleru, tvrdý timeout = timeMs+500, kill + restart + 1 retry s timeMs/2, úklid zombie procesů při startu i vypnutí. BRÁNA M4: kill enginu uprostřed přemýšlení -> partie přežije.
- [x] [M5] Šachovnice: CSS grid deska, vykreslení pozice, výběr kamene, zvýraznění legálních tahů přes sdílenou rules. Brána: klikatelná deska se správným zvýrazněním.
- [x] [M5] UI vícenásobného skoku: doklikávání sekvence dopadů a volba větve (nejhorší UX část hry - navrhnout interakci předem). Brána: hráč zadá multi-skok i větvení bez zaseknutí.
- [x] [M5] Optimistický tah + resync: okamžitá odezva UI, po odpovědi serveru sync na plný stav, při neshodě tvrdý resync + log, polling GET ~250 ms, stavový řádek, konec hry. BRÁNA v1: splněna definice hotového ze sekce 0.
- [x] [M5] Archiv partií (klient): ukládání dokončených partií do LocalStorage v PDN, tlačítko Export -> jeden .pdn soubor, ošetření QuotaExceededError. Brána: partie se uloží, export stáhne validní PDN; zpět do hry se nenačítá.
- [ ] [M6] Hardening: víc souběžných partií, chování fronty, úklid procesů, zátěžový test. Brána: N souběžných partií bez zombie procesů a bez zamrznutí API.
- [ ] [M6] (Podmíněně) Rust engine: za stejným protokolem, vlastní generátor pravidel přibitý stejným perftem + fixtures, self-play proti TS enginu. Brána: TS a Rust prohoditelné konfigurací serveru. Jen pokud TS engine nedosáhne na cíl (i).
- [ ] [M6a] zavest bitboard zapis, pokud to bude potreba
- [ ] [M6] Engine LineBuffer: limit maximální délky řádku (např. 1 MB) - proud dat bez \n dnes roste v paměti bez omezení až k OOM; při překročení zahodit buffer a odpovědět error (nález self-review fáze 13)
- [ ] [M3/M6] Inkrementální Zobrist hashování v searchi: XOR rozdílu při tahu (kámen, braní, proměna, obrat strany) místo přepočtu z 32 polí na uzel. Motivace: fáze 17 měřila, že TT je na hodinách přínosná až od hloubky ~7; níž ji přebije režie přepočtu hashe. Inkrement bod zlomu posune dolů → TT přínosná i na provozních hloubkách 5-7. Brána: tt-gate ukáže poměr času s TT/bez TT < 1 i na hloubce 6. Jen pokud bude síla enginu na čas potřeba.
- [ ] Oprava USAGE nápovědy v packages/cli/src/main.ts: radí volání `pnpm --filter @checkers/cli start -- [volby]` s dvojitým `--`, jenže přes pnpm to spadne (pnpm propustí `--` do skriptu a parseArgs se strict:true ho odmítne jako positional argument, exit 1). Funguje jen BEZ `--`, tj. `pnpm --filter @checkers/cli start --mode human`. Opravit text USAGE (a případně exit-kódový komentář) tak, aby radil funkční syntaxi bez `--`. README je už opravené správně (fáze 37), rozpor je jen ve vnitřní nápovědě CLI.
- [ ] obecné zotavení z error napříč úrovněmi

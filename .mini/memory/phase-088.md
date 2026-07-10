# Phase 88 — Web: AI přes LocalClient

**Goal:** V main.ts přepnout AI/sólo desku (createAppShell) z HttpClient na LocalClient s reálným Web Workerem (oboje z fáze 87); PvP zůstává beze změny na serveru přes game-socket/room-client (ServerClient AI cestu nepoužívá). Sjednotit seznam úrovní s @checkers/ai: sdílet typ GameLevel + zub proti driftu (test, že webová GAME_LEVELS je permutací @checkers/ai LEVELS - stejná množina), UI pořadí professional-first zůstává lokální. Ověřit END-TO-END v prohlížeči (tady poprvé běží REÁLNÝ Web Worker, fáze 87 testovala jen in-process fakem): hra proti AI všech 5 úrovní vč. nápovědy Výuka, ballotu Mistrovství, remízy a vzdání je plně hratelná BEZ volání serveru; Vite worker bundling funguje, tah se počítá mimo hlavní vlákno, UI nezamrzne. Mimo řez: offline statický build (#50), PvP z cross-origin/CORS/WSS (#51), odstranění serverové AI (#52).

## Steps
- [done] Dedup GameLevel + permutační zub
- [done] Přepnout AI desku na LocalClient + worker
- [done] Ověřit Vite worker bundling
- [done] E2e přes Chrome bez serveru

## Auto-commit
- Phase 88: Web: AI přes LocalClient

## Discussion
# Phase 88 — Web: AI přes LocalClient

## Intent
Přepnout hru proti AI z `HttpClient` (server) na `LocalClient` + reálný Web Worker (oboje
UŽ existuje z fáze 87 v `packages/web/src/local/` a `local-client.ts`). Fáze NENÍ „napsat
worker" — worker (`createWebWorkerEngineWorker`), entry (`engine-worker-entry.ts`), jádro
(`compute-move.ts`, `strengthFor`, `MAX_OFFLINE_DEPTH=12`) i `createLocalClient` jsou hotové.
Fáze 88 = (1) drátování, (2) dedup úrovní, (3) POPRVÉ reálně spustit worker v prohlížeči a
ověřit e2e.

Konkrétně:
- `main.ts:43` `const client = createHttpClient()` → `createLocalClient(createWebWorkerEngineWorker())`
  pro AI/sólo desku (`createAppShell`). PvP se NEDOTÝKÁ — jede přes `game-screen`/`game-socket`/
  `room-client`, `ServerClient` AI cestu nepoužívá. `client` v `main.ts` jde JEN do
  `createAppShell` (sólo).
- Po přepnutí je `createHttpClient` z webu nevolané (odstranění až #52); impl a `server-client.ts`
  (typy, `PvpGameDto`, `GAME_LEVELS`) ZŮSTÁVAJÍ.

## Key decisions
- **E2e ověření reálného workeru = skutečný prohlížeč** (Vitest+jsdom Worker nespustí). Primárně
  to projde Claude přes Chrome (claude-in-chrome MCP) na `pnpm dev` (Vite) SE SERVEROVÝM PROCESEM
  NESPUŠTĚNÝM — poctivý důkaz, že AI na serveru nevisí. Fallback: uživatel ručně na mobilu.
  Akceptační checklist: všech 5 úrovní + nápověda (Výuka) + ballot (Mistrovství) + remíza + vzdání,
  hratelné bez serveru, UI nezamrzne, tah se počítá mimo hlavní vlákno.
- **Jedna instance worker+`LocalClient` na život stránky** (jako dnes jeden `HttpClient`),
  předávaná sólo desce opakovaně; worker se neukončuje (žije se stránkou). NE per-mount+dispose.
- **Dedup úrovní:** sdílet z `@checkers/ai` TYP `GameLevel` (dnes ho `server-client.ts` odvozuje
  z vlastního `GAME_LEVELS`); webové `GAME_LEVELS` nechat jako LOKÁLNÍ seřazené pole
  (professional-first kvůli UI defaultu — POZOR: `@checkers/ai` `LEVELS` je championship-first,
  jiné pořadí ZÁMĚRNĚ). Zub: test, že `GAME_LEVELS` je permutací `@checkers/ai` `LEVELS` (stejná
  množina). `app-shell.ts` importuje `GAME_LEVELS` ze `server-client.ts` — po dedupu musí dál sedět.
- **Minimální doba přemýšlení (fáze 30) je KLIENTSKÁ** (`controller.ts:432-445`, floor
  `aiMovePauseMs` od konce animace tahu člověka) → funguje i s `LocalClient`, ŽÁDNÁ regrese.

## Watch out for
- **INVARIANT flooru:** `LocalClient.postMove` NESMÍ vrátit už spočítaný tah enginu — musí vrátit
  `thinking` a tah enginu dorazit až dalším `getGame` pollem. Floor v controlleru na tom stojí
  (`controller.ts:432`: kdyby tah přišel rovnou v odpovědi na postMove, floor by se tiše přestal
  aplikovat). V e2e explicitně ověřit: Začátečník (d1, prakticky okamžitý search) NESMÍ táhnout
  dřív než floor. Fáze 87 to má řešit thinking→idle modelem — potvrdit, že to drží i s reálným
  (skutečně async) workerem.
- **Vite worker bundling** (`new Worker(new URL('./engine-worker-entry.ts', import.meta.url),
  {type:'module'})`) balí `@checkers/ai`+`@checkers/engine` do module workeru — hlavní riziko, že
  to v reálném buildu/dev nepoběží (dosud jen in-process fake). Ověřit i v `vite build` (ne jen dev).
- **Stale stav v `LocalClient`:** při opakovaném vstupu do sóla se v mapě partií (`by id`) hromadí
  staré hry (jedna instance klienta). Korektnost to neohrožuje (shell drží jen aktuální id), jen
  drobná paměť — zvážit úklid, neblokovat kvůli tomu fázi.
- **`createHttpClient` po přepnutí nevolané** — nechat (odstranění je #52); nepletl bych do téhle
  fáze mazání serverové AI.
- **Mimo řez:** offline statický build (#50), PvP z cross-origin/CORS/WSS (#51), odstranění
  serverové AI (#52).

## Run report
---
phase: 88
verdict: done
steps:
  - title: "Dedup GameLevel + permutační zub"
    status: done
  - title: "Přepnout AI desku na LocalClient + worker"
    status: done
  - title: "Ověřit Vite worker bundling"
    status: done
  - title: "E2e přes Chrome bez serveru"
    status: done
verify:
  - title: "Vizuální průchod sóla na reálné obrazovce / mobilu"
    detail: "Chování všech 5 úrovní, nápovědy (Výuka), ballotu (Mistrovství), remízy i vzdání jsem ověřil MECHANICKY přes reálný Vite-zabalený Web Worker (JS harness proti createLocalClient + reálnému workeru přímo v prohlížeči) + DOM/network/konzole. NEmohl jsem ale pořídit screenshoty/záznam samotného vykreslení desky (canvas): Chrome okno bylo u mě celou dobu skryté (document.visibilityState='hidden'), takže CDP captureScreenshot na herní desce vždy vypršel (30 s). Vzhled a hratelnost UI tak potřebují lidské oko – ideálně ruční test na mobilu, jak počítala diskuze."
  - title: "Subjektivní plynulost: UI nezamrzne během thinking"
    detail: "Výpočet tahu běží v reálném Web Workeru (mimo hlavní vlákno – architektonicky dané konstrukcí new Worker + doložené tím, že worker reálně spočítal tah), takže hlavní vlákno teoreticky nezamrzne. Plynulost animace během ~1s searche ale mým měřením spolehlivě neověříš: skrytý tab Chrome throttluje časovače (holý setInterval dal za 1 s jen 3 tiky), takže tick-test na zamrznutí je v tomhle prostředí neplatný. Potvrď okem na viditelné obrazovce."
  - title: "Floor timing: Začátečník netáhne dřív než aiMovePauseMs (jak je VIDĚT)"
    detail: "Kontrakt, na kterém floor stojí, jsem ověřil: postMove vrací engineStatus='thinking' a tah na enginovu barvu, tah enginu se NEvrací rovnou v odpovědi (dorazí až getGame pollem). Samotné časování je klientské v controlleru (testy fáze 30/87). Vizuální potvrzení prodlevy u Začátečníka (d1, prakticky okamžitý search) chce oko."
---

# Fáze 88 — report z auto session

## Co je hotové a jak ověřené

**1) Dedup úrovní (server-client.ts + nový permutační test).**
`GameLevel` se teď importuje/re-exportuje z `@checkers/ai` (jediný zdroj typu); webové `GAME_LEVELS` zůstává lokální seřazené pole (professional-first kvůli UI defaultu). Drift hlídám DVOJITĚ:
- compile-time: `... as const satisfies readonly GameLevel[]` (úroveň navíc/překlep na webu shodí typecheck),
- runtime: `test/server-client-levels.test.ts` – multiset-rovnost `GAME_LEVELS` vs `@checkers/ai LEVELS` (chytí i úroveň chybějící na webu), + kontrola záměrně JINÉHO pořadí a unikátnosti.
Zuby ověřené: po dočasném odebrání `education` z `GAME_LEVELS` permutační test padne.

**2) Přepnutí sólo desky na LocalClient + worker (main.ts).**
`createHttpClient()` → `createLocalClient(createWebWorkerEngineWorker())`, ale vytvořené **LÍNĚ** (jedna cachovaná instance na život stránky – drží se, ne per-mount+dispose). PvP (game-screen/game-socket/room-client) se klienta nedotýká; `createHttpClient` zůstává v kódu, jen nevolané. V prohlížeči doloženo: po čerstvém načtení a vyčištění network vznikl **přesně 1 worker request až při vstupu do sóla** (ne při načtení stránky) → hráč jen v lobby/PvP zbytečně nespouští vlákno enginu.

**3) Vite worker bundling.**
`pnpm --filter @checkers/web build` vyprodukoval samostatný module-worker chunk `dist/assets/engine-worker-entry-*.js` (17,66 kB), obsahuje zabalený engine (`carelessness`, `maxDepth`), knihu (`book`) i pravidla; main chunk ho referencuje. V dev prohlížeči se `engine-worker-entry.ts?worker_file&type=module` načetl bez chyby v konzoli.

**4) E2e přes Chrome BEZ serverové AI cesty.**
Dev server jsem pustil na vlastním portu (5199); tvoje běžící procesy (server 3000, Vite 5173, od 6.–9. 7.) jsem **záměrně nechal běžet** – nezabíjím dlouhoběžící cizí procesy. Místo „server vypnutý" jsem použil přísnější důkaz: **AI hra nevygenerovala ŽÁDNÝ request na `/games`** (přestože server byl dostupný přes proxy – kdyby klient omylem sáhl na HttpClient, request by se objevil).
Proženo přímo v prohlížeči přes reálný `createLocalClient` + reálný Web Worker (JS harness, protože canvas desku nešlo ovládat přes screenshoty – viz níž):
- Začátečník: člověk (černý) 9→13, postMove vrátil `thinking`, engine přes worker dopočítal a zahrál (turn zpět na černého) – plný cyklus tah↔odpověď mimo hlavní vlákno.
- Mistrovství: ballot 3 půltahy + index, engine (bílý) po ballotu `thinking`.
- Výuka: `getHint` vrátil legální tah, stav nezměněn.
- Remíza: engine z výchozí pozice odmítl (`accepted:false`).
- Vzdání: člověk černý → `white-wins`.

## Nález, který teprve tahle fáze odhalila (a je opravený)

Fáze 87 testovala LocalClient jen v jsdom (Node), kde `crypto.randomUUID` existuje. V reálném prohlížeči přes prosté HTTP na LAN IP (přesně tak se testuje na mobilu, a tak k appce přistupoval i Chrome) je stránka **insecure context**, kde `crypto.randomUUID` je `undefined` → `createGame` shodil `TypeError` a AI deska nešla vůbec založit („Partii se nepodařilo založit"). Oprava: `newGameId()` v local-client.ts s fallbackem `randomUUID → getRandomValues → Date.now+Math.random` (ID je jen klíč do in-memory mapy, nepotřebuje secure context ani kryptosílu). Doloženo: po opravě má vrácené id 32 hex znaků bez pomlček = běžela reálně fallback větev, a hra se založí. Přidán test `test/local/local-client-gameid.test.ts` se zuby (stubuje `globalThis.crypto` na varianty bez randomUUID / úplně bez crypto; ověřeno pádem po odebrání getRandomValues větve).

## Robustnost navíc (z nezávislého self-review)

Sub-agent (čerstvý kontext) potvrdil, že kontrakt úrovní i `newGameId` guardy jsou korektní a PvP je nedotčené. Na jeho podnět jsem worker udělal líný (bod 2 výš) – dřív se vytvářel eagerně na úrovni modulu, takže se spouštěl i pro lobby/PvP hráče a případné synchronní selhání konstrukce (starý prohlížeč, budoucí CSP) by shodilo boot CELÉ appky na prázdnou stránku. Teď degraduje jen sólo.

## Mechanická brána (vše zelené)

- `pnpm --filter @checkers/web typecheck` ✅
- `pnpm lint` (celé repo) ✅
- `pnpm --filter @checkers/web test` → **555** testů (39 souborů; +3 permutační, +3 gameid) ✅
- `pnpm --filter @checkers/web build` ✅ (worker chunk v dist/)

## Co jsem NEmohl a proč (do verify)

Screenshoty/záznam samotné hry na desce nejdou: Chrome okno bylo u tebe skryté (`visibilityState='hidden'`), takže CDP captureScreenshot na canvasu vždy vypršel (lobby se fotí normálně, deska ne). Chování jsem proto doložil jinak (network + JS harness + DOM), vzhled/UX a plynulost animace nechávám na lidské oko – viz `verify` výš. Diskuze s tímhle fallbackem (ruční test na mobilu) počítala.

## Poznámky / vědomě neřešeno

- Růst `Map` partií v LocalClime napříč sólo sezeními (jedna instance klienta, staré hry se nemažou) – diskuze to vědomě odložila, korektnost to neohrožuje (shell drží jen aktuální id). Neblokující.
- Mimo řez dle zadání: offline statický build (#50), PvP cross-origin/CORS/WSS (#51), odstranění serverové AI (#52).

## Rozhodnutí k zaznamenání?

Nejspíš netřeba ADR. Oprava crypto je přímý důsledek nálezu (ne zvážená a zamítnutá alternativa). Jediné, co by za záznam stálo, je vědomá podpora **insecure contextu** (HTTP na LAN / hosting bez TLS) přes non-UUID id – plyne to z cíle projektu (test na mobilu, publikovatelný build), ale kdyby ses chtěl k tomu „proč" vrátit, je to na `/mini:decision` před `/mini:done`.

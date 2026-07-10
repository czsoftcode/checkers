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

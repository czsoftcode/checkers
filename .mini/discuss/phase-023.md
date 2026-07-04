# Phase 23 — Server ukládá partie na disk

## Intent
Když partie dojde do terminálního stavu (výhra/prohra/remíza), server z ní vyrobí
kompletní PDN celé partie (hlavička + očíslované tahy + výsledkový token) a atomicky
ho zapíše jako `<id>.pdn`. Jednosměrně: zpět se do hry nenačítá, stav dál žije v
paměti serveru (server zůstává autoritou). Selhání zápisu partii neshodí, jen se
zaloguje. Nahrazuje původní backlog-21 (klientský LocalStorage archiv), který tímto
padá — vědomá změna non-goalu (server se poprvé dotýká disku, jednosměrně).

## Key decisions
- **Evidence tahů ve store (nutné, hlavní rozšíření rozsahu).** `GameStore`/`GameState`
  dnes NEDRŽÍ seznam odehraných tahů — `advanceState` tah zahraje a store ho zahodí;
  `GameState` má jen `position` + `pliesWithoutProgress` + `repetitionHistory` (klíče
  pozic, ne tahy). Z finální pozice tahy zpětně NEJDOU zrekonstruovat. Fáze proto musí
  napřed přidat pole tahů do `StoredGame`/`GameRecord`, plněné v `store.applyMove()`
  na OBOU místech (tah člověka i tah enginu). Bez toho PDN nelze sestavit.
- **Serializér celé partie → do balíku `server`** (ne do rules). Jen server ho
  potřebuje (CLI ne), nezavádět vrstvu „pro budoucnost" do rules. Čistá funkce,
  otestovaná unit testem. Pro jednotlivé tahy použít existující `formatMove()` z rules.
- **Hlavičkové tagy (7 STR):** `[Event "Checkers"]`, `[Site "local"]`,
  `[Date "YYYY.MM.DD"]` (dnešek přes `new Date()` — v serveru povoleno), `[Round "-"]`,
  `[White "Engine"]`, `[Black "Human"]`, `[Result "…"]`. Jména hráčů se neřeší
  (multiplayer je non-goal).
- **Mapování hráčů/výsledku (z app.ts):** člověk = ČERNÝ (Black, začíná), engine =
  BÍLÝ (White; `ENGINE_COLOR = 'white'`). `GameResult` → token: `black-wins` → `0-1`,
  `white-wins` → `1-0`, `draw` → `1/2-1/2`. (`ongoing` se nikdy nezapisuje.)
- **Zápis se odčeká (await), chyba se jen zaloguje.** V cestě `POST /moves` (partii
  ukončí tah člověka) i v `runEngineMove` (ukončí tah enginu) se zápis awaituje;
  jednodušší na uvažování i test než fire-and-forget. Selhání → `console.error`,
  partie pokračuje/zůstává stát.
- **Konfigurace:** env `CHECKERS_PDN_DIR`, výchozí `.pdn` relativně k `process.cwd()`.
  Adresář se vytvoří `fs.mkdir(dir, { recursive: true })`. Cesta se předá do `buildApp`
  jako `pdnDir?` (DI kvůli testovatelnosti, stejně jako engine/port); env čte až
  `main.ts`, ne `app.ts`.
- `.pdn/` přidat do `.gitignore`.

## Watch out for
- **Právě jednou.** Terminální stav se dosáhne jen na dvou `applyMove` místech
  (POST člověk ř. 131, engine ř. 211); polling GET tah neaplikuje, takže sám o sobě
  zápis nespustí. Přesto přidat příznak `archived` do záznamu, aby žádná re-entrantní
  cesta nezapsala partii dvakrát. Kontrola terminality přes `gameResultFromState(state)
  !== 'ongoing'` PO aplikaci tahu.
- **Atomicita + úklid při selhání.** Psát do `<id>.pdn.tmp` v TÉMŽE adresáři, pak
  `fs.rename` na `<id>.pdn` (atomické na stejném FS). Když `rename`/zápis selže,
  `.tmp` po sobě uklidit (`unlink`), ať nezůstává půlka souboru (checklist bod 5).
- **Rozsah catch.** Obalit jen I/O (mkdir/write/rename/unlink). Nemaskovat programovou
  chybu v sestavení PDN (ta ať padne hlasitě — je to chyba serveru, ne I/O).
- **Číslování tahů v movetextu.** Full-move číslování páruje černý+bílý půltah
  (`1. <black> <white> 2. …`). Černý začíná. Ošetřit LICHÝ počet půltahů (partie končí
  po tahu černého → poslední číslo má jen jeden půltah). Otestovat.
- **Ambiguita výchozího adresáře.** `.pdn` relativně k `process.cwd()` = root repa
  jen když se server spouští z rootu (`pnpm dev` z rootu). Z `packages/server` by to
  bylo jinde. Zdokumentovat u env proměnné.
- **Nedohrané partie se nearchivují** (restart serveru mid-game, in-memory) — vědomě
  přijato (jednosměrné, best-effort).
- **Test se zuby.** Přes `mkdtemp` do dočasného adresáře odehrát KRÁTKOU partii do
  reálného konce (ne mock), pak ověřit, že `<id>.pdn` existuje a obsah má hlavičku,
  správný výsledkový token a očíslované tahy. Test na selhání zápisu: neexistující/
  read-only adresář → partie NEspadne, jen se zaloguje, žádný `.tmp` nezůstane.
- **Bez enginu.** `buildApp` běží i bez enginu (`engine === undefined`); archivace
  musí fungovat vždy, když se dosáhne terminálního stavu, nezávisle na přítomnosti
  enginu.

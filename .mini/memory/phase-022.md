# Phase 22 — Klient napojen na server

**Goal:** Web klient místo lokálního applyMove vytvoří partii přes POST /games, tah člověka odešle na POST /games/:id/moves a desku nastaví na autoritativní GameDto z odpovědi, a pollingem GET /games/:id (~250 ms) zachytí a zobrazí odpovědní tah enginu - klient se stává prezentací serverového stavu, ne druhým rozhodčím. Mimo rozsah: optimistický tah + mismatch resync, stavový řádek, zobrazení konce hry, PDN archiv.

## Steps
- [done] Vite proxy + typovaný server-klient
- [done] Controller: async, stav bere ze serveru
- [done] Polling tahu enginu (single-flight)
- [done] Bootstrap: partie ze serveru + načítání
- [done] Defenzivní cesty: neúspěch + resync
- [done] Sebekontrola unhappy path + nezávislý self-review

## Auto-commit
- Phase 22: Klient napojen na server

## Discussion
# Phase 22 — Klient napojen na server

## Intent
Klient přestává být „druhý rozhodčí". Dnes běží `applyMove` z `rules` v prohlížeči
a obě barvy se klikají lokálně (hot-seat). Po fázi klient jen **zobrazuje** stav,
který vydá server (jediná autorita):
- při načtení založí partii `POST /games` a vykreslí pozici z odpovědi,
- dokončený tah člověka (from + path) pošle `POST /games/:id/moves`, desku nastaví
  na `GameDto` z odpovědi,
- tah enginu (bílý) uvidí opožděně přes polling `GET /games/:id`.
`rules` v klientu ZŮSTÁVAJÍ, ale už jen na zvýrazňování legálních tahů (výběr
kamene, dopady vícenásobného skoku) — ne na provádění tahu.

Mimo rozsah (další fáze): optimistický tah + mismatch resync, stavový řádek,
zobrazení konce hry, PDN archiv, tlačítko Nová hra.

## Key decisions
- **Propojení dev serverů: Vite proxy.** Klient volá relativní cesty (`/games…`),
  Vite dev server (:5173) je přeposílá na server (:3000, DEFAULT_PORT). Žádné CORS,
  žádná URL serveru natvrdo v klientském kódu. Nastavit `server.proxy` ve
  `vite.config.ts`.
- **Založení partie: automaticky při načtení.** Klient na startu udělá
  `POST /games` a vykreslí. Restart hry = reload stránky. Bez tlačítka Nová hra.
- **Polling: stálá smyčka à 250 ms, v jednu chvíli JEN JEDEN request.** Interval
  pořád běží a synchronizuje desku na serverový stav; když už jeden request běží
  (POST tahu i GET poll), tik se přeskočí (single-flight). Tím se řeší závod o
  pořadí — GameDto nenese verzi/pořadové číslo, takže dva souběžné snímky nejde
  spolehlivě seřadit; jediný request naráz to obejde bez zásahu do serveru.
- **Chyba enginu / stuck stav: zatím jen nezaseknout + `console`.** Deska nepustí
  výběr (není na tahu člověk), `engineStatus === 'error'` se zaloguje. Viditelný
  stavový řádek a hlášení konce hry vědomě až v další fázi.
- **Barva člověka = černý, natvrdo.** Server to má taky napevno (ENGINE_COLOR =
  white). Klient je „na tahu", právě když `position.turn === 'black'`.
- **Deska se seedne z odpovědi `POST /games`, ne z lokálního `initialPosition()`.**
  Jediný zdroj pravdy zůstává server; během zakládání ukázat „načítání", ne
  lokálně dopočítanou startovní pozici. `main.ts` už nevolá
  `createBoardController(initialPosition())`.
- **Přístup k serveru za injektovatelnou abstrakcí (kvůli testům).** Controller se
  stává async + závislý na síti. Zavést tenký typovaný klient (např.
  `createGame` / `getGame` / `postMove` nad `fetch`) a injektovat ho do
  controlleru, ať jde v jsdom/Vitest otestovat proti fake klientovi bez reálného
  serveru.

## Watch out for
- **Blokovat výběr, když je na tahu engine.** Dnešní `selectableAt` pouští výběr
  podle `position.turn`. Po tahu člověka je `turn = white` — klient MUSÍ výběr
  zablokovat, dokud polling nevrátí `turn = black`. Jinak jdou klikat bílé kameny
  a posílat tahy, které dostanou 409 not_your_turn.
- **Zamknout klikání během běžícího requestu.** Dokud běží POST tahu, ignorovat
  další kliky (nebo je zahodit), ať nevzniknou dva souběžné tahy / nekonzistentní
  výběr. Souvisí se single-flight pollingem.
- **Odchylka POST vs. polling.** POST vrací stav HNED po tahu člověka (engine
  ještě nedotáhl, `engineStatus` může být `thinking`). Skutečný tah enginu dorazí
  až pozdějším pollem. Deska se nesmí „vrátit" — reconcile vždy jen přebírá plný
  serverový stav, nedopočítává.
- **Neúspěšná odpověď (409/404/5xx/síťová chyba) na POST.** Na localhostu se
  stejnou `rules` by legální tah člověka projít měl, ale defenzivně: na non-2xx
  udělat resync `GET` + `console.error`, deskou nezaseknout. 409 illegal vrací
  `legalMoves` v detailu, NE plnou pozici → resync přes GET, ne z error těla.
- **`path` smí obsahovat duplicity** (kruhový skok dámy). Do těla POST posílat
  `from` + celou `path` v pořadí tak, jak je drží model výběru; neredukovat přes
  `Set`.
- **Odstranit `applyMove` z klientské cesty tahu.** Dokončení sekvence (prázdné
  `nextTargets`) už neaplikuje tah lokálně — jen vezme `from` + naklikanou `path`
  ze `selection` a pošle je serveru. `resolveMove` k tomu není nutný (from+path
  jsou v `selection`); zvážit, jestli ho v klientu ještě něco potřebuje.
- **Terminální pozice / konec hry** je pořád mimo rozsah zobrazení — deska prostě
  nepustí výběr (žádné legální tahy pro člověka). Jen se kvůli tomu nesmí
  zaseknout ani spadnout.
- **Životní cyklus intervalu.** Polling interval po sobě uklidit není v SPA kritické
  (stránka žije), ale ať se nespustí víc intervalů naráz při opakovaném vytvoření
  desky; jeden interval na controller.

## Run report
---
phase: 22
verdict: done
steps:
  - title: "Vite proxy + typovaný server-klient"
    status: done
  - title: "Controller: async, stav bere ze serveru"
    status: done
  - title: "Polling tahu enginu (single-flight)"
    status: done
  - title: "Bootstrap: partie ze serveru + načítání"
    status: done
  - title: "Defenzivní cesty: neúspěch + resync"
    status: done
  - title: "Sebekontrola unhappy path + nezávislý self-review"
    status: done
verify:
  - title: "Vizuální hra v prohlížeči proti enginu"
    detail: "Mechanicky ověřeno po HTTP vrstvu (curl přes server i Vite proxy). Vizuální tok a spolehlivost kliku ověřil uživatel v prohlížeči; nález 22-1 (spolknutý klik při pollingu) opraven a re-verifikován."
---

# Phase 22 — report z auto session

## Co je hotové
Webový klient přestal být „druhý rozhodčí". Dřív hrál hot-seat lokálně přes
`applyMove`; teď:
- při načtení založí partii `POST /games` a vykreslí pozici z odpovědi
  (`main.ts`, do té doby „Načítám partii…", žádný lokální `initialPosition()`),
- dokončený tah člověka pošle `POST /games/:id/moves` a desku nastaví na vrácený
  `GameDto` (`controller.ts` je nově async, `applyMove` z klientské cesty zmizel),
- tah enginu (bílý) zachytí polling `GET /games/:id` à 250 ms.

Nový modul `server-client.ts` je jediná síťová vrstva (typovaný `ServerClient`
nad `fetch`, `GameDto`/`ServerError`). `vite.config.ts` má proxy `/games` na
`127.0.0.1:3000`, takže klient volá relativní cesty (žádné CORS, žádná URL
natvrdo). `rules` v klientu zůstávají jen na zvýrazňování legálních tahů;
`selection.ts` je beze změny (`resolveMove` je nadále exportovaný a testovaný, ale
controller ho už nepoužívá – viz Otevřené).

## Ověření
- Lint čistý, typecheck všech balíčků, build web OK.
- Testy: web 48 (bylo 45 + 3 nové), server 39, engine 213, cli 24 – vše zelené.
- E2e (curl) proti reálnému serveru i přes Vite proxy: `POST /games` → `POST` tah
  člověka → `turn=white`/`engineStatus=thinking` → po ~2 s `turn=black`/`idle`
  (engine odpověděl). Kontrakt DTO i tělo `{from,path}` sedí. Procesy po sobě
  uklizené (žádný zombie engine, port 3000 uvolněn).

## Nezávislý self-review (red-team sub-agent)
Potvrdil, že single-flight zámek je těsný (busy se nastavuje synchronně před
prvním `await`), `busy` nemůže zůstat natrvalo `true` (finally s `busy=false`
před `render`), blokování výběru za engine funguje a přebalení síťové chyby
nemaskuje programovou chybu. Našel jeden reálný STŘEDNÍ nález, který jsem **opravil**:

- **Úspěšná odpověď se parsovala bez ochrany a bez kontroly tvaru.** Server (nebo
  špatně chytající proxy) mohl na `200` vrátit ne-JSON (`index.html`) → `SyntaxError`
  místo `ServerError`; nebo JSON jiného tvaru → `position=undefined` a pád `render()`
  na `TypeError` → **deska natrvalo rozbitá**. Přidán guard `parseGameDto` +
  lehký runtime guard tvaru `isGameDto` (ověří `position.board`/`turn`, `id`,
  `engineStatus`); cokoli mimo tvar se teď stane `ServerError`, který controller
  odchytí a dorovná. Kryto dvěma novými testy (200 s ne-JSON, 200 se špatným tvarem).

Přidán i test, že `engineStatus=error` z pollingu jen zaloguje a desku nezasekne.

## Otevřené / vědomě mimo rozsah (kandidáti do dalších fází M5)
- **Polling se nikdy nezastaví.** Běží dál i po konci partie a při nedostupném
  serveru (à 250 ms request, u výpadku navíc `console.error` donekonečna).
  Zastavení při `result !== 'ongoing'` souvisí se zobrazením konce hry, které je
  vědomě mimo rozsah této fáze. Návrh: utlumit poll, až se bude řešit konec hry /
  stavový řádek.
- **Klientský `GameDto` tvar serveru duplikuje** (web nezávisí na balíčku server).
  Runtime guard teď drift promění v `ServerError` místo tiché koruce, ale
  automatický kontraktní test proti reálnému `buildApp` chybí (nechtěl jsem vázat
  build graf web→server). Dnes tvar sedí přesně (ověřeno ručně i sub-agentem).
- **`resolveMove` v `selection.ts`** je po přechodu na server v produkci nevyužitý
  (controller posílá from+path přímo). Nechal jsem ho – je to čistý, testovaný
  helper a odstranění by zbytečně sáhlo do nesouvisejícího souboru + smazalo testy.
  Pokud vadí jako mrtvý kód, řekni a odstraním ho i s jeho testy.

## Trade-off fáze
Zvolen **neoptimistický** přístup: mezi kliknutím a přesunem kamene je jeden
round-trip serveru (na localhostu neznatelné, přes síť by drhlo). Optimistický
tah + mismatch resync a stavový řádek jsou vědomě odloženy do dalších fází.

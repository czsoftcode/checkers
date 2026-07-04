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

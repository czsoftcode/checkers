# Phase 18 — Server API (Fastify + zod)

## Intent
Autoritativní HTTP server (Fastify + zod) nad sdílenou knihovnou `rules`. Drží
rozehrané partie v paměti (`Map<id, GameRecord>`), validuje KAŽDÝ tah přes
`rules` (server = jediný zdroj pravdy). Engine v této fázi NENÍ — oba tahy
(černý i bílý) se posílají ručně curl-em. Brána M4-část-1: kompletní partie
odehraná přes curl, server nepřijme žádný nelegální tah.

## Key decisions
- **Zadání tahu (POST /games/:id/moves):** klient posílá `{ from, path }`
  (výchozí pole + pole dopadu). Server si sám dohledá odpovídající legální tah
  a z něj odvodí `captures` — klient NIKDY nediktuje braní. Match = najdi v
  `legalMoves(position)` tah, kde `move.from === req.from` a `move.path` se
  hluboce rovná `req.path`. Je unikátní (dva legální tahy nemají stejné
  from+path), a řeší i větvení vícenásobného skoku (plná cesta dopadů
  disambiguuje větev).
- **Tvar legalMoves ve výstupu (stav i chyba 409):** strukturované objekty
  `{ from, path, captures }` (celý `Move`). `captures` ve výstupu ANO — klient
  je nediktuje, ale potřebuje je pro zvýraznění/animaci braní v M5.
- **GET /games/:id vrací minimum:** `id`, `position` (`board` = pole 32 buněk +
  `turn`), `result` (`ongoing`/`black-wins`/`white-wins`/`draw` z
  `gameResultFromState`), `legalMoves` (strukturované). ŽÁDNÁ historie tahů
  (klientský PDN archiv je M5, teď YAGNI).
- **Endpointy:** `POST /games` (zakládá partii z `initialGameState()`, černý na
  tahu, vrací 201 + game DTO včetně `id`); `GET /games/:id`; `POST
  /games/:id/moves`.
- **Chybový kontrakt (jednotná obálka):** `400 invalid_request` (rozbité tělo /
  zod fail), `404 game_not_found`, `409 illegal_move` (+ aktuální `legalMoves`),
  `409 game_over` (tah do už skončené partie). Rozhodnout přesný tvar obálky
  v plánu, ale kód chyby musí být strojově čitelný.
- **ID partie:** `crypto.randomUUID()` (runtime, ne workflow — bez omezení).
- **Struktura kódu:** `buildApp()` factory (Fastify instance, testuje se přes
  `app.inject()`, bez reálného portu) + `main.ts`, který `listen` na
  `DEFAULT_PORT` — na něj míří curl brána.
- **Závislosti:** přidat `fastify` a `zod` do workspace katalogu
  (`pnpm-workspace.yaml`) + do `packages/server`. Node 24 LTS.

## Watch out for
- **Server jako jediná autorita — žádná duplicitní logika pravidel.** Legalita
  se určuje VÝHRADNĚ přes `legalMoves`/match, ne vlastními kontrolami. Tím se
  automaticky pokryje „nejsi na tahu" (tahy druhé strany nejsou v seznamu) i
  povinné braní (prostý tah není v seznamu, když je braní povinné) — bez
  jediného `if` navíc. Duplicita pravidel = přesně to, čemu se projekt vyhýbá.
- **`path` smí obsahovat duplicity** (dáma kruhovým skokem dopadne na už
  navštívené pole / zpět na `from`). Match musí být deep-equal celého pole
  `path` v pořadí, ne přes `Set`.
- **`applyMove`/`advanceState`/`cellAt` vyhazují `RangeError` na poškozeném
  vstupu.** Ale díky matchi proti `legalMoves` se do `advanceState` dostane jen
  ověřený legální tah → RangeError by tu značil chybu serveru, ne klienta.
  Nemaskovat ho jako 400/409; nechat probublat jako 500 (programová chyba).
- **Unhappy path k pokrytí testy (přes `app.inject`):** neexistující id (404 na
  GET i POST), rozbité/prázdné tělo a tělo mimo schéma (400), nelegální tah =
  400 vs. tah do skončené partie, tah po konci hry (409 game_over), povinné
  braní ignorováno (musí být 409 illegal_move), tah druhé strany (409). Testy
  musí mít zuby — dočasné rozbití validace musí shodit test, ne jen „běží to".
- **Cross-module kontrakt server↔M5:** tvar `Move` na drátě a tvar chybové
  obálky jsou kontrakt, na který se navěsí web klient. Zafixovat testem, ať
  změna tvaru později nekazí dvě místa potichu.
- **In-memory store, jeden proces, žádná perzistence** (záměr projektu). Souběh
  více partií a úklid procesů řeší M6, teď ne.

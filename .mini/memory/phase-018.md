# Phase 18 — Server API (Fastify + zod)

**Goal:** REST server s Fastify + zod a in-memory úložištěm partií (Map), endpointy POST /games, GET /games/:id, POST /games/:id/moves, validace každého tahu přes sdílenou knihovnu rules (server jako jediná autorita), 404 pro neexistující partii a 409 illegal_move s přiloženým seznamem legalMoves; brána = kompletní partie (oba tahy ručně) odehraná přes curl, bez enginu.

## Steps
- [done] Závislosti + kostra app (buildApp / main)
- [done] Serializace stavu + match tahu (čisté helpery)
- [done] Store + POST /games + GET /games/:id
- [done] POST /games/:id/moves — validace + aplikace tahu
- [done] Jednotná chybová obálka + testy se zuby
- [done] Curl brána: kompletní partie skriptem

## Auto-commit
- Phase 18: Server API (Fastify + zod)

## Discussion
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

## Run report
---
phase: 18
verdict: done
steps:
  - title: "Závislosti + kostra app (buildApp / main)"
    status: done
  - title: "Serializace stavu + match tahu (čisté helpery)"
    status: done
  - title: "Store + POST /games + GET /games/:id"
    status: done
  - title: "POST /games/:id/moves — validace + aplikace tahu"
    status: done
  - title: "Jednotná chybová obálka + testy se zuby"
    status: done
  - title: "Curl brána: kompletní partie skriptem"
    status: done
---

# Fáze 18 — report z auto session

## Co je hotové
Autoritativní HTTP server (`packages/server`, Fastify 5.9 + zod 4.4) nad sdílenou
`rules`. Server je jediný zdroj pravdy: legalita tahu se určuje VÝHRADNĚ přes
`legalMoves` + `findLegalMove` (shoda `from` + celé pole `path`), žádná pravidla
se neduplikují. `captures` se z klienta nečtou – server si je odvodí z generátoru.

- `buildApp()` factory (testuje se přes `app.inject()`), `main.ts` naslouchá na
  `DEFAULT_PORT` (přebitelný `PORT`).
- Endpointy: `POST /games` (201 + DTO), `GET /games/:id`, `POST /games/:id/moves`.
- In-memory `GameStore` (Map, `crypto.randomUUID()`), žádná perzistence.
- Ověřeno mechanicky: `pnpm -r typecheck` ✓, `pnpm lint` ✓, 22 server testů ✓,
  celý test suite repa ✓, `packages/server/scripts/curl-gate.sh` ✓ (kompletní
  partie skončila remízou po 95 tazích, server nepřijal nelegální tah, 404/409
  sedí; brána uklidí server i temp soubory a dva běhy po sobě fungují).

## Nezávislý self-review (čerstvý sub-agent) — co našel a jak vyřešeno
Před reportem proběhl nezávislý red-team (CLAUDE.md to u fází sahajících na
chybové cesty / vstupní body / kontrakty vyžaduje). Nálezy:

- **Important – drift 404 obálky u neznámé routy.** Fastify by na neexistující
  cestu/metodu vrátil vlastní tvar (`error` jako string, bez `code`). OPRAVENO:
  `setNotFoundHandler` sjednocuje obálku (`not_found`), pokryto 2 testy.
- **Important – curl brána nechávala běžet server (leak portu).** `exec setsid`
  tříštil PGID → group-kill míjel. OPRAVENO: pre-check portu před startem (stale
  server nemaskuje běh, selže hlučně), kill listeneru podle portu + čekání na
  uvolnění + eskalace SIGKILL. Ověřeno: port volný ihned po skončení, dva běhy
  po sobě OK.
- **Minor – leak interní zprávy frameworku klientovi.** OPRAVENO: framework 4xx
  vrací fixní „Neplatný požadavek".
- **Minor – mrtvá pojistka v bráně** (`[[ "$payload" != "null" ]]` se nikdy
  nespustí). OPRAVENO: kontrola přes `.legalMoves | length`.
- **Minor – křehká aserce v testu** (`expect(move && …)`). OPRAVENO: explicitní
  guard.
- **Pokrytí** (nález 7): doplněny testy neznámé routy, nepovolené metody,
  ignorování klientem podvržených `captures`/cizích klíčů, a explicitní aserce
  hazardu game_over-před-illegal_move u remízy s legálními tahy.

## Vědomě NEopraveno (drobnost)
- Framework 4xx mimo 400 (např. 415 špatný Content-Type, 413 velké tělo) se
  slévají do kódu `invalid_request`, takže HTTP status (415/413) a `code`
  nesedí 1:1. Není to tichý falešný úspěch (klient větví podle `code`, a
  „neplatný požadavek" pro 415/413 platí), jen kosmetická nekonzistence. Realistické
  4xx z frameworku v této fázi jsou 400 (rozbité JSON) a 404 (neznámá routa,
  ošetřeno). Kdyby M5 potřebovala jemnější mapování, je to malá změna v error
  handleru.

## Drátový kontrakt pro M5 (heads-up, ne blocker)
Zafixováno testy, ale změna tvaru později sáhne i do web klienta – ať to sedí,
než se na to navěsí M5. Stav = `{ id, position: { board[32], turn }, result,
legalMoves: [{from,path,captures}] }`; chyba = `{ error: { code, message },
legalMoves? }`. Kódy: `invalid_request` (400), `not_found` (404 neznámá routa),
`game_not_found` (404), `illegal_move` (409 + legalMoves), `game_over` (409),
`internal_error` (500).

## Poznámky pro navazující práci (M4 část 2, engine – todo 17)
- Handler tahu je **synchronní** a rychlý (jen rules + Map). Orchestrace enginu
  (todo 17) MUSÍ běžet mimo handler (fronta + podproces), nikdy synchronně –
  jinak jeden pomalý engine zablokuje celé API.
- `GameStore.applyMove` volá `advanceState`, který na poškozeném vstupu vyhazuje
  RangeError. Dnes nedosažitelné (jede jen ověřený legální tah) → padlo by to do
  500 (+ `console.error` zachová stack, logger je vypnutý). Až engine bude taky
  produkovat tahy, jeho výstup se MUSÍ hnát stejnou cestou (`findLegalMove`),
  ne přímo do `advanceState`.
- Neukládá se historie tahů (YAGNI) – až bude M5 chtít PDN archiv/resync,
  přibude buď na klientu, nebo se doplní do DTO (rozhodnout tehdy).

## ADR?
Klíčová rozhodnutí (tvar zadání tahu, tvar legalMoves, minimální stav) padla už
v `/mini:discuss` a jsou v `.mini/discuss/phase-018.md`. Jediné nové rozhodnutí
tady bylo „validovat zod ručně v handleru místo přidávání zod↔Fastify
compileru" – drobné, ADR nevyžaduje. `/mini:decision` bych nespouštěl, pokud na
tom netrváš.

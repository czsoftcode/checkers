---
phase: 70
verdict: done
steps:
  - title: "PvP serializace do DTO (dto.ts + dtoFor)"
    status: done
  - title: "GET /games/:id vrací PvP DTO; engine-only endpointy dál 409"
    status: done
  - title: "Vytáhnout sdílený helper tryApplyMove(record, from, path)"
    status: done
  - title: "Room-WS move handler s autoritou hráče"
    status: done
  - title: "Integrační test: dva WS klienti, hra + odmítnuté cesty + izolace"
    status: done
---

# Phase 70 — report z auto session

## Co je hotové
Server umí odehrát PvP partii a je nad ní autoritou:

- **DTO vrstva** (`dto.ts`): přidán diskriminátor `mode`. Engine DTO má `mode:'engine'`,
  nový `PvpGameDto` (`mode:'pvp'`) nese jen `id`/`position`/`result`/`legalMoves` – žádná
  engine pole (ani falešně `null`). `AnyGameDto = GameDto | PvpGameDto`, `GameStateMessage.game`
  je sjednocený tvar. `pvpGameToDto` bere `result` zvenčí (přes `effectiveResult`).
- **`dtoFor`** už na PvP NEhází – vrací PvP DTO. Tím přestal padat broadcast i GET.
- **`GET /games/:id`** vrací 200 PvP DTO. Zápisové/engine cesty (`POST /moves`, `resign`,
  `offer-draw`, `hint`) PvP dál odmítají 409 `pvp_not_playable`.
- **Sdílený helper `tryApplyMove`** (konec partie → `findLegalMove` → `applyMove`, bez engine
  a bez archivu) volá REST `POST /moves` i nový room-WS `move`. Chování REST /moves je beze
  změny (pořadí konec → autorita barvy → legalita zachováno).
- **Room-WS `move` handler**: `{type:'move',gameId,from,path}`. Autorita stojí na `me.id`
  (přiřazené socketu při joinu, NEČTE se z klienta). Řetěz: zapsán → partie existuje a je PvP
  → účastník (z toho barva) → partie není u konce → na tahu → legalita. Každý zádrhel = čistý
  `error` vyzývateli, socket žije, stav se nemění. Na úspěch broadcast OBĚMA přes game hub.

## Testy (zuby ověřené)
Nový `pvp-move-ws.test.ts` (10 případů, reální WS klienti přes `listen({port:0})`): legální
tah → oba game WS dostanou stav + přehozený `turn`; mimo pořadí; nelegální; neúčastník; cizí
gameId; tvarová chyba from/path; tah před joinem; tah na engine partii přes místnost; GET PvP
= 200; izolace kanálů (stav neteče po room WS). `dto.test.ts` a `pvp-endpoints.test.ts`
rozšířeny/upraveny (GET PvP obrácen na 200). Celá sada serveru: **278 testů zelených**,
`tsc --noEmit` i `eslint` čisté.

Zuby ověřeny reálně: dočasným rozbitím autority pořadí (`turn !== myColor` → `false`) padl
test „mimo pořadí" na rozdílu hlášky („Nelegální tah" místo „Nejsi na tahu") – test tedy
rozlišuje obě odmítnutí, ne jen „nějaká chyba".

## Adversariální self-review (nezávislý sub-agent, čerstvý kontext)
Potvrdil, že fáze je bez self-catchable chyb: autoritu nejde obejít (identita z uzávěru
socketu, ne ze zprávy; barvu soupeře zahrát nelze), `handleMove` je totální (nikde TypeError
mimo try), DTO union se všude zužuje přes `mode`, engine pole do PvP DTO neprosakují, refaktor
REST /moves zachoval chování. Dvě z jeho drobných připomínek jsem po review **zapracoval**:
(1) sjednotil pořadí „konec partie" vs. „na tahu" ve WS handleru s REST cestou; (2) doplnil
testy pro větve „tah před joinem" a „engine partie přes místnost".

## Vědomá omezení (mimo řez, pro pozdější fáze)
- **Binding na session id je křehký do todo 42**: PvP partie drží session id z room WS; po
  odpojení/reconnectu hráč dostane NOVÉ id a přestane být účastníkem → tah odmítnut. V rámci
  jednoho souvislého spojení funguje. Odpojení hráče uprostřed PvP partie soupeře neuvědomí a
  partii neukončí (konec/vzdání/timeout PvP = todo 40).
- **Archiv PvP do PDN je vypnutý** (todo 40): PvP tah nevolá `maybeArchive` ani engine. PvP
  partie sice může doběhnout pravidly (finální stav se rozešle oběma), ale na disk se nezapíše
  – PDN má natvrdo Human/Engine a přezdívky nejsou v záznamu partie.
- **Zápis PvP tahu jde výhradně přes room WS**; REST `POST /moves` PvP odmítá. Klient tedy
  potřebuje během hry 2 sockety (room pro tahy, game pro stav) – přechodné, směřuje k jednomu
  multiplexovanému socketu.

Klientské UI PvP desky a výzev je vědomě mimo tento řez.

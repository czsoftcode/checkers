---
phase: 68
verdict: done
steps:
  - title: "Model PvP partie v GameStore"
    status: done
  - title: "Engine-cesty se u PvP chovají bezpečně"
    status: done
  - title: "Registr výzev + busy stav (modul, unit testy)"
    status: done
  - title: "Room WS: protokol výzvy"
    status: done
  - title: "Integrační test se dvěma reálnými WS klienty"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Fáze 68 — report z auto session

## Co je hotové
Serverové jádro párování výzvou. Přítomní hráči v místnosti (`GET /room/ws`) se přes
tytéž WS zprávy vyzvou; při přijetí vznikne **PvP partie dvou lidí bez enginu**
navázaná na oba (barvou → session id) a oba dostanou její `id` + svou barvu
(vyzyvatel černá a táhne první, vyzvaný bílá). Ověřeno integračním testem se dvěma
reálnými `ws` klienty.

**Protokol (room WS):** klient→server `challenge{targetId}` / `accept{challengeId}` /
`reject{challengeId}`; server→klient `challenged` / `challenge-accepted{gameId,color,
opponentId}` / `challenge-rejected` / `challenge-cancelled` / `error`.

**Ošetřené hrany (plné, dle diskuse):** sebe-výzva, výzva na/od hrajícího (busy),
dvojitá (A→B 2×) i křížová (A→B a B→A) výzva → `error`; odchod během čekání zruší
výzvy a uvědomí protějšek `challenge-cancelled`; pozdní přijetí zaniklé výzvy →
`error`, ne partie; nevalidní/neúplné zprávy protokolu (chybí target/challengeId,
`JSON.parse('null')`, pole, primitivum, zpráva před join) → `error`, socket žije.

## Klíčová rozhodnutí v kódu
- **Model:** `GameRecord`/`StoredGame` jsou teď **diskriminovaná unie** `mode:
  'engine' | 'pvp'` (ne nullable pole). Engine varianta drží `level/ballotIndex/
  humanColor`, PvP varianta `players{black,white}`. `toRecord` má overloady, aby
  `create`→Engine, `createPvp`→PvP, `get`→union. Diskriminátor je zdroj pravdy —
  všechny engine cesty čtou engine-pole až po zúžení přes `mode`.
- **Bezpečnost engine cest:** PvP záznam se nesmí propašovat do engine logiky. REST
  endpointy (GET /games/:id, /moves, /resign, /offer-draw, /hint) PvP odmítnou
  novým 409 `pvp_not_playable` (partie JE → ne 404; není to chyba serveru → ne 500).
  `engineColorOf`/`dtoFor`/`maybeTriggerEngine`/`runEngineMove`/`resign`/`acceptDraw`
  mají navíc guard `mode==='pvp'` (nedosažitelné throw-assertions / no-op) jako
  obranu proti tichému zkreslení.
- **Registr výzev** je samostatný čistý modul (`challenges.ts`) bez transportu; WS
  route jen serializuje a rozesílá. Busy stav (kdo hraje) žije zde, ruší se JEN
  odchodem (konec PvP partie = todo 40).

## Nezávislý self-review (čerstvý kontext, sub-agent)
Adversariální průchod unhappy path registru, WS handleru, unie i REST guardů.
**Žádný kategorie-A (self-catchable) bug.** Ověřeno čtením + během (typecheck, testy).
Potvrzené seamy mimo řez (bez pádu, dokumentované):
- **B1 — busy po spárování:** když se A+B spárují a jeden odejde, odchozí se uvolní,
  ale **druhý zůstane busy** navázaný na mrtvé session id, dokud se sám neodpojí.
  Vědomě „busy-until-disconnect" (viz discuss); uvolnění soupeře při odchodu/konci
  partie dodá **todo 40**. Test to explicitně fixuje. Uživatelsky málo bolí, protože
  PvP se zatím nedá hrát (stuck hráč stejně jen reloadne → odpojí se → uvolní).
- **B2 — PvP herní WS je němý:** `/games/:id/ws` jde odebrat i pro PvP partii, ale
  nic se do ní nebroadcastuje (žádná mutace) → odběratel nedostane nic, žádný pád.
  Vlastní PvP dto/push přijde s hraním (todo 36).

## Křehké/otevřené (napsat do watch-out pro navazující fáze)
- **Session id je per-spojení** a po odpojení zaniká (stabilní identita/reconnection
  = todo 42). PvP partie se váže na id, která při dropu mizí → binding je do 42 křehký.
- **Autorita tahů (todo 36)** zatím neexistuje: PvP partie je jen substrát, hrát ji
  přes REST nejde (`pvp_not_playable`). Tah/konec/vzdání PvP = todo 36/40.
- **B1 výše** je hlavní funkční dluh, který todo 40 musí uzavřít.

## Ověření (mechanické)
- `pnpm -r test` → vše zelené; server 266 testů (25 souborů), z toho nové
  `challenges.test.ts` (17), `challenge-ws.test.ts` (6 reálných WS scénářů),
  `pvp-endpoints.test.ts` (6), rozšířený `store.test.ts` (createPvp + PvP throw).
- `pnpm typecheck` (celé monorepo) čisté, `pnpm lint` čisté.
- Regrese engine cest: všech 235 původních server testů + M3 brána enginu prošly
  beze změny (unie nerozbila člověk-vs-engine tok).

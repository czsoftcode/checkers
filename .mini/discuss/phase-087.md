# Phase 87 — LocalClient + Web Worker

## Intent
Prohlížečový `LocalClient`, který splní totéž rozhraní jako dnešní `ServerClient`
(`packages/web/src/server-client.ts`), ale hru proti AI odbaví CELOU v prohlížeči bez
běžícího serveru. Je to browserový port serverového game store + AI orchestrace
(`store.ts` + AI část `app.ts`) za týmž rozhraním. Tah AI počítá `@checkers/ai`
`computeAiMove` ve Web Workeru (mimo hlavní vlákno, ať ~1s search nezmrazí UI).
Mimo řez: přepnutí webového UI na `LocalClient` (fáze #49), offline build (#50), PvP, změna serveru.

Tři netriviální serverové cesty, které `LocalClient` reprodukuje:
- **offerDraw:** server = `engine.evaluate(position)` (fakticky `searchTimed(...).score`),
  skóre přepočte na POHLED ENGINU (`turn === engineColor ? score : -score`), přijme remízu
  když `engineScore <= 0` (`DRAW_ACCEPT_MAX_ENGINE_SCORE`, app.ts:103).
- **createGame:** u Mistrovství losuje ballot přes `mulberry32(seed)` → pozice s BÍLÝM na
  tahu + `ballotMoves` + `ballotIndex`; `humanColor` default černá; u člověk=bílý hned
  spustí první tah enginu. `ballotIndex` param přehraje konkrétní ballot (2. kolo Mistrovství).
- **thinking→idle:** `maybeTriggerEngine` nastaví `'thinking'` a fire-and-forget
  `void runEngineMove()`; ten dopočítá, aplikuje tah proti AKTUÁLNÍ pozici, nastaví `'idle'`.
  Controller to sbírá pollem à 250 ms (`getGame`).

## Key decisions
- **Worker je INJEKTOVATELNÝ za rozhraním; jádro „spočítej tah" je čistá funkce.** Vitest+jsdom
  NEMÁ Web Worker → jádro (volá `@checkers/ai` `computeAiMove`) je čistá funkce, worker jen
  tenký transport za rozhraním, které `LocalClient` dostane zvenčí (stejný vzor jako dnešní
  injektovatelný `GameWebSocket` / `fetchImpl`). Testy dosadí IN-PROCESS implementaci; reálný
  worker je tenký, ověří se ručně / v příští fázi.
- **Zub „stejný tah jako server" = `LocalClient` vrátí tah, který dá `computeAiMove` in-process**
  (na server tranzitivně přes kontraktní test fáze 86: `computeAiMove == handleLine`). Test
  injektuje PEVNÝ seed; v provozu `LocalClient` seeduje náhodně (`Math.random`/crypto — táž
  role jako serverový neseedovaný rng přes `Date.now()`).
- **offerDraw reprodukuje serverové primitivum:** `searchTimed(position).score` z pohledu
  enginu, přijmout když `<= 0`. Malý offline/online rozdíl skóre kvůli stropu 12 je v mezích
  už přijatého rozdílu síly.
- **getHint = `computeAiMove` PLNOU silou** (server: nápověda jede vždy naplno nezávisle na
  úrovni), BEZ nepozornosti, a SE stropem `maxDepth 12` jako offline silné úrovně (konzistence
  + nezávislost na zařízení). Stav partie nemění, jen radí.
- **Životní cyklus přes rules, ne vlastní pravidla.** Všechna PRAVIDLOVÁ rozhodnutí (konec hry,
  remízová terminace, legální tahy, důsledek tahu) z `@checkers/rules`; `LocalClient`
  reimplementuje JEN orchestraci (čí je tah, thinking model, `endReason`
  resign/draw-agreement/rules). Sdílet Node-ovský `store.ts` se nesnaží — DTO tvar
  (`GameDto`) zůstává ručně drženým kontraktem (jako dnes), rules brání drift v pravidlech.

## Watch out for
- **Strop `maxDepth 12`** se aplikuje na Profesionál/Mistrovství/Výuku (+ hint); Začátečník
  (d1) / Střední (d3) beze změny (jejich strop je nižší než 12, tj. bez efektu).
- **`chooseMove`/`carelessness` konvence** (z fáze 86): `rankRoot = carelessness > 0`,
  `carelessness` absent → 0. `computeAiMove` to už řeší; `LocalClient` jen předá správnou
  `Strength` podle úrovně (z `@checkers/ai` `STRENGTH_BY_LEVEL`) + strop 12 pro silné.
- **Async poll model musí sedět BIT PO BITU na dnešní controller** (poll à 250 ms, single-flight):
  `postMove` vrátí `GameDto` (může být hned `thinking`), na pozadí běží worker; `getGame`
  vrací aktuální stav; po doběhu workeru je tah enginu aplikován a `engineStatus='idle'`.
  Tah enginu se aplikuje proti AKTUÁLNÍ pozici (ne proti snímku z doby spuštění).
- **`ballotIndex` musí `LocalClient` vracet i přijímat** (2 kola Mistrovství: 1. kolo vylosuje,
  2. kolo přehraje týž ballot). Los offline seeduje náhodně.
- **`getHint` je optional na rozhraní** (`ServerClient`) — controller ji volá jen ve Výuce.
  `LocalClient` ji implementuje vždy (jako reálný HTTP klient).
- **Chybové cesty:** offerDraw/hint musí umět vrátit odpovídající chybu (konec hry, není tah
  člověka) tak, jak controller čeká `ServerError`-like `code`; jinak se UI zasekne / ukáže
  nápovědu tam, kde nemá.
- **Fáze je velká** (port celého lifecyclu) — plán bude mít víc kroků. Kdyby v `mini do`
  narostla, dělit na worker-jádro + politika síly vs. LocalClient lifecycle.
- **Mimo řez:** změna webového UI/přepnutí na `LocalClient` (#49), offline build (#50), PvP,
  jakákoliv změna serveru.

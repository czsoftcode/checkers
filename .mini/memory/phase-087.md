# Phase 87 — LocalClient + Web Worker

**Goal:** Vytvořit prohlížečový LocalClient, který plně splní rozhraní ServerClient (createGame vč. ballotu Mistrovství, getGame jako poll zachytávající tah enginu, postMove, resign, offerDraw, getHint) a reprodukuje serverový životní cyklus partie (humanColor, první tah enginu u člověk=bílý, model thinking→idle, konec s důvodem) čistě v prohlížeči bez běžícího serveru. Tah AI počítá přes @checkers/ai computeAiMove ve Web Workeru (mimo hlavní vlákno) s politikou úroveň→síla a stropem maxDepth 12 pro Profesionál/Mistrovství/Výuku (Začátečník d1/Střední d3 beze změny). Zub proti regresi: LocalClient dá pro danou pozici + seed + úroveň týž tah jako serverová cesta (mimo strop 12). NEZÁVISLÉ na běžícím serveru. Mimo řez: přepnutí webového UI na LocalClient (samostatná fáze #49), offline build, PvP, změna serveru.

## Steps
- [done] Politika síly + jádro výpočtu tahu
- [done] Worker transport za injektovatelným rozhraním
- [done] LocalClient: skeleton + createGame (+ballot)
- [done] postMove + trigger enginu + poll model thinking→idle
- [done] resign + offerDraw + endReason
- [done] getHint + chybové cesty
- [done] Regresní test: LocalClient == computeAiMove (pevný seed)

## Auto-commit
- Phase 87: LocalClient + Web Worker

## Discussion
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

## Run report
---
phase: 87
verdict: done
steps:
  - title: "Politika síly + jádro výpočtu tahu"
    status: done
  - title: "Worker transport za injektovatelným rozhraním"
    status: done
  - title: "LocalClient: skeleton + createGame (+ballot)"
    status: done
  - title: "postMove + trigger enginu + poll model thinking→idle"
    status: done
  - title: "resign + offerDraw + endReason"
    status: done
  - title: "getHint + chybové cesty"
    status: done
  - title: "Regresní test: LocalClient == computeAiMove (pevný seed)"
    status: done
verify:
  - title: "Reálný Web Worker za běhu (round-trip postMessage → tah)"
    detail: "jsdom nemá Web Worker, takže `createWebWorkerEngineWorker` + `engine-worker-entry.ts` jsou ověřené jen typecheckem a Vite buildem, ne za běhu. Testy jedou přes in-process fake. Runtime chování (bundling workeru, správné párování zpráv, ~1 s search mimo hlavní vlákno) se prokáže až při napojení UI (fáze #49). Doporučuju při #49 ručně odehrát partii ve všech úrovních + nápovědu Výuky a losování Mistrovství."
---

# Fáze 87 — report z auto session

## Co je hotové
Prohlížečový `LocalClient` (`packages/web/src/local-client.ts`) implementuje celé
rozhraní `ServerClient` čistě v prohlížeči, bez serveru. Nové soubory:
- `src/local/prng.ts` — mulberry32 (vědomá kopie, web nezávisí na server/cli).
- `src/local/compute-move.ts` — `strengthFor(level)` (offline strop 12 pro silné úrovně,
  Začátečník/Střední beze změny) + `computeEngineMove` (volá `@checkers/ai computeAiMove`).
- `src/local/engine-worker.ts` — rozhraní `EngineWorker`, in-process fake (testy) +
  reálný Web Worker (provoz), s párováním zpráv přes `id` a odmítnutím visících requestů při pádu.
- `src/local/engine-worker-entry.ts` + `engine-worker-protocol.ts` — tenký vstup workeru a sdílený drátový protokol.
- `src/local-client.ts` — orchestrace (createGame +ballot, postMove + trigger enginu,
  getGame, resign, offerDraw, getHint), pravidla přes `@checkers/rules`, tah AI přes worker.

Do `packages/web/package.json` přibyly závislosti `@checkers/ai` + `@checkers/engine`
(oba browser-safe, bez `node:` mimo engine `main.ts`, který se neimportuje).
Ze `server-client.ts` je nově exportovaný `isGameDto` — testy jím ověřují, že DTO z
LocalClientu projde TÝMŽ guardem, na kterém stojí HTTP cesta i controller.

Ověřeno mechanicky: typecheck (všech 6 balíčků), eslint, `vite build`, a celá testová
sada monorepa **1435 testů zelených** (web 549, z toho 30 nových lokálních).

## Věrnost serverové cestě (kontrakt)
- **offerDraw:** `searchTimed(position).score` přepočtený na pohled enginu
  (`turn===engineColor ? score : -score`), přijmout `<= 0` — bit po bitu jako app.ts.
- **resign:** výherce = `opposite(humanColor)` (obrácená barva správně).
- **createGame + první tah enginu:** člověk=bílý i Mistrovství (bílý na tahu po ballotu)
  spustí engine hned; model `thinking`→`idle`; odpověď nese `thinking` PŘED aplikací tahu enginu.
- **poll model:** `postMove` vrátí stav hned, tah enginu se aplikuje proti AKTUÁLNÍ
  pozici až po awaitu, guard je před prvním awaitem (nezasekne se v `thinking`).

## Zuby testů (ověřeno dočasným rozbitím)
- Změna nepozornosti v `strengthFor` → padne unit test `strengthFor` i regresní test.
- Použití knihy v nápovědě → padne test „nápověda NEpoužívá knihu".
- offerDraw: verdikt porovnán s NEZÁVISLE spočítaným prahem z primitiva; obě větve
  (přijetí i řízeně dosažené odmítnutí) reálně proběhnou.
- Chybová cesta tahu enginu (worker selže) → `engineStatus='error'`, partie žije.

## Nálezy nezávislého self-review (fresh-context sub-agent) a jak jsem je vyřešil
1. **[OPRAVENO] getHint používal knihu, serverová nápověda ne.** Server hint =
   `bestmove(position, undefined)` bez knihy; LocalClient v zahájení radil knižní tah
   (11→15) místo hledaného (9→13). Přidán `useBook:false` do hint cesty + zubatý test.
2. **[OPRAVENO] Špatný chybový kód** u `ballotIndex` mimo Mistrovství (`game_over` →
   `invalid_request`, jako server), test kontroluje kód i status.

## Vědomé kompromisy (neopravené, s odůvodněním)
- **offerDraw počítá `searchTimed` na HLAVNÍM vlákně** (worker rozhraní umí jen
  `computeMove`, jak stanovil plán fáze). Při nabídce remízy tak UI může na ~1 s zamrznout.
  Věrnost síly se serverem je zachovaná; jde o UX. Pokud to při #49 vadí, čistá cesta je
  přidat workeru `evaluate` (samostatná drobná fáze). Tah AI i nápověda běží mimo vlákno.
- **Regresní test nedosáhne hloubky, kde by strop 12 vázal** (fast-clock zastaví search
  na hloubce 1), takže rovnost „LocalClient == computeAiMove" ověřuje „mimo strop 12"
  přesně jak zadání chce; zuby pro hodnotu stropu drží unit test `strengthFor`. Server
  strop nemá, takže nad hloubkou 12 se cesty rozejít MAJÍ — to není chyba.
- **Bez tvrdého timeoutu na `worker.computeMove`** — konzistentní se serverem (ten na
  chybu enginu taky nemá extra retry); pád workeru řeší `onerror`/`dispose` odmítnutím pending.

## Poznámka k dalšímu
Napojení UI na LocalClient, offline build, PvP a jakákoli změna serveru jsou MIMO řez
(fáze #49/#50 a dál). Tato fáze je čistá logika + testy, bez UI wiringu.

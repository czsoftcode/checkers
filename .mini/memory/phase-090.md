# Phase 90 — Odstranit serverovou AI

**Goal:** Odstranit ze serveru MRTVOU AI cestu (web ji od fáze 88 nevolá, AI běží v prohlížeči): engine podproces (engine-client.ts) + jeho import v main.ts/index.ts; REST endpointy POST /games, POST /games/:id/moves, /resign, /offer-draw, GET /games/:id/hint; engine trigger a orchestraci v app.ts (maybeTriggerEngine, runEngineMove, engine.bestmove/evaluate, použití STRENGTH_BY_LEVEL a knihy); engine GameRecord (level/ballot/humanColor/engineStatus). ZACHOVAT BEZE ZMĚNY celý PvP: /room/ws, store.createPvp, sdílené GET /games/:id a /games/:id/ws (PvP snapshot+push), PvP tahy/vzdání/remíza po room WS. PDN archiv NEMAZAT — modul zůstává (dnes ho volal jen konec AI partie, takže dočasně BEZ volajícího), protože se má napojit na PvP (samostatná položka backlogu, uživatelův původní cíl). Smazat odpovídající serverové AI testy; PvP testy + kontraktní test fáze 86 (in-process v @checkers/ai) zůstávají zelené. PRVNÍ KROK fáze: ověřit, že produkční web serverovou AI už nevolá (grep webu na /games AI volání + potvrzení nasazení 88+), teprve pak mazat. Po odstranění engine-client zvážit, jestli server ještě přímo potřebuje @checkers/engine.

## Steps
- [done] Ověřit, že web nemá volající serverové AI
- [done] Odstranit listové AI endpointy /hint + /offer-draw
- [done] Odstranit AI herní endpointy POST /games, /moves, /resign + engine trigger
- [done] Odstranit engine-client + drátování enginu
- [done] Uklidit @checkers/engine dep + ověřit PvP e2e

## Auto-commit
- Phase 90: Odstranit serverovou AI

## Discussion
# Phase 90 — Odstranit serverovou AI

## Intent
Odstranit ze serveru MRTVOU AI cestu (web ji od fáze 88 nevolá, AI běží v prohlížeči).
Fáze je ROZDĚLENÁ (rozhodnutí uživatele) — tahle fáze 90 = JEN ČÁST A:
- app.ts: HTTP AI endpointy (POST /games, POST /games/:id/moves, /resign, /offer-draw,
  GET /games/:id/hint) + engine trigger (maybeTriggerEngine, runEngineMove, engine.bestmove/
  evaluate) + použití STRENGTH_BY_LEVEL a knihy v AI orchestraci.
- engine-client.ts (spawn podprocesu) + jeho import/re-export v main.ts a index.ts.
- main.ts: spuštění enginu (new EngineClient), warmup, shutdown enginu.
- buildApp: vypadne parametr `engine` (parametr `pdnDir` ZŮSTÁVÁ).
- Smazat odpovídající serverové AI HTTP testy.

ČÁST B (úklid store/dto union) → SAMOSTATNÁ položka backlogu, čistý interní refactor bez
změny chování: sesypat `GameRecord` union (odstranit `EngineGameRecord`, `store.create`,
AI `gameToDto`), zjednodušit `toRecord` overloady. Nedělá se v této fázi.

## Key decisions
- **BLOCKER — fáze 90 se NESMÍ začít, dokud `dama.softcode.cz` neběží na fázi 88+.** Hlavní web
  dnes běží PRAPŮVODNÍ verze se SERVEROVOU AI (uživatel novou ještě nenasadil). Kdyby se AI
  endpointy smazaly teď, useknulo by to AI všem na hlavním webu. Pořadí: (1) nasadit itch/main
  větev na dama.softcode.cz přes scripts/deploy.sh (výchozí build = plná appka + LOKÁLNÍ AI,
  base=/, NE --mode itch), (2) ověřit v Network tabu, že hra proti AI NEvolá /games, (3) TEPRVE
  PAK mazat. Ověření deploye = PRVNÍ krok plánu.
- **Split (rozhodnutí uživatele):** fáze 90 = jen část A (server přestane počítat AI); část B
  (sesypání store/dto union) je samostatná položka backlogu. Ať mezi fázemi nezůstane mrtvý
  `EngineGameRecord` — proto část B následuje hned, ale odděleně.
- **Store cleanup depth:** až v části B PLNÉ sesypání union (ne nechávat mrtvé engine typy).
- **buildApp:** vypadne `engine`, `pdnDir` ZŮSTÁVÁ (PDN modul se drží pro budoucí PvP-archiv).
- **PDN archiv NEMAZAT** — modul zůstane bez volajícího (jediný volající byl konec AI partie);
  napojení na PvP je samostatná backlog položka (uživatelův zapomenutý cíl, viz [PvP→PDN]).

## Watch out for
- **PvP je v TÉMŽE app.ts (1456 ř.) i ve store union** — hlavní riziko = regrese multiplayeru.
  ZACHOVAT beze změny: /room/ws, store.createPvp, sdílené GET /games/:id a /games/:id/ws
  (PvP snapshot+push přes dtoFor), PvP tahy/vzdání/remíza po room WS. PvP testy = zub, musí
  zůstat zelené po každém řezu.
- **`engineStatus` je ve SDÍLENÉ `GameRecordBase`** (nese ho i PvP record) — v části A ho
  neodstraňovat, patří do části B (a i tam opatrně, PvP ho může číst jako 'idle').
- **Pořadí řezů pro green-at-each-step:** listové endpointy (/hint, /offer-draw) → engine
  trigger v /moves a POST /games → engine-client + main.ts wiring + buildApp engine param →
  smazat AI HTTP testy. Po každém kroku build + PvP testy zelené.
- **@checkers/engine serverová závislost:** po odstranění engine-client zkontrolovat, jestli
  server ještě přímo importuje @checkers/engine (nejspíš už ne — engine-client byl jediný
  konzument); pokud ne, zvážit odebrání dep. @checkers/ai (které na engine závisí) a kontraktní
  test fáze 86 zůstávají netknuté.
- **deploy.sh staví DEFAULT build** (`vite build --base=/`, bez --mode itch) = plná appka +
  lokální AI. To je správně pro hlavní web; itch AI-only varianta se dělá jen přes build-itch.
- **Mimo řez:** část B (store/dto union), PvP→PDN archiv, jakákoliv změna PvP chování.

## Run report
---
phase: 90
verdict: done
steps:
  - title: "Ověřit, že web nemá volající serverové AI"
    status: done
  - title: "Odstranit listové AI endpointy /hint + /offer-draw"
    status: done
  - title: "Odstranit AI herní endpointy POST /games, /moves, /resign + engine trigger"
    status: done
  - title: "Odstranit engine-client + drátování enginu"
    status: done
  - title: "Uklidit @checkers/engine dep + ověřit PvP e2e"
    status: done
---

# Fáze 90 — report z auto session

## Co se povedlo
Serverová AI cesta je pryč, PvP zůstal netknutý a celá sada je zelená.

**Odstraněno ze serveru:**
- `app.ts`: REST endpointy `POST /games`, `POST /games/:id/moves`, `POST /games/:id/resign`,
  `POST /games/:id/offer-draw`, `GET /games/:id/hint`. Engine orchestrace: `maybeTriggerEngine`,
  `runEngineMove`, `maybeArchive`, helpery `rejectPvp`, `engineColorOf`, konstanta
  `DRAW_ACCEPT_MAX_ENGINE_SCORE`, schema `createGameBodySchema`. Z `BuildAppOptions` vypadl
  `engine` a `openingBook`.
- `engine-client.ts` (spawn podprocesu) + jeho re-export v `index.ts`.
- `main.ts` přepsán: bez `EngineClient`, warmup a `engine.close`; drží se jen HTTP listen +
  graceful shutdown.
- Z `packages/server/package.json` odebrán přímý dep `@checkers/engine` (server ho po smazání
  engine-clientu přímo neimportuje; přes `@checkers/ai` teče tranzitivně, typecheck prochází).

**Zachováno (hlavní riziko = regrese PvP):** `/room/ws`, `store.createPvp`, sdílené
`GET /games/:id` a `/games/:id/ws` (PvP snapshot+push), PvP tahy/vzdání/remíza/odveta po room WS.
Sdílené jádro `tryApplyMove`, `moveBodySchema`, `broadcast`, `dtoFor` (vč. engine větve pro
`GET /games/:id`) zůstala. PDN modul (`archive.ts`) zůstává dle rozhodnutí bez volajícího.

**Testy:** smazány serverové AI testy (api, archive, engine-move, gate, hint, human-color,
offer-draw, opening-book-integration, resign, ws, engine-client) + fixture `fake-engine.mjs`.
PvP testy upraveny tam, kde stavěly engine partii přes `POST /games` (teď `gameStore().create()`)
nebo předávaly `openingBook` (teď `buildApp()`): `pvp-endpoints` (ořezán na čtení + 404),
`pvp-move-ws`, `pvp-resign-draw-ws`, `room-ws`, `challenge-ws`. Zuby guard-testů drží — asertují
konkrétní hlášku guardu `record.mode !== 'pvp'`, kterou by odstranění guardu neprošlo ani
typecheckem.

## Co jsem ověřil (mechanicky, sám)
- `pnpm -r typecheck` a `pnpm lint` — čisté.
- `pnpm -r test` — vše zelené: **server 183**, **@checkers/ai 54** (kontraktní test fáze 86
  netknutý), web 563, rules 266, engine 250, cli 24.
- Živý server (bez enginu) přes `main.ts`: naběhne, odstraněné endpointy vrací **404**,
  `GET /games/:id` funguje (správná obálka `game_not_found`).
- **PvP e2e proti živému serveru** (WS skript, dva klienti): párování → přijetí → černý zahraje
  9→13 → soupeř dostal push, `turn` se přehodil na `white`, žádná chyba.
- **Graceful SIGTERM**: reálný node listener vypíše „vypínám server…", `app.close()` doběhne
  (WS klienti zavřeni přes `@fastify/websocket` `preClose`), port se uvolní. Nová chybová větev
  (`catch → process.exit(1)`) je zlepšení proti starému kódu (ten chybu spolkl a končil exit 0).
- Napříč repem nikdo neimportuje odstraněné serverové symboly (`EngineMover`, `EngineClient`,
  `Strength`…); web bere `Strength` přímo z `@checkers/engine` (vlastní dep), takže je nezávislý.

## Nález navíc (nezávislý adversarial sub-agent)
Sub-agent (čerstvý kontext) našel jednu reálnou tichou hnilobu, kterou strojová kontrola míjela:
`packages/server/scripts/curl-gate.sh` („Brána fáze 18") volala odstraněné `POST /games` a
`/moves`, ale není v `pnpm -r test` ani v CI, takže „vše zelené" ji neprověřilo. Byl to čistě
serverový AI/manuální herní gate postavený na zrušených endpointech → **smazán** (a opraven odkaz
na „curl bránu" v komentáři `main.ts`). Bez commitu by ji spustil člověk a selhala by na první
aserci.

## Poznámky / co zůstává na část B (mimo řez této fáze)
- `store.ts` má nyní engine metody (`resign`, `offerDraw`, `acceptDraw`, `hint`) bez volajícího a
  komentáře typu „route odmítne dřív (pvp_not_playable)" jsou po odstranění routes zavádějící.
  To je přesně náplň **části B** (sesypání store/dto union), která je dle
  `.mini/discuss/phase-090.md` samostatná backlog položka a v této fázi se úmyslně nedělá.
  `ERROR_CODES.pvpNotPlayable` je taky nově mrtvý (→ část B).
- `pdnDir` je v `buildApp` přijímaný, ale nečtený (PDN modul bez volajícího). Je to **vědomé
  rozhodnutí fáze** („buildApp: vypadne engine, pdnDir ZŮSTÁVÁ pro budoucí PvP-archiv"), ne dluh
  z nedbalosti — napojení PDN na PvP je samostatná backlog položka.

Žádný blocker, verdikt **done**.

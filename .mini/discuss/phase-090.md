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

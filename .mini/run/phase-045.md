---
phase: 45
verdict: done
steps:
  - title: "Server: úroveň Výuka (plná síla) + test"
    status: done
  - title: "Web kontrakt: getHint + GAME_LEVELS + popisek"
    status: done
  - title: "board-view: kanál zvýraznění nápovědy"
    status: done
  - title: "controller: životní cyklus nápovědy (auto, single-flight)"
    status: done
  - title: "Testy controlleru se zuby"
    status: done
  - title: "Verifikace: testy, lint, typecheck, ruční e2e"
    status: done
---

# Phase 45 — report z auto session

## Co je hotové
Výuka jako čtvrtá úroveň, end-to-end:
- **Server** (`levels.ts`): `education` → `STRENGTH_BY_LEVEL undefined` (soupeř plnou
  silou jako Profesionál; rozdíl Výuky je jen klientský). Reálně ověřeno curl-em na
  čerstvém serveru: `POST /games {level:education}` → 201, `GET /hint` → 200 s tahem.
- **Web kontrakt** (`server-client.ts`): `education` v `GAME_LEVELS`, volitelná metoda
  `getHint` + `parseHint`/`isMoveDto` (ověření tvaru), popisek „Výuka" v `app-shell.ts`.
- **board-view**: nové pole `RenderState.hint = { from, to }`, třídy `hint-from`
  (přerušovaný modrý rámeček) a `hint-to` (modrý prstenec), CSS proměnná `--hint`.
- **controller**: ve Výuce se na tahu člověka přes single-flight `runRequest` načte
  nápověda a zvýrazní. `tickLoop` (poll → hint) brání zanoření `runRequest`;
  `hintRequested` brání opakovanému fetchi každým pollem; hint se zahodí při odeslání
  tahu, změně tahu, konci partie i dispose; chyba `/hint` degraduje bez zaseknutí.

Testy: web 196 (+ nové `controller-hint.test.ts`, hint testy v `board-view`/`server-client`),
server 113. Lint + typecheck napříč repem čisté.

## Nález ze self-review (opraveno v rámci fáze)
Před reportem jsem pustil nezávislého sub-agenta (čerstvý kontext) na souběh a kontrakty.
Našel **reálný bug**: nápověda **zůstala svítit na skončené partii** po vzdání / přijaté
remíze ve Výuce. `maybeRequestHint` gate-oval fetch na `lastResult==='ongoing'`, ale
`currentHint()` (rozhoduje o VYKRESLENÍ) `lastResult` nekontroloval, a reset v
`applyServerState` běží jen při ZMĚNĚ TAHU – jenže vzdání/remíza mění výsledek beze
změny tahu (strana zůstává černá). Scénář: ve Výuce svítí rada, člověk klikne Vzdát →
deska skončí, ale rada dál svítí.

Oprava: do `currentHint()` přidán guard `lastResult !== 'ongoing'` (jediné místo, kde se
o zobrazení rozhoduje → pokryje i budoucí terminální cesty). Přidán regresní test
„vzdání ve Výuce nápovědu zhasne" – ověřeno, že má zuby (bez guardu padne).

Druhý (menší) nález: test odeslání tahu neměl plné zuby – reset v `submitMove` maskoval
reset při změně tahu, takže test procházel i s rozbitým `submitMove`. Přidán SYNCHRONNÍ
assert hned po kliknutí (před odpovědí serveru) → nyní chytí i regresi v `submitMove`
(ověřeno breaknutím). Ostatní souběhové body sub-agent potvrdil jako ošetřené
(zanoření runRequest, guard po awaitu, degradace chyby, čekání resign/remízy na inflight).

## Reálné rozhodnutí k zápisu (ADR)
`getHint` jsem dal na `ServerClient` jako **volitelnou** (property s arrow-typem), ne
povinnou metodu. Zvážená a zamítnutá alternativa: povinná metoda by vynutila stub ve
~24 fake klientech napříč 7 testy (režimy bez nápovědy) – to je ceremonie navíc. Volitelná
+ gate na `education` v controlleru + jediný reálný klient (`createHttpClient`) ji vždy
implementuje (kryje test). Property-arrow místo metody i kvůli `unbound-method` lintu
(controller si ji ukládá do lokálu kvůli zúžení optional). → zvaž `/mini:decision` před
`/mini:done`, ať je „proč" zaznamenané.

## Vizuál a tok ověřeny uživatelem
Prohlížečový e2e jsem sám nespustil (Vite proxy míří natvrdo na port 3000 s uživatelovým
běžícím dev stackem, cizí procesy jsem nezabíjel). Funkční řetězec je pokrytý testy
s reálným controllerem/board-view + server curl. Vizuál nápovědy, pocit z ~1,6s pauzy
a celý tok Výuky v prohlížeči OVĚŘIL uživatel (2026-07-06) → verify body vyřešeny.

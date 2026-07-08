---
phase: 66
verdict: done
steps:
  - title: "Hub spojení (čistý modul) + závislost"
    status: done
  - title: "WS endpoint GET /games/:id/ws"
    status: done
  - title: "Broadcast po změnách stavu"
    status: done
  - title: "Integrační test: dva WS klienti na jedné partii"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Phase 66 — report z auto session

## Co je hotové
Serverová WebSocket transportní páteř pro V3. Server při každé změně partie
pushne aktuální stav odběratelům dané partie a nikomu jinému.

- **`packages/server/src/hub.ts`** (nový) — `GameHub`: mapa `gameId → Set<socket>`
  se `subscribe`/`unsubscribe`/`broadcast`/`subscriberCount`. Broadcast posílá
  jen do OTEVŘENÝCH socketů (`readyState === 1`) a každý `send` obalí try/catch,
  takže vadný socket neshodí ostatní ani volajícího. Prázdnou místnost uklidí.
- **`packages/server/src/dto.ts`** — nový typ `GameStateMessage`
  `{ type: 'game-state', game: GameDto }`: sdílený drátový kontrakt (server ho
  staví typovaně, test parsuje týž typ; literál `'game-state'` nemůže driftnout
  bez TS chyby). Diskriminátor `type` nechává místo pro pozdější V3 zprávy.
- **`packages/server/src/app.ts`** — registrace `@fastify/websocket` a endpointu
  `GET /games/:id/ws` (v callback-plugin formě s `done()`, aby onRoute pořadí
  sedlo; async bez await lint neprošel). Helper `broadcast(record)` volaný po
  lidském tahu (`/moves`), tahu enginu, vzdání i přijaté remíze a na error/idle
  přechodech v `runEngineMove` — odběratel tak nevisí na `thinking`. `close`
  odhlásí socket; neznámá `:id` = čisté zavření bez registrace. Hub vystaven
  přes `app.decorate('gameHub', …)` čistě pro diagnostiku/test (ne HTTP kontrakt).
- **Testy:** `test/hub.test.ts` (7, unit s fake sockety — izolace, guard
  readyState, vadný send, unsubscribe) + `test/ws.test.ts` (8, integračně přes
  reálný `ws` klient a `app.listen`). Registrace odběru se čeká deterministicky
  přes `subscriberCount` (žádný arbitrární sleep).

## Ověření (mechanicky, sám)
- Celý workspace: lint 0 chyb, typecheck 0 chyb, testy 1000 zelených
  (server 216, z toho 15 nových WS testů).
- **Zuby ověřeny reálně:** po dočasném vypnutí `/moves` broadcastu spadly 3 WS
  testy (dva odběratelé, izolace, tah enginu) — pak obnoveno. Push stavu `error`
  má vlastní test (stub engine, který spadne) — ověřuje, že odběratel dostane
  `error`, ne zamrzlé `thinking`.
- Push jde JEN účastníkům partie (test „odběratel jiné partie nedostane nic").

## Nezávislý self-review (sub-agent, čerstvý kontext)
Bez blokujícího či self-catchable nálezu. Potvrdil reordering v `runEngineMove`
(`afterEngine` nese tah i status `idle`), `WS_OPEN = 1` proti `ws@8.21.0`,
sdílený kontrakt zprávy i zuby testů. Na jeho doporučení jsem doplnil test
pushe stavu `error` (nález č. 5). Zbylé nálezy jsou vědomě mimo rozsah / kosmetika
(viz níže).

## Vědomě mimo rozsah (známá omezení, ne bugy)
- **Web klient se nemění** — dál polluje; push je aditivní. Konzumace pushe
  v prohlížeči (příjem + překreslení desky) je samostatná pozdější fáze.
- **Snapshot při subscribe se neposílá** — odběratel dostane jen BUDOUCÍ změny.
  Pro fázi 66 neškodí (polling je záchranná síť); jakmile vznikne čistě
  push-klient bez pollingu, bude potřeba na `open` poslat aktuální stav.
- **Úklid zombie spojení a limity zpráv** — mimo tento řez (todo 45). Úklid
  stojí na `close` handleru; `ws` po erroru `close` emituje, ale idle-timeout
  tu není.
- **Kosmetika:** `POST /games` nebroadcastuje (v čase založení nikdo neodebírá);
  teoretický dvojitý push (`idle` + `error`), jen kdyby `formatGamePdn` měl bug
  a hodil — vyžaduje latentní programovou chybu, kterou má projekt hlásit hlasitě.

## Pozn. k dalšímu kroku
Vznikl jeden reálný rozcestník hodný ADR: **tvar zprávy jako obálka s `type`**
vs. holý `GameDto`, a **adresace `/games/:id/ws`** (cesta per partie) vs. jeden
multiplexovaný socket. Obě volby jsou vědomě přechodné (lobby fáze je nejspíš
změní). Zvaž `/mini:decision` před `/mini:done`, ať je „proč obálka a proč
per-partie socket" zaznamenané pro navazující V3 fáze.

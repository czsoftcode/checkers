# Phase 66 — WebSocket: push stavu partie

**Goal:** Přidat @fastify/websocket a WS endpoint pro odběr konkrétní partie; když se na tu partii aplikuje tah (přes stávající REST cestu), server rozešle nový stav všem spojením přihlášeným k té partii — ověřeno testem se dvěma WS klienty na jedné partii. Úklid odpojených spojení a limity zpráv se v tomto řezu neřeší.

## Steps
- [done] Hub spojení (čistý modul) + závislost
- [done] WS endpoint GET /games/:id/ws
- [done] Broadcast po změnách stavu
- [done] Integrační test: dva WS klienti na jedné partii
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 66: WebSocket: push stavu partie

## Discussion
# Phase 66 — WebSocket: push stavu partie

## Intent
Přidat na server WebSocket transportní páteř pro V3: odběratelé jedné partie
dostanou push nového stavu, kdykoli se ta partie změní. První ověřitelný řez
todo 35 — jen serverová strana + integrační test se dvěma WS klienty na jedné
partii. Skutečná konzumace pushe ve webovém klientovi (příjem + překreslení
desky) je AŽ pozdější fáze; web klient se v této fázi NEMĚNÍ a dál polluje.

Dnešní stav: čistě REST, klient pollingem přes `engineStatus` v `GameDto`
zjišťuje tah enginu. Push tenhle polling časem nahradí; v této fázi je push
aditivní (polling zůstává funkční záchranná síť).

## Key decisions
- **Tvar zprávy = obálka s typem:** `{ type: 'game-state', game: GameDto }`.
  Diskriminátor `type` je kontrakt pro celé V3 — nechá místo pro pozdější zprávy
  (presence/místnost, výzvy) bez rozbití. `game` je existující `GameDto` (znovu
  použít `dtoFor(record)` z app.ts, žádný nový tvar stavu).
- **Adresace = cesta per partie:** WS endpoint `GET /games/:id/ws`, jedno
  spojení = jedna partie, id v cestě (sedí ke stávajícím `/games/:id/...`).
  Vědomě PŘECHODNÉ: lobby fáze to nejspíš nahradí jedním multiplexovaným
  socketem (jeden hráč, víc partií). Odběr je daný připojením — klient přes WS
  NIC neposílá; zápisová cesta (tahy) zůstává REST.
- **Broadcast po všech změnách stavu:** lidský tah (`POST /moves`), tah enginu
  (`maybeTriggerEngine`), `resign`, `offer-draw` — všude, kde už dnes vzniká
  DTO. Push tím nahrazuje polling enginu = reálná hodnota transportu.
- **Centralizovat do jednoho helperu** `broadcast(record)`, který postaví
  obálku přes `dtoFor(record)` a rozešle ji setu spojení; volat ho na každém
  mutačním místě. Neduplikovat serializaci.
- **Registr spojení mimo GameStore:** nový malý modul (např. `hub.ts`),
  `Map<gameId, Set<socket>>` s add/remove/broadcast. Transport je jiná starost
  než herní stav; GameStore zůstává čistý. Instancovat v `buildApp`, předat
  routám i `maybeTriggerEngine`.
- **`@fastify/websocket`** je nová závislost (přidat do packages/server).
  Aktuální API (`fastify.get(path, { websocket: true }, handler)`, tvar
  connection objektu) ověřit přes Context7 při plan/do — nepsat od stolu.

## Watch out for
- **Základní `close` → odeber socket ze setu je POVINNÝ**, i když goal vylučuje
  „úklid". Vyloučený je sofistikovaný úklid (idle timeouty, zombie, todo 45).
  Bez remove-on-close broadcast při prvním odpojení posílá do mrtvého socketu
  a spadne. Broadcast navíc guardovat na `readyState` (OPEN) — souběh mezi
  close eventem a broadcastem.
- **Broadcast nesmí shodit mutační cestu:** pošli do každého socketu v
  try/catch (nebo přes guard), aby jeden vadný socket neshodil odeslání ostatním
  ani nerozbil REST odpověď / tah enginu. Broadcast je fire-and-forget vedlejší
  efekt, ne kritická cesta.
- **Neznámé `:id` při připojení:** WS na neexistující partii — čistě zavřít /
  nezaregistrovat, ne spadnout.
- **Engine `error` stav bez tahu:** `maybeTriggerEngine` při chybě enginu jen
  přepne `engineStatus` na `error` BEZ applyMove — není tam přirozený broadcast
  bod. Bez pushe by odběratel viděl `thinking`, dokud nepolluje. Zvážit push i
  na tomto přechodu (levné, stejný helper); polling ho jinak dořeší (klient se
  v této fázi nemění).
- **Test potřebuje reálný socket:** `app.inject` neumí WS. Test musí
  `app.listen({ port: 0 })`, vzít port a připojit reálného WS klienta
  (knihovna `ws`, nejspíš už tranzitivně přes @fastify/websocket). Zuby testu:
  dva klienti na téže partii, po tahu OBA dostanou `game-state` obálku se
  správným novým stavem; klient jiné partie NIC nedostane (izolace dvojice).
- **Registrace pluginu:** `buildApp` vrací instanci bez `listen` (testuje se
  jinde přes inject). WS plugin zaregistrovat v `buildApp` PŘED routami, které
  ho používají.

## Run report
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

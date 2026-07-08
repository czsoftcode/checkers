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

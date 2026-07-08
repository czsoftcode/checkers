# Phase 67 — Místnost: přítomnost přes WebSocket

## Intent
Přidat druhou, GLOBÁLNÍ real-time vrstvu vedle dnešní per-partie (`hub.ts` = `gameId → sockety`). Hráč se připojí pod přezdívkou → server ho zapíše do JEDNÉ společné místnosti, hned mu pošle seznam přítomných, ostatním rozešle příchod; při odpojení rozešle odchod. Serverová páteř přítomnosti — základ, na který se pak navěsí párování (todo 38) a autorita tahu (todo 36).

Řez je ČISTĚ SERVEROVÝ, ověřený dvěma reálnými WS klienty (stejný přístup jako fáze 66, `app.listen({port:0})` + knihovna `ws`). Bez klienta, bez obrazovky.

## Key decisions
- **Nový modul přítomnosti** (např. `presence.ts` / `RoomHub`), NE rozšíření `GameHub`. Jiný tvar dat (jedna globální množina hráčů vs. mapa per-partie); míchat by je zašpinilo. Znovupoužít lze jen vzor (readyState guard, try/catch per socket, leave-on-close).
- **Vstup přes WS, přezdívka v PRVNÍ zprávě** `{type:"join", nick:"..."}`, NE v query parametru URL (query se sype do logů, hůř se rozšiřuje).
- **Server přidělí skryté session `id`** = autoritní klíč hráče. Přezdívka je jen jmenovka. Připraví párování (todo 38: klik na hráče = na id) i reconnection (todo 42).
- **Unikátní přezdívka, ale s lidskou cestou ven:** duplicita se NEzavře natvrdo — server pošle `{type:"nick-taken", suggestion:"Honza_1"}`, spojení zůstane OTEVŘENÉ, hráč pošle nový `join`. Do rosteru se dostane až po úspěšném join.
  - Porovnání **case-insensitive** (`honza` == `Honza`), ale ukládá/zobrazuje se, jak to hráč napsal.
  - Návrh = **nejnižší volný suffix** `_1`, `_2`… (i `Honza_1` může být zabraný → `Honza_2`).
- **Validace přezdívky:** prázdná / jen mezery → odmítnout; délku omezit (návrh 1–24 znaků po trimu). Server nesmí do rosteru pustit prázdno ani neomezeně dlouhý řetězec.
- **Drátový tvar (návrh):**
  - novému: `{type:"roster", players:[{id,nick},…]}` (včetně sebe)
  - ostatním: `{type:"joined", player:{id,nick}}`
  - při odchodu: `{type:"left", player:{id}}`
  - chyby: `{type:"nick-taken", suggestion}`, `{type:"error", …}` pro prázdnou/dlouhou přezdívku
- **Endpoint** `/room/ws` (jedna místnost).

## Watch out for
- **Pořadí při připojení:** nejdřív přidat do množiny, pak poslat `roster` (vč. sebe) JEN novému, teprve pak `joined` VŠEM KROMĚ něj — jinak dostane vlastní příchod dvakrát.
- **`left` jen když se socket opravdu připojil** — spojení, které nikdy neposlalo platný `join` (nebo dostalo `nick-taken` a nezkusilo znovu), při `close` NIC nerozesílá a v rosteru není.
- **Leave-on-close je POVINNÝ** (jako u `hub.ts`) — bez něj roster i broadcasty rostou o mrtvá spojení. Sofistikovaný úklid (idle/zombie, limity zpráv) je VĚDOMĚ mimo řez = todo 45.
- **Broadcast fire-and-forget:** posílat po jednom, v try/catch, jen do OTEVŘENÝCH socketů (readyState === OPEN). Jeden vadný socket nesmí shodit ostatní.
- **Druhý `join` na už připojeném socketu** → odmítnout (`error`, „už jsi v místnosti"); přejmenování NENÍ v tomto řezu.
- **Zprávy před join / nevalidní JSON / neznámý `type`** → nespadnout; ignorovat nebo poslat `error`, socket držet.
- **Izolace od herní WS:** odběratel `/games/:id/ws` nesmí dostat nic z místnosti a naopak (oddělené huby/endpointy) — lehce ověřit v testu.
- **Registrace WS pluginu** `@fastify/websocket` je už v `buildApp` (fáze 66); nová route se jen přidá, plugin neregistrovat podruhé.
- **Stav volný/hraje NENÍ v rosteru** — naplní se až s párováním (todo 38). Teď roster nese jen `{id, nick}`, aby nenesl fiktivní hodnotu.

## Test teeth (co má test dokázat)
- Dva klienti různých přezdívek: B po join vidí A v rosteru; A dostane `joined(B)`. Po zavření A dostane B `left(A)`.
- Duplicita: B s přezdívkou A → `nick-taken` se `suggestion`, B NENÍ v rosteru, A NEdostane nic.
- Prázdná / příliš dlouhá přezdívka → `error`, do rosteru se nedostane.
- (lehce) izolace: odběratel herní WS z fáze 66 nedostane zprávy místnosti.

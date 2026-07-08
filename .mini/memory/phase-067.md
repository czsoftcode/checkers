# Phase 67 — Místnost: přítomnost přes WebSocket

**Goal:** Server drží jednu společnou místnost přítomných hráčů se vstupem pod přezdívkou přes WS; nově příchozí dostane aktuální seznam přítomných, ostatní real-time zprávu o příchodu i o odchodu — ověřeno testem se dvěma reálnými WS klienty. Klientská obrazovka místnosti, stav volný/hraje (až s párováním, todo 38), stabilní identita/reconnection (todo 42) a úklid zombie/limity (todo 45) jsou mimo tento řez.

## Steps
- [done] Presence modul: registr přítomných hráčů
- [done] WS route /room/ws: lifecycle spojení
- [done] Integrační test: dva reální WS klienti
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 67: Místnost: přítomnost přes WebSocket

## Discussion
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

## Run report
---
phase: 67
verdict: done
steps:
  - title: "Presence modul: registr přítomných hráčů"
    status: done
  - title: "WS route /room/ws: lifecycle spojení"
    status: done
  - title: "Integrační test: dva reální WS klienti"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Phase 67 — report z auto session

## Co je hotové
Serverová vrstva „místnost přítomnosti" přes WebSocket. Klient se připojí na
`GET /room/ws`, pošle `{type:"join", nick}`; server přidělí skryté session `id`,
zapíše hráče do jedné globální místnosti a pošle mu `roster` (vč. sebe),
ostatním `joined`. Odpojení → `left` všem zbylým. Duplicitní přezdívka
(case-insensitive) → `nick-taken` s návrhem volné varianty (`_1`, `_2`, …),
spojení zůstává otevřené. Prázdná / >24 znaků → `error`. Dvojí join na témž
socketu → `error`.

- Nový čistý modul `packages/server/src/presence.ts` (`RoomPresence` + drátové
  typy zpráv + `NICK_MAX_LENGTH`). Oddělený od per-partie `GameHub`.
- WS route `/room/ws` uvnitř stávajícího WS pluginu v `app.ts` (plugin z fáze 66
  se neregistruje podruhé). Presence instance dekorovaná jako `roomPresence`
  (diagnostika pro test).
- Exporty v `index.ts`.
- Unit test `test/presence.test.ts` (13 testů, fake sockety) + integrační
  `test/room-ws.test.ts` (6 testů, reální WS klienti).
- Záznam v CHANGELOG.md pod `[Unreleased]`.

## Ověření (mechanicky, mnou)
- `tsc --noEmit` čistý, `pnpm lint` (eslint) exit 0.
- Celá serverová sada: 22 souborů, 235 testů zelených.
- Zuby: nový regresní test (`null`/primitivní JSON → error) jsem ověřil tak, že
  jsem dočasně odstranil guard → test padl; po obnovení prošel.

## Nález ze self-review (nezávislý sub-agent, čerstvý kontext) — OPRAVENO
Sub-agent našel jeden reálný self-catchable pád: `JSON.parse('null')` je platný
JSON a vrátí `null` (nechytne se na catch kolem parse), a čtení `.type` na `null`
by hodilo `TypeError` MIMO try → shodilo by message handler (a porušilo kontrakt
„nevalidní zpráva → error, socket žije"). Ověřeno reálně přes Node. Opraveno
tvarovou kontrolou (`typeof === 'object' && !== null && !Array.isArray`) PŘED
přístupem k `.type`; doplněn regresní test (`null` i `42`). Zbytek fáze prošel
review bez nálezu (pořadí zpráv, readyState guard, kontrakt konstanty,
`suggestFreeNick` bez zacyklení/přetečení, izolace od herní WS, žádný leak).

## Vědomě mimo řez (dle projektu / diskuse)
- Klientská obrazovka místnosti (další fáze) — tenhle řez je čistě serverový.
- Stav volný/hraje — naplní párování (todo 38); roster teď nese jen `{id,nick}`.
- Stabilní identita / reconnection (todo 42): hráč je vázaný na spojení
  (zavření = odchod).
- Úklid nečinných/zombie spojení, limity velikosti/frekvence zpráv (todo 45).

## Rozhodnutí k zaznamenání
Žádné zásadní křižovatky, které by nebyly zřejmé z kódu — ADR (`/mini:decision`)
podle mě není potřeba. (Volba „unikátní přezdívka s návrhem místo tvrdého
odmítnutí" i „přezdívka = jmenovka, autoritní klíč = session id" jsou už
zapsané v poznámkách z diskuse.)

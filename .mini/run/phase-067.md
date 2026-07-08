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

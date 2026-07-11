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

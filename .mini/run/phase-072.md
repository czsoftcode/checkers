---
phase: 72
verdict: done
steps:
  - title: "room-client: metoda move + unit testy"
    status: done
  - title: "Lobby → herní most (odeslání tahu + chyby tahu)"
    status: done
  - title: "Herní WS klient stavu partie"
    status: done
  - title: "PvP controller (deska, klik-tah, vícenásobný skok)"
    status: done
  - title: "Přestavba game-screen.ts na hratelnou obrazovku + napojení v main.ts"
    status: done
  - title: "CSS herní obrazovky + ruční ověření 2 prohlížeči"
    status: done
verify:
  - title: "Vizuální průchod dvěma prohlížeči (klikací UX)"
    detail: "Mechanicky ověřen serverový kontrakt (E2E přes reálné WS) + veškerá klientská logika (327 web unit testů). Na lidské oči zbývá vlastní UX: orientace desky dle barvy (vlastní kameny dole), klik-tah vč. vícenásobného skoku, řádek stavu (na tahu / soupeř / výsledek), hláška odmítnutého tahu, konec partie. Postup: spustit server (packages/server: pnpm start) + web (packages/web: pnpm dev), otevřít http://localhost:5173 ve DVOU oknech, přezdívky, výzva → přijetí, odehrát partii."
  - title: "Restart vite dev serveru kvůli změně proxy"
    detail: "Do vite.config.ts jsem přidal `ws: true` na `/games` (herní WS se jinak přes dev proxy neupgraduje → stav by nedorazil). Změna vite.config.ts se projeví AŽ po restartu běžícího vite dev serveru. Bez restartu zůstane herní deska na „Připojuji k partii…"."
---

# Fáze 72 — report z auto session

## Co je hotové
Placeholder herní obrazovky nahrazen skutečnou hratelnou PvP deskou. Tok: úvodní stav přes REST `GET /games/:id` + živé aktualizace přes herní WS `/games/:id/ws`; tah po room WS (`{type:'move', gameId, from, path}`); server-autoritativní stav dorazí oběma a překreslí desku; po přirozeném konci se ukáže výsledek.

Nové moduly: `game-socket.ts` (snapshot + WS updates), `pvp-controller.ts` (klik-tah vč. vícenásobného skoku, znovupoužívá `board-view` + `selection`). Přestavěné: `game-screen.ts`, `lobby.ts` (most `GameLink`), `room-client.ts` (metoda `move`), `server-client.ts` (`PvpGameDto` + guard), `main.ts`, `vite.config.ts`.

Gates: typecheck 0, lint 0, **327 web testů** zelených (cli/engine/server nedotčené a zelené). 

## Ověření nad rámec jednotek
Napsal jsem E2E skript (dva `ws` klienti proti živému serveru na :3000), který reálně odehraje tah a ověří kontrakt: párování (vyzyvatel=černý, vyzvaný=bílý), REST snapshot, herní WS bez zprávy při připojení, tah broadcastnutý OBĚMA, autorita serveru (mimo pořadí i nelegální tah odmítnuty, stav beze změny). Prošel.

## Dvě rozhodnutí, na která jsem narazil (kandidát na /mini:decision)
1. **Úvodní stav: REST snapshot (klient) vs. push-on-connect (server).** Herní WS je PUSH při ZMĚNĚ – při připojení sám neposílá aktuální stav (fáze 66 ho zavedla jako aditivní k REST pollingu). Bez úvodního stavu by první hráč neměl co táhnout. Zvolil jsem klientský REST snapshot přes existující `GET /games/:id` (pro PvP funguje) + WS na aktualizace, s ochranou proti race (`liveApplied`: starší snapshot se zahodí, když už dorazil živý push). Alternativu „poslat stav při subscribe" jsem zamítl: fáze je klientský řez a změna by rozbila existující serverové WS testy (posílají push až po mutaci).
2. **Reálný integrační nález:** dev proxy přeposílala `/games` BEZ `ws: true` – herní WS je první browser konzument tohoto endpointu (engine deska jede REST pollingem), takže by se stav přes dev proxy nedoručil. Opraveno (`ws: true`).

## Self-review (nezávislý sub-agent) a opravy
Pustil jsem adversariální self-review (čerstvý kontext). Našel reálné díry na cestách ztráty spojení; VŠECHNY opraveny a pokryty testy:
- **Snapshot mohl ožít po pádu WS** (guard testoval jen explicitní `closed`, ne `down` z pádu socketu) → deska by se stala interaktivní bez živého kanálu. Fix: guard kontroluje i `down`.
- **Pád herního WSmid-game desku nezamkl** → hráč mohl táhnout „do prázdna" a `pendingMove` uvázl. Fix: `controller.setConnectionLost()` (zamkne vstup, uvolní zámek), `game-screen.onClosed` ho volá + trvalá hláška.
- **Pád room WS = tichý no-op `move` a natrvalo zamrzlá deska.** Fix: `move` vrací boolean; deska při neodeslání NEZAMKNE a ohlásí „Spojení není dostupné".
- Drobnost: `showError` teď srovná i řádek stavu zpět na „na tahu".

## Vědomě mimo řez
Vzdání/remíza (todo 40), reconnection/auto-obnova spojení (todo 42), timeout nečinnosti (todo 43). Odveta + změna stran (samostatná fáze, viz diskuse) – vyžaduje serverovou práci (uvolnění `busy` po konci partie).

## Pro člověka
Viz `verify` výše: klikací UX ve dvou prohlížečích a **restart vite dev serveru** kvůli změně proxy.

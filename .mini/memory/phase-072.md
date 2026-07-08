# Phase 72 — Klient: hratelná PvP deska

**Goal:** Po přijetí výzvy odehrají dva lidé partii v prohlížeči: herní obrazovka vykreslí desku orientovanou podle vlastní barvy ze stavu pushnutého přes /games/:id/ws, hráč na tahu zadá legální tah (včetně vícenásobného skoku), klient ho pošle po room WS ({type:'move', gameId, from, path}), server-autoritativní stav dorazí oběma a překreslí desku, po přirozeném konci se ukáže výsledek; vzdání/remíza (todo 40), reconnection (todo 42) a timeout nečinnosti (todo 43) jsou vědomě mimo řez.

## Steps
- [done] room-client: metoda move + unit testy
- [done] Lobby → herní most (odeslání tahu + chyby tahu)
- [done] Herní WS klient stavu partie
- [done] PvP controller (deska, klik-tah, vícenásobný skok)
- [done] Přestavba game-screen.ts na hratelnou obrazovku + napojení v main.ts
- [done] CSS herní obrazovky + ruční ověření 2 prohlížeči

## Auto-commit
- Phase 72: Klient: hratelná PvP deska

## Discussion
# Phase 72 — Klient: hratelná PvP deska

## Intent
Nahradit placeholder herní obrazovky (`packages/web/src/game-screen.ts`, fáze 71) skutečnou hratelnou PvP deskou. Dva lidé po přijetí výzvy odehrají partii v prohlížeči:
- Klient po vstupu na obrazovku otevře **nový** WS `/games/:id/ws`; server pushuje `{type:'game-state', game: PvpGameDto}` s `PvpGameDto = {mode:'pvp', id, position, result, legalMoves}`. Deska se vykreslí podle toho, orientovaná dle vlastní barvy.
- Hráč na tahu zadá legální tah (vč. vícenásobného skoku) a klient ho pošle po **room WS** jako `{type:'move', gameId, from, path}` (room WS drží `main.ts`, nezavírá se).
- Server ověří autoritu a na úspěch pushne nový stav OBĚMA přes game WS → obě desky se překreslí.
- Po přirozeném konci (pravidla, žádné legální tahy) se ukáže výsledek.

Serverová strana je hotová (fáze 68–70): kontrakt `handleMove` v `app.ts` (řetěz ověření členství → barva → pořadí → legalita přes `findLegalMove`), broadcast přes `GameHub`, game WS route `/games/:id/ws`, `pvpGameToDto`. Tvar tahu = `{from, path}`, `captures` si server odvodí sám (klient je neposílá).

Mimo řez (vědomě): vzdání/remíza = todo 40, reconnection = todo 42, timeout nečinnosti = todo 43.

## Key decisions
- **Nový tenký PvP controller**, ne rozšíření `createBoardController`. Stávající controller (923 ř., `controller.ts`) je hustě navázaný na engine (polling à 250 ms, single-flight přes HTTP `ServerClient`, detekce tahu AI, ballot, hint Výuky, vzdání/remíza přes HTTP, tvar `GameDto` ≠ `PvpGameDto`). PvP z toho nepotřebuje nic. Znovupoužít **jen** `board-view.ts` (kreslení, otočení dle barvy) a `selection.ts` (výběr, vícenásobný skok: `selectableAt`, `nextTargets`, `resolveChainTo`). Řídit čistě server-pushem přes game WS, tah posílat callbackem po room WS. Bez pollingu, enginu, ballotu, hintu.
- **Kámen se pohne až po serverovém pushi** (autoritativní, žádné optimistické vykreslení). Po zadání tahu se čeká na `game-state` z game WS, teprve pak překreslit. Konzistentní s autoritou serveru, žádná reconcile/rollback logika.
- **Vlastní barva se bere z `ChallengeAcceptedInfo.color`** (fáze 71), NENÍ v pushnutém `PvpGameDto` (nemá `humanColor`). Musí se protáhnout do PvP obrazovky/controlleru jako vstupní kontext. Ze samotného game WS ji nelze dovodit.
- **Chyba tahu (`{type:'error', message}` z room WS) se musí routovat do herní obrazovky**, ne do formuláře místnosti. Dnešní `onError` v room-clientu vrací uživatele do lobby (logika fáze 71); pro odmítnutý tah je potřeba nová větev/handler, který na herní obrazovce ukáže hlášku a překreslí z posledního autoritativního stavu (kámen se vrátí). `room-client` musí dostat i metodu `move(gameId, from, path)` (dnes ji nemá — `RoomClient` má jen join/challenge/accept/reject).
- **Konec partie = jen přirozený konec + „Zpět do místnosti"** (tlačítko už je z fáze 71). Ukázat výsledek (výhra/prohra dle vlastní barvy vs. `result`). Žádné tlačítko Odveta.
- **Odveta + změna stran odložena do vlastní fáze** (navázat na todo 40). Není proveditelná zde bez serverové změny — viz Watch out.

## Watch out for
- **Tah cestuje přes DVA sockety:** odejde po room WS, výsledek přijde po game WS, ale CHYBA se vrátí po room WS a je bez diskriminátoru (`{type:'error', message}` — neví se, že jde o tah partie #X). Snadné místo na tichou díru: chyba tahu skončí v lobby handleru místo na desce.
- **Barva NENÍ v pushnutém stavu** — křehké protažení kontextu z fáze 71. Pro reconnection (todo 42) to nestačí, ale tady stačí.
- **`busy` se po konci PvP partie NIKDY neuvolní** (`ChallengeRegistry.busy` maže jen `removePlayer` při odchodu z místnosti, `challenges.ts:120`). Důsledek: po dohrané partii nejde stejnou dvojici znovu vyzvat, dokud jeden neopustí místnost. Kvůli tomu odveta (i prosté re-challenge) vyžaduje serverovou práci = patří k todo 40 (uvolnit busy na konci) + párování s prohozenými barvami. Doporučeno: založit todo na odvetu navázané na todo 40.
- **Orientace + souřadnice:** `board-view` už otáčí dle barvy; ověřit, že `selection.ts` (targety, řetěz skoku) funguje správně i pro bílého hráče (otočená deska nesmí rozhodit mapování `Square`→políčko).
- **Formát tahu na drátě:** `path` je pole VŠECH dopadových políček (u vícenásobného skoku každé mezidopadnutí), `from` zvlášť. `findLegalMove` porovnává `from` + celé `path` prvek po prvku (smí obsahovat duplicity u kruhového skoku dámy) — klientův výběr musí stavět přesně tohle, ne set.
- **Game WS lifecycle:** otevřít při vstupu na obrazovku, zavřít při odchodu (jinak roste hub o mrtvá spojení). Neznámá partie → server socket rovnou zavře; klient to nesmí tiše viset. Reconnection game WS je todo 42 (mimo).
- **Nesmí se zavřít room WS** při přechodu na desku ani zpět — session id je navázané na partii, zavření by ji rozpadlo (drží `main.ts`).

## Run report
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

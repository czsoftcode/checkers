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

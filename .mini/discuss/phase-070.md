# Phase 70 — PvP tah: serverová autorita

## Intent
PvP partie (fáze 68, `mode:'pvp'`, `players:{black,white}` = barva → session id) dnes
existuje jako záznam, ale nedá se hrát ani číst: `POST /moves` a `GET /games/:id` ji
odmítají 409 `pvp_not_playable`, `dtoFor()` na PvP schválně hází (GameDto je engine-tvaru),
a proto by na PvP spadl i `broadcast()`.

Tato fáze zprovozní hraní PvP na serveru: přijmout tah JEN od hráče, který je v partii a
je NA TAHU; ověřit legalitu sdílenou `rules`; nelegální / mimo pořadí / z cizí partie
odmítnout čistou chybou (ne pádem); po platném tahu rozeslat nový stav OBĚMA přes
`/games/:id/ws`; a zajistit, že čtení stavu PvP přestane padat. Klientské UI PvP desky a
výzev je vědomě mimo řez.

## Key decisions

- **Přenos tahu = room WS, autentizované (ZVOLENO).** PvP tah přijde zprávou po `/room/ws`
  (návrh tvaru `{type:'move', gameId, from, path}`). Server bere identitu odesílatele z
  `me.id` (session id, které serveru přiřadil PŘI joinu tomu socketu) — NEfalšovatelné.
  Server ověří: `me.id ∈ {players.black, players.white}` (člen partie) → z toho odvodí barvu
  hráče → `state.position.turn === barvaHráče` (na tahu) → legalita přes `findLegalMove` /
  rules. Pak `applyMove` + `broadcast` OBĚMA přes game hub `/games/:id/ws`.
  - **Proč ne REST/game-WS s session id v těle:** roster místnosti (fáze 67) rozesílá
    `{id, nick}` VŠEM → session id soupeře je veřejné → client-asserted identita je
    falšovatelná (A by táhl za B). Jen room WS má nefalšovatelnou identitu socketu.
  - **Důsledek:** `POST /games/:id/moves` NADÁLE odmítá PvP (409 `pvp_not_playable`) —
    zápisová cesta PvP je výhradně room WS. Existující test toho v `pvp-endpoints.test`
    (POST /moves na PvP = 409) tím zůstává platný.
  - **Refactor:** logiku aplikace tahu (najdi legální → applyMove → broadcast; BEZ engine
    a BEZ archivu) vytáhnout z REST `POST /moves` handleru do sdílené funkce, kterou volá
    room-WS `move`. Neduplikovat serializaci/broadcast.
  - **2 sockety na hráče během hry** (room WS pro tahy, game WS pro stav) — přechodné;
    projekt směřuje k jednomu multiplexovanému socketu, tohle je krok k němu.

- **Tvar `GameDto` pro PvP + `GET /games/:id`.** `dtoFor` rozšířit o `mode:'pvp'`; herní
  pole (pozice, kdo na tahu, výsledek, legální tahy) naplnit reálně, engine-only pole
  (`level`, `engineStatus`, `ballotIndex`, `ballotMoves`, `humanColor`) dát `null`. Tím
  přestane padat broadcast i GET → z `GET /games/:id` sundat umělý 409, začne vracet DTO.
  Svou barvu klient zná z `challenge-accepted`, cizí session id do stavového pushe NEcpát.
  - `resign` / `offer-draw` / `hint` na PvP ZŮSTÁVAJÍ 409 (konec/vzdání/remíza PvP = todo 40).
  - **Test dopad:** `pvp-endpoints.test` dnes tvrdí GET PvP = 409 → tento případ se obrátí
    na 200 + PvP DTO; resign/draw/hint případy zůstávají 409.

- **Archivace dohrané PvP partie = ODLOŽIT na todo 40.** `maybeArchive` guardovat na
  `mode==='pvp'` → no-op. PvP může v tomto řezu dohrát do konce podle pravidel (výhra /
  žádné tahy / remíza opakováním / 80 půltahů); finální stav se rozešle OBĚMA, ale PDN se
  nezapíše. Důvod: `formatGamePdn` má natvrdo `[White "Engine"][Black "Human"]` a přezdívky
  nejsou v PvP záznamu (jen session id) → korektní PDN s nicky = plumbování nad rámec řezu.

## Watch out for

- **`maybeArchive` NESMÍ jet na PvP** (viz výše) — jinak by na disk zapsalo lež
  Human/Engine. Ve sdílené move-funkci archiv pro PvP vynechat (nebo guard v maybeArchive).
- **`maybeTriggerEngine` už PvP no-opuje** (fáze 68) — zkontrolovat, že sdílená cesta ho
  pro PvP nevolá / volá bezpečně; PvP nemá engine barvu (`engineColorOf` na PvP hází).
- **`dtoFor` dnes na PvP HÁŽE** — dokud ho nerozšíříme, broadcast na PvP spadne. Pořadí:
  nejdřív PvP DTO, teprve pak zapnout broadcast/GET pro PvP.
- **Autorita „na tahu":** odmítnout tah barvy, která NENÍ na tahu, ještě než se hledá
  legální tah (jinak by se pro stranu na tahu našel legální tah i „nesprávnému" odesílateli,
  kdyby se identita popletla). Odvození barvy z `me.id` musí být jednoznačné.
- **Tah do už skončené partie** → odmítnout (analogicky REST: `effectiveResult !== 'ongoing'`
  → chyba, ne applyMove). Platí i pro PvP.
- **Cizí partie / neúčast:** `me.id ∉ players` → čistá chyba (odmítnutí), ne pád, ne applyMove.
- **Tvarová kontrola zprávy PŘED přístupem k polím** (stejný kontrakt jako join/challenge
  ve fázích 67/68): chybí `gameId`/`from`/`path`, špatný typ, neznámý `type`, `JSON.parse('null')`
  → `error`, socket drží.
- **Tah před joinem** (`me === null`) → `error`, ne pád.
- **Session id je per-socket, umírá při odpojení (todo 42).** `players.black/white` drží
  session id, které při dropu room WS zaniknou; po reconnectu hráč dostane NOVÉ id →
  přestane sedět na partii. V rámci jednoho souvislého spojení funguje; křehkost do todo 42
  napsat do reportu.
- **Broadcast fire-and-forget** (vzor fáze 66): posílat jen do OTEVŘENÝCH socketů
  (readyState OPEN), per socket v try/catch; vadný socket nesmí shodit odeslání druhému ani
  aplikaci tahu.
- **Izolace kanálů:** stav teče po game hub `/games/:id/ws`; tah přijde po `/room/ws`. Room
  WS zpráva `move` nesmí nic poslat po místnosti a game WS odběratel nesmí dostat nic z
  párování/roster. Ověřit v testu.

## Test teeth (dva reální WS klienti, vzor fáze 66–68)
- Platný tah hráče NA TAHU → OBA (černý i bílý) dostanou `game-state` s novým stavem přes
  game WS; po tahu se přehodí `turn` na soupeře.
- **Mimo pořadí:** hráč, který NENÍ na tahu, pošle tah → `error`, stav se NEZMĚNÍ, nikdo
  nedostane push.
- **Nelegální tah** hráče na tahu → `error` (+ legální tahy?), stav beze změny.
- **Z cizí partie / neúčastník:** session id mimo `players` pošle tah na cizí `gameId` →
  odmítnutí, ne pád, ne aplikace.
- **Čtení nepadá:** `GET /games/:id` na PvP vrátí 200 PvP DTO (ne 500, ne 409).
- (lehce) **Izolace:** room WS `move` nepošle nic po místnosti; odběratel párovací/roster
  cesty nedostane herní stav.

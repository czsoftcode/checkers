---
phase: 71
verdict: done
steps:
  - title: "room-client: protokol výzev (odesílání + příjem + stav)"
    status: done
  - title: "Unit testy room-clienta s fake WS"
    status: done
  - title: "main.ts: zvednout room-client + 3 obrazovky"
    status: done
  - title: "lobby.ts: UI výzev (klik, příchozí, odchozí)"
    status: done
  - title: "Herní placeholder + CSS výzev (CSP)"
    status: done
---

# Phase 71 — report z auto session

## Co se udělalo
Čistě klientský řez nad hotovým serverem (fáze 68/70). Rozšířen `room-client.ts`
o protokol výzev (odesílání `challenge`/`accept`/`reject`, příjem 4 serverových
zpráv s tvarovou obranou, stav příchozích výzev + jedné odchozí). `lobby.ts` dostal
UI: klik na cizí přezdívku = výzva, seznam příchozích výzev s Přijmout/Odmítnout,
stav odchozí „čekám na odpověď", neutrální hlášky. `main.ts` přepsán na tři
obrazovky (lobby ↔ hra ↔ sólo) tak, aby room WS PŘEŽIL přechod lobby→hra (fáze 70
posílá PvP tahy po room WS – kdyby se zavřel, session by umřela). Nový
`game-screen.ts` je placeholder (deska = todo 47). CSS bez inline (CSP).

Testy jedou přes REÁLNÝ room-client i lobby s fake socketem (vzor fáze 69). Celý
monorepo suite zelený (web 297, celkem 1115). Lint, typecheck, Vite build OK.

## Nezávislý self-review našel KRITICKOU chybu (opraveno)
Sub-agent (čerstvý kontext) odhalil session-brickující chybu, kterou checklist
stejného mozku nechytil:
- `challenge()` nastavil odchozí výzvu OPTIMISTICKY, ale server odmítnutou výzvu
  (vyzvaný už hraje / dvojitá / křížová) posílá jako `{type:'error'}`, ne jako
  `challenge-rejected`. Můj `error` handler `outgoing` nevyčistil → max-1 se zamkl
  a nešlo vyzvat už NIKOHO. Navíc lobby `onError` slepě přepínal na formulář nicku,
  odkud je re-join no-op (jsem `joined`) → zásek na „Připojuji…" natrvalo (jediná
  cesta ven byl reload).
- Dosažitelné BĚŽNÝM klikem: hrající hráči zůstávají v rosteru (room WS žije), takže
  klik na Vyzvat u někoho, kdo hraje, spustil celý řetěz. Stejně tak přijetí/odmítnutí
  právě expirované výzvy.

Oprava ve dvou vrstvách + testy se zuby (ověřeno, že po rozbití opravy padnou):
1. room-client `error` handler uvolní optimisticky nastavenou `outgoing` (odblokuje max-1).
2. lobby `error` po vstupu (`currentView === 'joined'`) ukáže jen hlášku a zůstane
   v místnosti; formulář nicku je vyhrazen chybám PŘED vstupem.

Trade-off (přiznaný): „uvolni odchozí na každý post-join `error`" je nekorelovatelná
heuristika – kdybych měl odchozí na Evu a zároveň dostal `error` z odmítnutí jiné
expirované PŘÍCHOZÍ výzvy, uvolním omylem i platnou odchozí. Je to stejná
nejednoznačnost, se kterou max-1 už vědomě žije (server vyzyvateli neposílá id jeho
výzvy), a je to menší zlo než trvalé zaseknutí. Čisté řešení by chtělo serverový ack
výzvy s `challengeId` = změna kontraktu mimo tento řez.

## Známé omezení (mimo řez, k zvážení do todo)
Když během herní obrazovky spadne room WS, uživatel to na placeholderu NEVIDÍ –
lobby (naživu, ale odpojené z DOM) si nastaví „odpojeno" neviditelně; zjistí se to
až po „Zpět do místnosti". Pro placeholder bez desky je to obhajitelné (z webu zatím
po room WS neteče žádný herní provoz), ale další fáze s PvP deskou (todo 47) +
reconnection (todo 42) to musí ošetřit – propojit disconnect i do herní obrazovky.
Vědomě jsem to teď neřešil, abych nepřidával vazbu game-screen ↔ room-client, kterou
řez záměrně nemá.

## Křehkost zděděná z fáze 68/70 (platí dál)
Partie i párování stojí na per-socket session id, které při odpojení room WS umře
(stabilní identita / reconnection = todo 42). V rámci jednoho souvislého spojení
funguje; po výpadku se hráč na rozehranou partii nenaváže.

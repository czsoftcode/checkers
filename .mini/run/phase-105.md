---
phase: 105
verdict: done
steps:
  - title: "presence.ts: nullable clenstvi + connect/enter"
    status: done
  - title: "app.ts: zpravy connect/enter + guardy ne-clena"
    status: done
  - title: "challenges.ts: prvni vyzva vyhrava"
    status: done
  - title: "WS integracni testy: predsin + busy vyzva"
    status: done
---

# Fáze 105 — report z auto session

Server-only základ pro novou lobby UX „skutečná předsíň" (B2). Vše hotové, celé monorepo zelené: typecheck, lint, server 199 testů (+16 nových), web/engine/ai/cli beze změny. Klient (sloučení entry+akordeon + modal výzvy) je samostatná fáze 106.

## Co se udělalo (aditivně — legacy `join` z fáze 103 zůstává funkční)

- **presence.ts – nullable členství + předsíň.** `Identity.variant: VariantId | null` (null = připojen, nikde nečlen). Nové `Lobbies.connect(nick, socket)` (register globální identity BEZ členství, stejná validace/uniqueness jako join) a `Lobbies.enter(id, target)` (null → člen). Legacy `join` refaktorován na `connect` + sdílené jádro `assignLobby` (validace nicku žije na jednom místě; chování pro členy byte-identické). `remove`/`sendTo`/`switchLobby` ošetřeny na null (bez maskování defaultem na american): ne-člen není v žádné room, `sendTo` mu doručí přímo na socket.
- **app.ts – zprávy connect/enter + guardy.** `me.variant: VariantId | null`. `handleConnect` (register, pošle all-roster snímek jen připojenému — connect nemění rostery, tak ostatním nic) a `handleEnter` (null → člen, broadcast joined + all-roster + echo roster). Guardy ne-člena (`me.variant === null`) v challenge / switch-lobby / accept → „Nejdřív vstup do lobby." `close` ne-člena jen zahodí identitu + broadcast all-roster (žádné room-left). Legacy join/switch/challenge pro členy beze změny.
- **challenges.ts – první výzva vyhrává.** `ChallengeRegistry.create` odmítne, když vyzvaný už má čekající příchozí výzvu (`hasPendingIncoming`) → nový důvod „Vyzvaný hráč právě zvažuje jinou výzvu." (kontrola až za `hasPendingBetween`, ať dvojitá A→B dostane přesnější hlášku). Max jedna příchozí na hráče → klient (106) ukáže vždy právě jednu, žádná fronta.

## Testy (zuby)

- **presence unit (+8):** connect registruje bez členství (nejsem v žádném rosteru, totalCount roste), globální nick-uniqueness platí i pro connect, enter přidá do rosteru, remove/sendTo/broadcastAll pro ne-člena.
- **challenges unit (+3, 1 upraven):** druhá výzva na téhož vyzvaného → rejected s jiným důvodem než busy, první platí; po odmítnutí/odchodu prvního jde druhá. Upraven test „spárování zruší vedlejší výzvy" — dvě příchozí na B jsou nově nelegální, takže vedlejší výzva B je teď B jako vyzyvatel (B→D).
- **nový WS soubor `lobby-connect-ws.test.ts` (+5):** connect → snímek + nejsem v rosteru, enter → jde mě vyzvat; busy výzva (obsazen, první platí); ne-člen sám nevyzývá a je neviditelný (netargetovatelný).
- **Stávající ws testy (challenge-ws / room-ws / variant-lobby-ws / pvp-*-ws) zelené beze změny** — aditivnost potvrzena.

## Adversariální self-review (nezávislý sub-agent, čerstvý kontext)

Fáze sahá na connect kontrakt + scope výzev (bezpečnostní hranice), proto nezávislý sub-agent. Prošel všechny cesty a **nenašel žádný potvrzený defekt:**
- Null-propagace čistá: všechna volání `room(...)` jsou buď literál/variant-po-guardu, nebo za guardem `me.variant === null`; herní handlery `me.variant` vůbec nečtou. `createPvp` default na american se s `null` neaplikuje (JS default jen na `undefined`) + guard v handleAccept zúží typ.
- Aditivnost legacy `join` zachována (byte-identické pořadí roster→joined→broadcastLobbies).
- enter/switchLobby přes sdílené `assignLobby` bez nekonzistence (app guardy pokrývají oba vstupy).
- Pravidlo výzev nerozbíjí accept/reject/removePlayer ani rematch (fáze 77 nejde přes `create`); pořadí kontrol správné.
- Dvojitý connect / connect-po-join / enter-po-join ošetřeny; druhá identita nevznikne.

Dvě drobnosti (NE defekty, vědomé): `Lobbies.variantOf` nemá zatím produkčního volajícího (API pro testy); připojený ne-člen drží přezdívku globálně, aniž je vidět v rosteru (design B2 předsíně).

## Poznámka

Tato fáze SÁM O SOBĚ nemění UI — brána je serverová (protokol + testy). Vizuální gate (předsíň, akordeon, modal příchozí výzvy) je až fáze 106, která zároveň přesune klienta na nový protokol connect/enter a odstraní legacy `join`.

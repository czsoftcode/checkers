# Phase 105 — Server: PvP předsíň a pravidlo výzev

**Goal:** Serverový základ pro novou lobby UX (klient = 106). ADITIVNĚ (join z 103 zůstává funkční, ať web mezi 105 a 106 nespadne a stávající ws testy jsou zelené): (1) B2 předsíň - Identity.variant nullable, nová zpráva connect{nick} = register bez členství + all-roster snímek, enter{variant} = první členství (null->člen); (2) pravidlo první-výzva-vyhrává - ChallengeRegistry.create odmítne, když vyzvaný už má čekající příchozí výzvu (nový důvod obsazen), max jedna příchozí na hráče. Guardy pro ne-člena (variant=null): nejde vyzvat ani nevyzývá; close ne-člena jen zahodí identitu + broadcast. Gate = testy (connect/enter, challenge-busy, ne-člen) + zelené stávající ws testy, NE UI. Legacy join a migrace testů = fáze 106.

## Steps
- [done] presence.ts: nullable clenstvi + connect/enter
- [done] app.ts: zpravy connect/enter + guardy ne-clena
- [done] challenges.ts: prvni vyzva vyhrava
- [done] WS integracni testy: predsin + busy vyzva

## Auto-commit
- Phase 105: Server: PvP předsíň a pravidlo výzev

## Discussion
# Phase 105 — Server: PvP předsíň a pravidlo výzev

> Fáze vznikla SPLITEM původní 105 „úvodní akordeon a modal výzvy": TATO 105 = SERVER-only
> základ; úvodní akordeon + modal (klient) je odložen do fáze 106.

## Intent
Server-only základ pro novou lobby UX „skutečná předsíň" (uživatel zvolil B2, ne B1). Klient (sloučení
entry+akordeon na jednu obrazovku + modal příchozí výzvy) přijde jako samostatná fáze 106. Rozděleno,
protože B2 + nové pravidlo výzev jsou dva serverové kontrakty + migrace testů — na jednu klient-UI fázi moc
velké a sahá na bezpečnostní hranici (scope výzev, connect kontrakt), která chce vlastní bránu a review.

Dvě serverové změny + tvrdý požadavek na aditivnost.

## Key decisions
- **B2 předsíň = ADITIVNĚ, ne náhradou (klíčové, aby split nerozbil web mezi 105 a 106).** 105 PŘIDÁ nové
  zprávy VEDLE stávajícího `join{nick,variant}`, který ZŮSTANE funkční (dnešní klient i ws testy zelené):
  - `Identity.variant: VariantId | null` (null = připojen, procházím, nikde nečlen).
  - Nová zpráva `connect{nick}`: register GLOBÁLNÍ identity (nick-uniqueness už existuje) BEZ členství,
    variant=null; hned pošle all-roster snímek. `broadcastAll` (`presence.ts:449`) už iteruje `identities`,
    takže připojený ne-člen snímek dostane bez úprav fan-outu.
  - Nová zpráva `enter{variant}`: null → PRVNÍ členství (add do room, broadcast `joined` + all-roster).
    Zvážit sjednocení s `switchLobby` do jedné operace „setLobby(target)", co zvládne null-i-člen výchozí
    stav; nebo `enter` = tenký wrapper. Rozhodnout v plan.
  - Legacy `join`/`switchLobby` z 103 BEZE ZMĚNY. Odstranění legacy `join` + migrace ws testů na
    connect/enter je úkol fáze 106 (až klient přejde na nový protokol).
- **Pravidlo „první výzva vyhrává" (uživatel).** `ChallengeRegistry.create` (`challenges.ts:62`) odmítne,
  když `challengedId` UŽ má čekající PŘÍCHOZÍ výzvu (od kohokoli) → nový důvod, jiný než „už hraje"
  (např. „Vyzvaný hráč právě zvažuje jinou výzvu." / „obsazen"). Nový helper `hasPendingIncoming(id)`.
  Efekt: max JEDNA příchozí výzva na hráče → klient (106) ukáže v modalu vždy právě jednu, žádná fronta.
  Text důvodu přes i18n až v 106 (server vrací důvod stringem jako dnes).
- **Guardy pro ne-člena (variant=null):** připojený ne-člen NENÍ v žádném rosteru → nejde ho vyzvat
  (challenge target not in lobby → dnešní `has()` false stačí) ani sám nevyzývá (challenge guard „nejsi
  v lobby" pro null). `close`/`remove` ne-člena jen zahodí identitu + broadcast all-roster (žádná room-left,
  není odkud). Přechod za běhu partie se null netýká (ne-člen nehraje).

## Watch out for
- **Aditivnost je bezpečnostní pojistka proti rozbitému oknu.** Kdyby 105 nahradilo `join`, web mezi 105 a
  106 spadne (klient posílá starý `join`). Proto connect/enter PŘIDAT, join NECHAT. Gate 105 = stávající
  ws testy (challenge-ws/room-ws/pvp-*-ws) ZŮSTÁVAJÍ zelené BEZE ZMĚNY + nové testy pro connect/enter a
  pro challenge-busy pravidlo.
- **Nové testy s zuby:** (a) `connect{nick}` → dostanu all-roster snímek a NEJSEM v žádném rosteru;
  `enter{variant}` → objevím se v rosteru té lobby a jde mě vyzvat. (b) Vyzvu hráče, který už má čekající
  příchozí výzvu → dostanu „obsazen"; první výzva pořád platí. (c) Ne-člen (po `connect`, bez `enter`)
  nejde vyzvat a sám vyzvat nemůže.
- **Null členství se snadno prosákne do routingu:** `sendTo`/challenge cesty počítají s tím, že hráč JE
  v lobby (103). Každou cestu, kde se bere `identity.variant`, projít na null (TypeScript to vynutí, když
  se typ změní na `| null`) — nemaskovat null defaultem na american.
- **Rozdělení = 105 SÁM O SOBĚ nezmění UI.** Brána je serverová (testy + chování protokolu), ne „dva
  prohlížeče". Vizuální gate (předsíň, akordeon, modal) je až 106. Nehlásit 105 jako hotové na základě UI.
- **Sub-agent review PŘED reportem** (fáze sahá na connect kontrakt + scope výzev = bezpečnostní hranice),
  viz projektový CLAUDE.md.

## Run report
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

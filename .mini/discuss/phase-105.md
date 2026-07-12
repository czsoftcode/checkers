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

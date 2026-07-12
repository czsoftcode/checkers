# Phase 104 — Klient: čtyři varianta-lobby (UI)

**Goal:** Klientské UI čtyř fixních varianta-lobby jako AKORDEON: nahoře přezdívka, pod ní 4 místnosti (řízeno registrem variant) jako přepínatelné akordeonové sekce; rozbalená sekce ukáže roster (kdo tam je) + tlačítko Vstoupit; po vstupu výzva a hra jako dnes. room-client pošle variantu při join (+ op switchLobby z D3a), přechod mezi lobby přes akordeon. i18n: názvy místností + nové texty přes cs/en (názvy variant už z D2). Brána: ve dvou prohlížečích vstoupím do téže lobby (pool/ruská/česká), vyzvu se a odehraju partii; cross-variant se nevidíme; přepnutí lobby funguje; stávající PvP tok (americká) beze změny; i18n testy zelené. UZAVÍRÁ todo 59 a celou vlnu variant. POZOR do discuss: akordeon chce vidět rostery VŠECH 4 lobby před vstupem -> server musí rostery vystavit (může rozšířit D3a); a jestli PvP herní obrazovka potřebuje variantu client-side, nebo stačí server-provided legalMoves.

## Steps
- [done] Server: variant do PvpGameDto a pvpGameToDto
- [done] pvp-controller: varianta z DTO do zvyrazneni
- [done] Server: broadcast rosteru vsech 4 lobby
- [done] room-client: variant v join, switchLobby, prijem lobbies
- [done] i18n: klice nazvu mistnosti + akordeonu (cs/en)
- [done] lobby.ts: akordeon 4 varianta-lobby

## Auto-commit
- Phase 104: Klient: čtyři varianta-lobby (UI)

## Discussion
# Phase 104 — Klient: čtyři varianta-lobby (UI)

## Intent
Klientské UI čtyř fixních varianta-lobby jako AKORDEON: nahoře přezdívka, pod ní 4 místnosti (řízeno
registrem variant), rozbalená sekce ukáže roster + akci. Uzavírá todo 59 a celou vlnu variant.

REVIZE po druhé diskuzi (103 už zacommitována jako cec4387): dva předpoklady, na kterých stála první
diskuze 104, se s reálným kódem 103 ROZCHÁZEJÍ a 104 je musí dodělat samo:
- **(a) `variant` v `PvpGameDto` NEEXISTUJE.** Interface `dto.ts:28` i web `server-client.ts:120` pole
  `variant` nemá. Server ho použije jen interně pro `legalMoves` (`dto.ts:53` `rulesetForVariant`), ale
  klientovi neposílá. → 104 přidá pole do DTO.
- **(b) Broadcast rosterů všech 4 lobby NEEXISTUJE.** 103 postavila jedno-členský model: `join{nick,
  variant}` = rovnou dovnitř jedné lobby, roster jen té jedné (`app.ts:293`); `switchLobby` = přesun,
  roster cílové. Žádná zpráva „rostery všech 4". → 104 to dodá (uživatel zvolil „doplnit broadcast").

## Key decisions
- **(b) Broadcast všech rosterů = varianta B1 (kontrakt 103 nedotčen).** Zůstává „člen právě jedné lobby"
  (jak 103 postavila). Server NAVÍC pushuje read-only rostery všech 4 lobby každému připojenému socketu
  (na connect + při každé změně prezence). Akordeon: sekce MOJÍ lobby = roster S tlačítky Vyzvat; ostatní
  3 sekce = roster jen na čtení + tlačítko **Vstoupit** = `switchLobby` (už existuje z 103). NE varianta
  B2 (skutečná „předsíň bez členství" + oddělený enter) — ta by měnila sémantiku `join` z 103 a vracela
  zpětnou kompatibilitu, kterou 103 zavřela.
- **(a) `variant` do `PvpGameDto` (zvoleno jako jednodušší cesta k zvýraznění).** Přidat pole `variant` do
  DTO (server `dto.ts` + web `server-client.ts`), naplnit v `pvpGameToDto` z `state.variant`. Klient:
  `pvp-controller.ts` importuje `rulesetForVariant` a předá ruleset do `nextTargets(...)` (dnes 5 volání
  BEZ rulesetu → defaultuje AMERICKY: `pvp-controller.ts:204,241,341,451,458`). Symetrické s AIvP (D2
  `controller.ts`). NE varianta „odvodit z server legalMoves" — čistší jeden-zdroj-pravdy, ale přepis
  zdroje zvýraznění + asymetrie vůči AIvP; dražší.
- **Vyzvat jen ve své lobby.** Rostery cizích lobby jsou display-only (žádná tlačítka Vyzvat) — jinak by se
  obešla hranice „výzva jen v téže lobby" z 103.
- **i18n:** názvy 4 místností + nové texty (Vstoupit, stavy akordeonu) přes cs/en; názvy variant už z D2.
  Žádné natvrdo řetězce; i18n testy zelené.
- **Rozsah:** SERVER — nový broadcast rosterů všech lobby (`presence.ts` snímek 4 rooms + fan-out všem
  socketům; nový typ zprávy) + `variant` v `PvpGameDto`/`pvpGameToDto` (`dto.ts`). KLIENT — `lobby.ts`
  (akordeon, příjem all-roster snapshotu, tlačítka Vstoupit=switchLobby / Vyzvat jen v mé lobby),
  `room-client.ts` (příjem all-roster zprávy, join/switchLobby jak jsou), `pvp-controller.ts` (variant z
  DTO → ruleset do nextTargets), `i18n.ts`, game-screen protáhne variantu do controlleru.

## Watch out for
- **Nový broadcast je nová cesta → CHCE vlastní test:** vstup/left/switch v lobby A musí aktualizovat
  all-roster pohled klienta připojeného v lobby B. Fan-out O(hráči × 4) na každou změnu prezence — pro
  tenhle projekt triviální, ale je to nový kontrakt, ne kosmetika.
- **Zpětná kompatibilita 103/67-68:** existující `roster`/`joined`/`left` (scoped na jednu lobby) ZŮSTÁVAJÍ
  — klient je pořád potřebuje pro svou lobby (výzvy). Nový all-roster je navíc, ne náhrada. Testy
  challenge-ws / room-ws / pvp-*-ws MUSÍ zůstat zelené; starý klient neznámý typ zprávy ignoruje.
- **Jsi vždy členem jedné lobby** (default american po připojení), není „předsíň, kde nejsem nikde". Pokud
  by uživatel chtěl přesně tu předsíň, je to varianta B2 (mimo tento řez).
- **Rozšíření viditelnosti přezdívek:** dřív nick viditelný jen v rámci jedné lobby, teď všech lobby všem.
  Pro projekt OK, ale je to vědomé rozšíření scope výzev × prezence.
- **`pvp-controller` default american je tichá past:** server je autorita nad legalitou (odmítne nelegální
  tah), takže špatné KLIENT-SIDE zvýraznění „projde" bez pádu — jen UX je rozbité. Proto MUSÍ číst
  `variant` z DTO. Bez pole (a) je deska slepá.
- **Jediný zdroj varianty pro desku = server DTO** (`game.variant`); klient si variantu nedrží zvlášť, ať
  se nerozejde s partií (server autorita).
- **Přepnutí lobby během partie** už 103 odmítá (`isBusy` guard, `app.ts` handleSwitchLobby) — klient jen
  nesmí nabízet Vstoupit/přepínání, když hráč právě hraje (jinak dostane `error`).
- **Sub-agent review** (fáze sahá na kontrakt server↔klient + prezenční broadcast + hranici výzev) — pustit
  nezávislého sub-agenta jako self-review před reportem (viz projektový CLAUDE.md).

## Run report
---
phase: 104
verdict: done
steps:
  - title: "Server: variant do PvpGameDto a pvpGameToDto"
    status: done
  - title: "pvp-controller: varianta z DTO do zvyrazneni"
    status: done
  - title: "Server: broadcast rosteru vsech 4 lobby"
    status: done
  - title: "room-client: variant v join, switchLobby, prijem lobbies"
    status: done
  - title: "i18n: klice nazvu mistnosti + akordeonu (cs/en)"
    status: done
  - title: "lobby.ts: akordeon 4 varianta-lobby"
    status: done
verify:
  - title: "Brána: dva prohlížeče, tatáž ne-americká lobby → výzva a odehraná partie"
    detail: "Ověřeno mechanicky po dílech (server routing, room-client, controller, DTO), ale NE reálným dvou-prohlížečovým během. Projdi: dva prohlížeče vstoupí do téže lobby (pool/ruská/česká), vyzvou se, odehrají partii; deska v ne-americké variantě zvýrazňuje správné tahy (např. ruské braní vzad / létavá dáma)."
  - title: "Cross-variant izolace + přepnutí + americký tok beze změny"
    detail: "Server testy to hlídají, ale potvrď v UI: hráči v různých lobby se navzájem NEvyzvou; „Vstoupit\" mě přesune (roster i Vyzvat se přepnou na cílovou lobby); stávající americký PvP tok (výzva/hra/vzdání/remíza/odveta) beze změny."
  - title: "Vizuál akordeonu (CSS)"
    detail: "CSS jsem přidal, ale nevykreslil. Zkontroluj: 4 sekce, zvýraznění MÉ lobby, počet hráčů v hlavičce, rozbalení/sbalení klikem, čitelnost tlačítek Vstoupit/Vyzvat a řádku „Jsi tu jako {nick}\" na desktopu i mobilu."
---

# Fáze 104 — report z auto session

Hotové všech 6 kroků; celé monorepo zelené (typecheck, lint, `vite build`, testy: server 183, web 602, engine/ai/cli beze změny). Fáze uzavírá vlnu variant a todo 59.

## Co se udělalo

- **DTO nese variantu** (server `dto.ts` + web `server-client.ts`): `PvpGameDto.variant`. Server plní z `state.variant` (vždy), web má pole volitelné (starší stav → default american), guard `isPvpGameDto` odmítne přítomnou neplatnou variantu (chrání `rulesetForVariant` před RangeError).
- **pvp-controller** čte variantu z DTO v `applyState` a předává `ruleset` do všech volání `selection.ts` (dřív 5+ míst defaultovalo americky → deska ne-americké partie zvýrazňovala cizí tahy). `game-screen` variantu NEprotahuje — jediný zdroj je server DTO (rozhodnutí z diskuze, klient si variantu nedrží zvlášť).
- **Server broadcast rosterů všech 4 lobby**: nový `LobbiesMessage` (`type:'lobbies'`), `Lobbies.allRosters()` + `broadcastAll()` (fan-out přes identity). `app.ts` volá `broadcastLobbies()` po KAŽDÉ úspěšné změně prezence (join, switch-ok, close) a NEvolá na cestách bez změny (neúspěšný join, `same` switch). Aditivní ke scoped `roster`/`joined`/`left` (103 nedotčeno).
- **room-client**: `join(nick, variant?)`, nová `switchLobby(variant)`, handler `onLobbies` + guard `isWireLobbyRoster` (vadná položka → zahodí celý snímek).
- **lobby.ts přestavěno na akordeon**: nahoře přezdívka, 4 sekce z registru `VARIANT_IDS`, řízené `onLobbies`. MOJE lobby (sekce s položkou `isSelf`) nabízí Vyzvat + „Jsi tady"; ostatní 3 jen čtení + „Vstoupit" (`switchLobby`). Výzvy jen v mé lobby (hranice z 103).
- **i18n** cs/en: `lobby.loggedInAs/enterLobbyBtn/hereBadge/emptyLobby`. Názvy variant už z D2.

## Adversariální self-review (nezávislý sub-agent, čerstvý kontext)

Pustil jsem nezávislého sub-agenta na kontrakt server↔klient, prezenční broadcast a hranici výzev. Potvrdil 2 reálné (UX, ne korupce stavu) chyby — **obě jsem opravil a doplnil test se zubem:**

1. **Odmítnutí `switch-lobby` propadalo na herní desku.** Závod: kliknu „Vstoupit", ale soupeř mezitím přijme mou výzvu → vznikne partie, server switch odmítne („během partie") a ta chyba propadla přes `onError` do herní obrazovky jako matoucí hláška u desky. Fix: flag `pendingSwitch` v `lobby.ts` — odmítnutí přechodu se označí jako přechodové a do hry se nesměruje (mimo partii jde do neutrální notice).
2. **Vlastní sekce akordeonu se po vědomém sbalení sama znovu rozbalila** při jakékoli změně prezence (broadcast jde všem). Fix: flag `hasAutoExpanded` — výchozí rozbalení mé lobby se nastaví JEN jednou, pak se respektuje uživatelova volba.

Sub-agent ověřil jako v pořádku: úplnost broadcastu na všech cestách, jedinečnost `isSelf`, nastavení rulesetu před renderem ve všech voláních, guardy (nepropustí pád, neodmítnou prázdnou lobby), pořadí roster→lobbies.

## Známá omezení (mimo řez, nízké riziko)

- **Nový klient + starý server bez zprávy `lobbies`** → akordeon zůstane prázdný (4 sbalené sekce, žádné Vyzvat). V monorepu se server+klient nasazují spolu; degradace není graceful, ale reálné riziko nulové.
- **Hráči v rozehrané partii dál visí v rosteru** s tlačítkem Vyzvat (klik → serverový `error`). Není regrese 104 — scoped roster to měl už ve 103, akordeon to jen zopakoval.

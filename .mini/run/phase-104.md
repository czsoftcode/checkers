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

---
phase: 103
verdict: done
steps:
  - title: "Validace + createPvp podle varianty"
    status: done
  - title: "Globální registr identit + 4 členství"
    status: done
  - title: "join nese variantu + switchLobby"
    status: done
  - title: "Výzva a partie jen v téže lobby"
    status: done
  - title: "PDN zapíše variantu"
    status: done
  - title: "Brána: server testy + zpětná kompatibilita"
    status: done
  - title: "Nezávislý sub-agent review"
    status: done
---

# Fáze 103 — report z auto session

## Co je hotové
Serverová část čtyř PvP varianta-lobby. Uzavírá server část todo 56 (dto/store validace podle varianty).

**Bezpečnostní hranice (todo 56):** `dto.findLegalMove`/`legalMoveDtos`/`pvpGameToDto` dostaly ruleset; `app.tryApplyMove` volá `findLegalMove(..., rulesetForVariant(record.state.variant))`. Autoritativní cesta tahu tak validuje pravidly VARIANTY záznamu, ne vždy americky. `store.applyMove` byl už správný přes `advanceState` (čte `state.variant`). `createPvp(a,b,variant)` nastaví `GameState.variant`; rematch dědí variantu STARÉ partie (`outcome.state.variant`, ne aktuální lobby hráče).

**Globální identita vs. členství:** `RoomPresence` je nově čistý transport JEDNÉ lobby (add/remove/roster/broadcast/sendTo/has/count). Nová třída `Lobbies` drží `Map<VariantId, RoomPresence>` (4 lobby) + GLOBÁLNÍ registr nicků (jedna přezdívka na celý server) + `switchLobby`. „Karel" nejde zaregistrovat dvakrát ani do různých lobby.

**join + switch-lobby:** join čte variantu (chybí/neznámá → american, zpětná kompat se stávajícím klientem); `roster` echuje variantu. `switch-lobby` přesune členství bez ztráty identity, odmítnut když je hráč busy (hraje).

**Výzva/partie jen v téže lobby:** cross-variant výzva padne přes `lobbies.room(me.variant).has(targetId) === false`. Partie nese variantu lobby.

**PDN:** `formatGamePdn(...,variant)` zapíše `[Variant "<id>"]` + per-varianta `[Event]` a hlavně dá `formatMove` ruleset varianty (bez toho by dlouhý tah létavé dámy spadl na „teleport").

## Testy (zpětná kompat + brána)
Všech 179 serverových testů zelených (bylo 164, +15). Ostatní balíčky beze změny zelené (rules 382, engine 268, ai 57, web 586). Lint + typecheck čisté napříč repem.

- Stávající `challenge-ws`, `room-ws`, `pvp-*-ws` zůstaly BEZE ZMĚNY zelené (americká cesta = žádná regrese). Dekorace `app.roomPresence` míří na americkou lobby, takže testy sahající na `.count()` fungují dál.
- `presence.test.ts` přepsán na refaktorovaný `RoomPresence` + novou `Lobbies` (globální unikátnost napříč lobby, switchLobby, per-lobby scope).
- Nový `variant-lobby-ws.test.ts`: partition, cross-variant reject, **nelegální tah v dané variantě** (rozhodující fixtura – ruský řetěz braní `17x10x19` vs. americké `17x10`; oba verdikty se při americké validaci obrátí = zuby na wiring), zpětná kompat echo, switch-lobby, PDN ruské partie.
- `dto.test.ts` + `pdn.test.ts` rozšířeny o rozhodující jednotky (braní vzad american vs. russian; PDN varianty + létavá dáma bez pádu).

Zuby ověřeny mutací: dočasný revert rulesetu v `tryApplyMove` i revert zrušení výzev v `switch-lobby` shodil odpovídající test.

## Nález z nezávislého sub-agent review (opraveno)
Sub-agent (čerstvý kontext) našel reálnou cross-module chybu: nová `switch-lobby` nesahala na registr výzev. Okno TOCTOU – Alice vyzve Boba (oba american), Bob přepne do russian DŘÍV, než přijme (busy je až po accept), pak přijme → vznikla by **cross-variant partie** a protějšek by nedostal `challenge-cancelled`. Opraveno: přechod ruší všechny čekající výzvy hráče (`challenges.removePlayer`, jako při `close`) a uvědomí protějšky. Přidán test se zuby.

## Poznámky pro člověka
- **Klientské UI čtyř místností je MIMO řez (D3b)** – server op `switch-lobby` je hotový a otestovaný, ale klient ho zatím nevolá. Todo 59 se zavře až po D3b; todo 56 (server dto/store validace) je tímto uzavřené.
- **Rozhodnutí o formátu PDN tagu varianty:** diskuse nechala „tag Event nebo Variant" otevřené na do. Zvolil jsem OBOJÍ – strojové `[Variant "<id>"]` + lidský per-varianta `[Event]`. Pokud to chceš zaznamenat jako ADR, spusť `/mini:decision` před `/mini:done`; jinak to není zásadní křižovatka.

## Co jsem NEmohl ověřit mechanicky
Nic vizuálního – celá fáze je server (WS/HTTP + čisté funkce), vše ověřeno testy, typecheckem a lintem. Není co předat na lidský vizuální/UX check.

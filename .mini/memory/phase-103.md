# Phase 103 — Server: PvP varianta-lobby (jádro)

**Goal:** Rozdělit na serveru prezenci, výzvy a PvP partii podle varianty: WS join/výzva nesou variantu (default american, zpětně kompat. se stávajícím klientem); hráči se vidí a vyzvat můžou JEN v téže variantě (cross-variant výzva odmítnuta); PvpGameRecord nese variantu; server validuje KAŽDÝ tah přes rulesetForVariant(record.variant) - nepřijme nelegální tah v dané variantě; PDN archiv zapisuje variantu (vize: do PDN se zapisuje i varianta). Klientské UI čtyř místností je MIMO řez (D3b). Brána: server testy - hráči téže varianty se vidí/vyzvou/odehrají partii, cross-variant výzva odmítnuta, nelegální tah v dané variantě odmítnut; stávající americký klient beze změny hraje v american lobby (žádná regrese). UZAVÍRÁ server část todo 56 (poslední zbytek = server dto/store validace). Todo 59 se zavře až po D3b (klientské UI). Řez z todo 59 (fáze D).

## Steps
- [done] Validace + createPvp podle varianty
- [done] Globální registr identit + 4 členství
- [done] join nese variantu + switchLobby
- [done] Výzva a partie jen v téže lobby
- [done] PDN zapíše variantu
- [done] Brána: server testy + zpětná kompatibilita
- [done] Nezávislý sub-agent review

## Auto-commit
- Phase 103: Server: PvP varianta-lobby (jádro)

## Discussion
# Phase 103 — Server: PvP varianta-lobby (jádro)

## Intent
Serverová část čtyř PvP varianta-lobby: prezence + výzvy + partie + validace tahu podle varianty.
Klientské UI čtyř místností je D3b. Uzavírá server část todo 56 (dto/store validace). Server defaultuje
na american → stávající klient beze změny hraje v americké lobby (žádná regrese).

## Key decisions
- **IDENTITA oddělená od ČLENSTVÍ (uživatel: „jedna přezdívka na program, ne na místnost, příprava na
  budoucí login").** Přezdívka = GLOBÁLNÍ identita, unikátní přes CELÝ server (jeden globální registr
  nicků, NE per-instance). Stále jen přezdížka, ŽÁDNÉ účty/hesla (non-goal držen) — je to jen seam pro
  budoucí login.
- **Členství per lobby (4 instance).** Prezence = registr `Map<VariantId, RoomPresence>` (4 členství);
  vnitřek `RoomPresence` se skoro nemění, ale nick-uniqueness se VYTÁHNE do globálního registru identit.
  Hráč (identita) je v PRÁVĚ JEDNÉ lobby, ale může PŘEJÍT do jiné (server op switchLobby) BEZ ztráty
  přezdívky/session. Cross-variant výzva padne přirozeně (vyzývaný není v lobby vyzyvatele → has() false).
- **join nese variantu (default american, zpětně kompat.).** Stávající klient bez varianty → americká
  lobby. Klient volí variantu před joinem (jako přezdívku); plné přepínání v UI je D3b, ale server op
  pro přechod mezi lobby patří sem (D3b ho jen zavolá).
- **Validace tahu = server autorita (todo-56 zbytek).** `dto` `findLegalMove`/`legalMoveDtos` dostanou
  variantu z herního záznamu → `rulesetForVariant` → `legalMoves(position, ruleset)`. `createPvp(challenger,
  challenged, variant)` nastaví GameState.variant; `store.applyMove` je pak už správný přes `advanceState`
  (čte state.variant z D0). Rematch DĚDÍ variantu staré partie.
- **PDN archiv zapíše variantu** (tag Event nebo Variant; přesný formát v do). Vize: „do PDN se zapisuje
  i varianta".
- **Nezávislý sub-agent review v plánu** (velká změna serverového kontraktu + bezpečnostní hranice).

## Watch out for
- **Nick-uniqueness JEDEN globální registr, ne 4× per-instance** — jinak by „Karel" mohl být v každé
  lobby zvlášť, což odporuje „jedna přezdívka na program". Identita (nick→session id) globální; členství
  (v které lobby) zvlášť.
- **Validace tahu je bezpečnostní hranice.** `dto.findLegalMove` MUSÍ použít ruleset varianty záznamu —
  jinak server přijme nelegální tah v dané variantě (klient je nedůvěryhodný). Toto je uzavření todo 56.
- **Zpětná kompatibilita:** stávající klient posílá join BEZ varianty → americká lobby; stávající
  PvP/room-ws testy (challenge-ws, room-ws, pvp-*-ws) MUSÍ zůstat zelené.
- **Přechod mezi lobby za běhu PARTIE:** hráč ve hře by neměl přejít do jiné lobby (jako se nemění
  varianta uprostřed hry). Hrana pro plan/do: switchLobby odmítnout / vyžadovat, že hráč není v aktivní
  partii.
- **Rematch dědí variantu** — createPvp v rematch cestě (app.ts:741) musí dostat variantu STARÉ partie,
  ne default american.
- **Roster nemusí nést variantu per-hráč** (v jedné lobby jsou všichni stejné varianty), ale klient
  (D3b) musí dostat potvrzení, do které lobby vstoupil (echo varianty v join odpovědi).

## Run report
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

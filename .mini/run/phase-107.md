---
phase: 107
verdict: done
steps:
  - title: "Sdilena konstanta + helper pro nazev varianty"
    status: done
  - title: "PvP: label varianty v panelu ovladani"
    status: done
  - title: "AIvP: label varianty v panelu ovladani"
    status: done
verify:
  - title: "Vizuální umístění a čitelnost názvu nad deskou (PvP i AIvP)"
    detail: "Ověřeno strukturálně (label je v .panel .controls, správné pořadí, skrytý oddělovač). Neověřeno okem: jak label vypadá v reálném layoutu na desktopu i mobilu (zalomení řádku ovládání, aby nerozházel tlačítka), a že bold název nepůsobí rušivě vedle „Soupeř: X\" / přepínače úrovně."
  - title: "Znění labelu v PvP („Varianta: {název}\")"
    detail: "AIvP (hra proti počítači) ukazuje na přání HOLÝ název (např. „Ruská\") – prefix „Varianta:\" tlačítka zalamoval do dvou řad. PvP zůstává s prefixem „Varianta: X\" (řádek tam nese jen „Soupeř: jméno\" a dvě tlačítka). Zvaž, jestli ti pro PvP nesedí spíš „Místnost:\" nebo taky holý název."
---

# Fáze 107 — report z auto session

## Co se udělalo
Nad oběma herními obrazovkami je teď nahoře v panelu ovládání vidět název varianty/místnosti.

1. **Sdílený zdroj + helper.** Mapu `VARIANT_LABEL_KEYS` (varianta → i18n klíč) jsem přesunul z `lobby.ts` do `i18n.ts` jako jediný zdroj a přidal export `variantLabel(variant)` = holý přeložený název. `lobby.ts` (picker i akordeon) teď volá `variantLabel()` – beze změny chování. Nový i18n klíč `game.variantLabel` = „Varianta: {variant}\" (cs) / „Variant: {variant}\" (en) obaluje název do věty.
2. **PvP** (`game-screen.ts`): v `.controls` rozdělený popisek – `.pvp-variant-label` „Varianta:" běžným ztlumeným řezem + `.pvp-variant` s TUČNÝM názvem varianty (stejný vzor jako „Soupeř:" + přezdívka). Naskočí až s **prvním pushnutým stavem** (`game.variant` z `onState`), protože `ChallengeAcceptedInfo` variantu nenese – do té doby je popisek, název i oddělovač skrytý. Chybějící/`undefined` variantu (starší stav) nechá skrytou, radši nic než špatný název.
3. **AIvP** (`app-shell.ts`): label `.game-variant`, varianta je známá hned při stavbě (`options.variant`), takže se vykreslí rovnou a je vidět stále. Na přání uživatele **holý název** (bez prefixu „Varianta:") – s prefixem se řádek ovládání (přepínač úrovně + víc tlačítek) zalamoval do dvou řad.

## Kontroly (mechanicky ověřeno)
- `pnpm -F @checkers/web typecheck` čistý, `pnpm lint` čistý, `pnpm -F @checkers/web build` OK.
- Testy: **622 passed** (přidáno 8 nových se zuby – PvP label naskočí/skryje, AIvP cs/en/default, i18n helper cs/en).
- Kontrakt: `Record<VariantId, MessageKey>` + `MessageKey = keyof cs` + `en satisfies Record<MessageKey,string>` – přidání varianty bez překladu shodí typecheck ve všech třech místech, ne tichý fallback.

## Co jsem musel opravit v testech
`app-shell.test.ts` bral přes `querySelector` **první** `.controls-divider`, který je teď před názvem varianty → test padal. Přepsal jsem ho tak, aby hledal oddělovač **mezi** přepínačem úrovně a tlačítkem (zachovává původní smysl testu, ne oslabení).

## Nezávislý self-review
Pustil jsem sub-agenta s čerstvým kontextem (kontrakt mezi moduly + rendering cesta). Bez self-catchable nálezů; dvě low poznámky bez nutnosti opravy:
- Asymetrie: PvP bez varianty label skryje, AIvP bez `options.variant` ukáže „Americká\" – obojí pravdivé (AIvP klient je na american vázaný), ne bug.
- Teoretické probliknutí v PvP, kdyby jeden push v jedné partii přišel bez `variant` po pushi s variantou – v praxi je `variant` stabilní pole verze serveru, k flapu nedojde.

## Otevřené / pro člověka
Vše mechanicky ověřitelné jsem ověřil sám. Na člověka zbývá jen vizuál a volba znění prefixu (viz `verify` výše).

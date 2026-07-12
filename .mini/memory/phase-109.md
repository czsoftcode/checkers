# Phase 109 — Lobby: oddělit AIvP a dovětek dáma

**Goal:** V lobby vizuálně oddělit místnosti od hry proti počítači: pod místnostmi nadpis Hrát proti počítači, pod ním select variant a vedle něj jen krátké tlačítko Hrát (aby se select + tlačítko vešly vedle sebe i na mobilu). K názvům variant přidat dovětek dáma (Americká dáma, Pool dáma, Ruská dáma, Česká dáma; en American/Pool/Russian/Czech checkers) v selectu i v názvech místností, ať je jasné, že jde o druh hry, ne jazyk. Klient-only: lobby.ts layout + i18n.ts + mobilni CSS. Pozn: variant.* je sdileny label, dovetek se projevi i u nazvu varianty nad deskou (faze 107).

## Steps
- [done] i18n: dovetek dama + texty AIvP sekce (cs/en)
- [done] Lobby: oddelit AIvP sekci (nadpis + oddelovac + kratke Hrat)
- [done] Mobilni CSS: select + Hrat vedle sebe

## Auto-commit
- Phase 109: Lobby: oddělit AIvP a dovětek dáma

## Run report
---
phase: 109
verdict: done
steps:
  - title: "i18n: dovetek dama + texty AIvP sekce (cs/en)"
    status: done
  - title: "Lobby: oddelit AIvP sekci (nadpis + oddelovac + kratke Hrat)"
    status: done
  - title: "Mobilni CSS: select + Hrat vedle sebe"
    status: done
verify:
  - title: "Na mobilu (portrait) select varianty + tlačítko „Hrát" zůstanou vedle sebe"
    detail: "Mechanicky ověřeno jen přes CSS (flex-wrap: nowrap, picker flex:1 1 auto + min-width:0, tlačítko flex:0 0 auto; žádný @media override .lobby-solo). Skutečné vykreslení v úzkém portrait viewportu (že se select nesmrští k nečitelnu a nepřeteče kartu) jsem nespustil – potřebuje lidské oko v prohlížeči (Herní místnosti i itch build)."
  - title: "Dovětek „dáma" nevypadá špatně u názvu varianty NAD DESKOU (fáze 107)"
    detail: "variant.* je sdílený label, takže nad deskou teď stojí „Varianta: Ruská dáma" (PvP) a v AIvP skořápce „Americká dáma". Testy na text prošly, ale subjektivní dojem (délka, zalomení v panelu) nechávám na tebe."
  - title: "Vzhled oddělovače + nadpisu „Hrát proti počítači" v lobby"
    detail: "Přidán <hr class=lobby-divider> + <h2 class=lobby-solo-heading> nad sólo řádek v obou větvích (místnost i itch). Pozn.: v disconnected pohledu (spadlé spojení) zůstává oddělovač+nadpis+sólo řádek viditelný (sólo hra proti AI funguje i offline) – oddělovač pak stojí mezi „Připojit znovu" a sólo sekcí. Zkontroluj, jestli ti to vizuálně nevadí."
---

# Fáze 109 — report z auto session

## Co se udělalo
- **i18n (i18n.ts):** k `variant.*` přidán dovětek – cs „Americká/Pool/Ruská/Česká dáma", en „American/Pool/Russian/Czech checkers". Nový klíč `lobby.soloHeading` = „Hrát proti počítači"/„Play against the computer"; `lobby.soloBtn` zkrácen na „Hrát"/„Play". Parita cs/en drží (typová kontrola `en satisfies Record<MessageKey,string>` by chybějící klíč neprošla).
- **Lobby (lobby.ts):** v obou větvích (`createLobby` i `createItchEntry`) přidán oddělovač `.lobby-divider` + nadpis `.lobby-solo-heading` nad `.lobby-solo`. AIvP tok (`onPlayVsComputer`) beze změny. Nadpis přidán i do itch větve schválně – bez něj by holé „Hrát" (sdílený `lobby.soloBtn`) ztratilo kontext.
- **CSS (styles.css):** `.lobby-solo` přepnut z `flex-wrap: wrap` na `nowrap`; picker `.lobby-variant` teď `flex:1 1 auto; min-width:0` (roztáhne se a smí se smrštit s ořezem textu), tlačítko `flex:0 0 auto` (krátké, přirozená šířka). Přidány styly oddělovače a nadpisu.

## Ověření (mechanické)
- `tsc --noEmit`: 0 chyb.
- Vitest celý web balíček: **629 passed / 0 failed** (46 souborů).
- `vite build`: prošel.
- Aktualizované testy s natvrdo zadanými popisky variant/tlačítka: `i18n.test.ts`, `i18n-variant.test.ts`, `lobby-variant.test.ts`, `lobby-i18n.test.ts` (přidán i assert na nový nadpis), `app-shell-variant.test.ts` (název nad deskou, fáze 107), `game-screen.test.ts` (PvP panel), `lobby.test.ts` (`sectionByName` teď matchuje prefixem – prefixy variant jsou jednoznačné; přesné pole názvů sekcí na plné popisky).

## Cross-module kontrakt (kontrolováno + nezávislý sub-agent)
Sdílený `variantLabel`/`variant.*` se změnou dovětku projeví všude, kde se používá: picker, názvy sekcí akordeonu, název varianty nad deskou (fáze 107, AIvP i PvP panel). To je **záměr fáze**. Ověřeno, že label NIKDE neteče do dat po drátě ani do úložiště:
- **PDN archiv** (`packages/server/src/archive.ts`) má vlastní nezávislou mapu standardních PDN názvů, na `variantLabel` nezávisí → dovětek se do PDN nepromítne.
- Po drátě/v LocalStorage jde vždy interní `VariantId`, ne label.
- `APP_TITLE` (`index.ts`, „Americká dáma") je samostatný literál, shoda s `variant.american` je náhodná, ne coupling.

Nezávislý recenzent (čerstvý kontext) potvrdil: **žádné blokující nálezy**.

## Co jsem nemohl ověřit sám
Vizuál a UX – viz `verify` výše: skutečné vykreslení řádku select+„Hrát" v úzkém portrait viewportu, dojem z dovětku nad deskou a vzhled oddělovače/nadpisu (včetně jeho pozice v disconnected pohledu). Doporučuji projít přes `/mini:verify` v prohlížeči (mobilní šířka).

## Trade-off / co může selhat
- Na **extrémně úzkém** viewportu se `min-width:0` select smrští téměř k nule dřív než krátké tlačítko – vejdou se vedle sebe (cíl fáze splněn), ale výběr může být hodně úzký (ořezaný text „Americká…"). Přijatelné pro daný cíl, ale je to reálná mez.
- V `disconnected` pohledu zůstává sólo sekce (i nový oddělovač+nadpis) viditelná. Není to regrese (sólo řádek se nikdy netoggluje – hra proti AI funguje i offline), ale oddělovač „od místností nad ním" pak stojí mezi reconnect panelem a sólo sekcí, což je sémanticky lehce nepřesné.

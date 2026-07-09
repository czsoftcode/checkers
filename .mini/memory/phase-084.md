# Phase 84 — Ruční přepínač jazyka v lobby

**Goal:** Do lobby vedle nadpisu Herní místnost přidat přepínač jazyka generovaný ze seznamu podporovaných jazyků (jeden zdroj pravdy {locale,label} v i18n.ts, forma <select>); volba se uloží do LocalStorage a má při startu přednost před detekcí prohlížeče (pořadí LocalStorage → prohlížeč → fallback en). Po přepnutí se lobby překreslí. Přidání dalšího jazyka v budoucnu = jen doplnit slovník + jednu položku do seznamu. Zubaté testy: precedence LocalStorage nad prohlížečem, uložení volby, poškozená/neznámá hodnota v LocalStorage spadne na detekci. Mimo řez: živé překreslení rozehrané hry a AI/PvP obrazovky (drží se omezení fází 81-83).

## Steps
- [done] Zdroj pravdy o jazycích v i18n.ts
- [done] LocalStorage vrstva jazyka v i18n.ts
- [done] main.ts použije resolver při startu
- [done] Přepínač <select> v hlavičce lobby
- [done] Zubaté testy i18n
- [done] Ověření

## Auto-commit
- Phase 84: Ruční přepínač jazyka v lobby

## Run report
---
phase: 84
verdict: done
steps:
  - title: "Zdroj pravdy o jazycích v i18n.ts"
    status: done
  - title: "LocalStorage vrstva jazyka v i18n.ts"
    status: done
  - title: "main.ts použije resolver při startu"
    status: done
  - title: "Přepínač <select> v hlavičce lobby"
    status: done
  - title: "Zubaté testy i18n"
    status: done
  - title: "Ověření"
    status: done
verify:
  - title: "Vizuál a umístění přepínače v reálném prohlížeči"
    detail: "Nadpis je u LEVÉHO okraje karty, přepínač u pravého, oba v toku (flex space-between, ne absolutně) – reakce na tvůj požadavek, aby na mobilu přepínač nezasahoval do nadpisu. jsdom testy ověří jen strukturu/chování, ne skutečné vykreslení. Zkontroluj na desktopu i na úzkém mobilu (portrait), že se `<select>` NEPŘEKRÝVÁ s nadpisem „Herní místnost / Game room“ a je čitelný na tmavém pozadí karty."
  - title: "Přepnutí opravdu překreslí lobby i titulek a přežije reload"
    detail: "V prohlížeči: přepni jazyk → texty lobby (nadpis, tlačítka, placeholder) I titulek záložky prohlížeče (Americká dáma / American Checkers) se ihned změní. Pak dej reload (F5) → jazyk zůstane. A ověř precedenci: když máš v prohlížeči jiný jazyk než uloženou volbu, po reloadu vyhraje uložená volba."
---

# Phase 84 — report z auto session

## Co je hotové
Ruční přepínač jazyka v lobby, datově řízený (připravený na víc jazyků).

- **`i18n.ts` — jediný zdroj pravdy `LOCALES`** (`{locale,label}`, dnes cs/en, popisky jsou endonymy „Čeština“/„English“) + guard `isLocale`. `detectLocale` teď bere podporované jazyky odsud, ne z natvrdo psaného `cs||en`. Přidání jazyka = přidat položku do `LOCALES` + doplnit oba slovníky (TS to přes `en satisfies` vynutí).
- **LocalStorage vrstva** — `loadStoredLocale()` (validace přes `isLocale`, poškozená/neznámá/chybějící/nedostupné úložiště → `null`), `saveLocale()` (selhání zápisu spolkne), `resolveInitialLocale()` s pořadím **LocalStorage → prohlížeč → fallback en**.
- **`main.ts`** — start používá `resolveInitialLocale()`; `<html lang>` hlásí reálně použitý jazyk. Do `createLobby` předává `onLocaleChange: showLobby` (rebuild lobby).
- **Přepínač v lobby** — `<select>` v hlavičce vedle nadpisu, generovaný smyčkou přes `LOCALES`, aktuální jazyk předvybraný. Změna: uloží volbu + rozepsanou přezdívku, přepne aktivní jazyk, vyžádá rebuild. Skrytý mimo `entry` view.
- **Titulek stránky** — `document.title` přesunut do i18n (`app.title`, cs „Americká dáma“ = zdroj `APP_TITLE`, en „American Checkers“). Nastavuje se v `showLobby`, takže přepnutí jazyka přepíše i záložku prohlížeče. (Přidáno na žádost uživatele po self-review.)
- **Layout hlavičky** — nadpis u levého okraje, přepínač u pravého, oba v toku (flex space-between), aby na úzkém mobilu nezasahoval do nadpisu. (Oprava na žádost uživatele.)
- **Testy** — 516 zelených (+4 nové soubory/bloky). Nový `i18n-storage.test.ts` (precedence, validace, throw z localStorage, fallback na `navigator.language`) + blok „přepínač jazyka“ v `lobby.test.ts`. Typecheck, lint, build čisté.

## Adversariální self-review (nezávislý sub-agent, čerstvý kontext)
Pustil jsem ho, protože fáze sahá na kontrakt mezi moduly (LOCALES/storage klíč sdílí `i18n`, `lobby`, `main`) a chybové cesty (`try/catch` localStorage). Nenašel žádný závažný funkční bug ani tichý falešný úspěch. Čtyři nálezy jsem zapracoval:

1. **Nepravdivé zdůvodnění v komentáři** — tvrdil jsem „v `entry` není živý WS“. Neplatí: po `nick-taken`/`error` se vrací do `entry` s otevřeným socketem. Chování je ale neškodné (rebuild socket čistě `dispose`ne, nový se otevře líně). **Opravil jsem komentáře**, ať nelžou dalšímu údržbáři.
2. **Ztráta rozepsané (neodeslané) přezdívky při přepnutí** — reálná drobná regrese (rebuild bral nick jen z `loadSavedNick`). **Opraveno**: handler teď uloží i rozepsaný nick (`saveNick`), takže ho překreslení předvyplní. Přidán zub-test.
3. **Netestovaná větev „localStorage vyhodí“** — doplněn test (spy na `Storage.prototype.getItem/setItem`, které vyhodí).
4. **Netestovaný fallback `navigator.language`** (privacy režim, prázdné `languages`) — doplněn test.

## Vědomá omezení (ne nález)
- **Mimo řez zůstává živé překreslení rozehrané hry a AI/PvP obrazovky** (drží se omezení fází 81–83). Přepínač mění jazyk jen v lobby; promítne se do partie, která se založí až potom. Kdo přepne uprostřed partie, dohraje ji v původním jazyce — očekávané.
- **Přepínač je akční jen v `entry`** (skrytý v connecting/joined/disconnected), aby rebuild nevyhodil hráče z rozjeté místnosti. Vědomé rozhodnutí, ne bug.
- **Skrytí mimo `entry` testováno jen pro `joined`** — je to jeden společný toggle podle `view !== 'entry'`, takže connecting/disconnected jedou stejnou větví.

## Rozhodnutí k zaznamenání
Byl tu jeden reálný křižovatkový trade-off: **rebuild lobby vs. překreslení textů na místě**. Zvolil jsem rebuild (jednodušší, ale ztrácí stav → proto zamčení mimo `entry` a záchrana rozepsaného nicku). Zvaž `/mini:decision` před `/mini:done`, ať je „proč rebuild, ne in-place“ zaznamenáno.

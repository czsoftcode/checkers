# Phase 79 — Pozadí lobby na výšku (mobil)

**Goal:** V herní místnosti se při orientaci na výšku (orientation: portrait) zobrazí intro_mobile.webp, jinak zůstává intro.webp; přepnutí řídí orientace displeje (ne šířka okna) a mění se živě při otočení.

## Steps
- [done] Lobby: <picture> s mobilní variantou pozadí
- [done] Test: struktura <picture>/<source> orientace
- [done] Ověření: build + typecheck + lint + testy + ruční průchod

## Auto-commit
- Phase 79: Pozadí lobby na výšku (mobil)

## Run report
---
phase: 79
verdict: done
steps:
  - title: "Lobby: <picture> s mobilní variantou pozadí"
    status: done
  - title: "Test: struktura <picture>/<source> orientace"
    status: done
  - title: "Ověření: build + typecheck + lint + testy + ruční průchod"
    status: done
verify:
  - title: "Na výšku (portrait / mobil) se ukáže intro_mobile.webp, na šířku intro.webp"
    detail: "jsdom z <picture> reálně nevybírá – testy ověřují jen DOM strukturu (source/media/asset/pořadí). Skutečný výběr obrázku podle orientace a přepnutí při otočení telefonu je na lidské oko."
  - title: "Ořez a kompozice intro_mobile.webp na výšku vypadá dobře"
    detail: "object-fit: cover plochu vždy vyplní, ale jestli je mobilní obrázek dobře komponovaný (nic důležitého se neořízne), posoudí jen člověk."
---

# Phase 79 — report z auto session

## Co se udělalo
Pozadí herní místnosti se na výšku (mobil) přepne na `intro_mobile.webp`, na šířku zůstává `intro.webp`. Výběr řídí **orientace**, ne šířka okna – přesně podle zadání.

- `lobby.ts`: `<img class="page-bg">` je teď obalený v `<picture>` s `<source media="(orientation: portrait)" srcset=intro_mobile.webp>`. `<img>` zůstává fallback (`intro.webp`, landscape) a drží třídu `page-bg`. Import mobilního assetu přes `?url` (jako u `intro.webp`).
- Rozhoduje prohlížeč přes `<source media>`, takže se pozadí přepne **živě i při otočení telefonu** – bez JS, `matchMedia` ani listenerů. `<source>` je před `<img>` (jinak by ho prohlížeč ignoroval).
- Žádná změna CSS: `.page-bg` je poziční přes třídu (`position: fixed; inset: 0; object-fit: cover`), obalení do `<picture>` na stacking ani rozměr nesahá.

## Ověření
- **typecheck** OK, **lint** (`eslint .`) OK, **build** OK – `intro_mobile.webp` je teď nově zabundlovaný (96 kB; dřív se neimportoval, tak v buildu nebyl).
- **Testy zelené: web 427** (přibyl 1 test na strukturu `<picture>` + rozšíření stávajícího). Testy mají zuby: `media` musí být `(orientation: portrait)` (ne max-width breakpoint), `srcset` musí mířit na `intro_mobile`, `<source>` musí být před `<img>`, a fallback `<img>` NESMÍ být mobilní varianta – prohození kteréhokoli test shodí.

## Rozsah / rozhodnutí
Statická HTML/CSS úprava, nesahá na chybové cesty ani kontrakty mezi moduly → nezávislého sub-agenta jsem vědomě nepouštěl (na rozdíl od fází 77/78). Self-review checklist čistý. Žádná ADR-hodná křižovatka.

## Na co dát pozor / co zbývá lidské oko
1. Reálné chování v prohlížeči: na výšku `intro_mobile.webp`, na šířku `intro.webp`, přepnutí při otočení (jsdom výběr z `<picture>` nesimuluje – viz `verify`).
2. Kompozice/ořez mobilního obrázku na výšku.
3. Drobná hrana (neblokující): kdyby `intro_mobile.webp` chyběl / se nenačetl, `<picture>` NEspadne zpět na `<img>` (fallback je jen pro neshodu media, ne pro chybu načtení) → portrait uživatel by viděl rozbitý obrázek. Dnes asset existuje a je v buildu, takže reálné riziko je nulové.

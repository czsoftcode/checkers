# Phase 32 — Mobilní rozložení panelu

**Goal:** Na úzké obrazovce (media query) panel přestane plavat přes desku a uspořádá se do sloupce: nahoře kdo je na tahu, uprostřed hlavní tlačítka vedle sebe, pod nimi hláška o remíze – aby na malém mobilu nepřekážel.

## Steps
- [done] Mobilní breakpoint: panel v toku, ne fixed
- [done] Hlavní tlačítka vedle sebe
- [done] Zarovnání: stav nahoře, hláška o remíze dole
- [done] Deska + panel se vejdou do výšky
- [done] Vizuální ověření + CHANGELOG

## Auto-commit
- Phase 32: Mobilní rozložení panelu

## Run report
---
phase: 32
verdict: done
steps:
  - title: "Mobilní breakpoint: panel v toku, ne fixed"
    status: done
  - title: "Hlavní tlačítka vedle sebe"
    status: done
  - title: "Zarovnání: stav nahoře, hláška o remíze dole"
    status: done
  - title: "Deska + panel se vejdou do výšky"
    status: done
  - title: "Vizuální ověření + CHANGELOG"
    status: done
verify:
  - title: "Chování na reálném telefonu v landscape"
    detail: "Ověřeno jen v simulovaném iframe. Breakpoint max-width:640px zachytí i malé landscape telefony (nízká výška). Tam panel NAD deskou + deska může dohromady přerůst výšku viewportu → stránka se svisle roluje (obsah je dosažitelný, NENÍ skrytý ani překrytý jako v původním fixed layoutu). Pokud ti to v landscape vadí, je to kandidát na samostatný breakpoint (max-height / orientation)."
  - title: "Subjektivní dojem rozložení na tvém telefonu"
    detail: "Layout jsem ověřil v simulovaném viewportu (iframe 320/360/390 px), ne na tvém reálném zařízení. Mrkni, jestli ti sedí velikost tlačítek a mezery."
---

# Fáze 32 — report z auto session

## Co jsem udělal
Čistě CSS změna v `packages/web/src/styles.css` – přidán blok `@media (max-width: 768px)`. Žádná změna DOM ani JS (pořadí v panelu už bylo stav → tlačítka → confirm → hláška, tj. odpovídá zadání).

(Hranice byla po ověření na žádost uživatele zvednuta z 640 px na **768 px**, aby mobilní layout dostaly i větší telefony / menší tablety, kde plovoucí panel jinak dál překrýval desku. Re-ověřeno: 720×800 bez přetečení, 390×760 bez regrese; na landscape s nízkou výškou (767×360) svislý scroll 77 px = přijatelná degradace.)

Na úzké obrazovce:
- `body` a `.game` se přepnou na svislý sloupec, `.panel` z `position: fixed` na `static` → panel se řadí do toku NAD desku, přestane ji překrývat.
- `.status` a `.offer-msg` zarovnané na střed; `.controls` z `column` na `row` s `flex-wrap`, menší padding/font, `nowrap` → tři tlačítka vedle sebe.
- `--board-size` na mobilu srazen tak, aby panel + deska nepřetekly viewport.

## Co našel a opravil nezávislý self-review (sub-agent)
Sub-agent (čerstvý kontext) trefil reálnou vadu, kterou můj první vizuální test na 360/390 px minul: **vodorovné přetečení na úzkém portrétu (~320 px)**. Příčina: `--board-size: min(70vh, 94vw)` ignoroval padding `body` (24 px), rám desky (12 px, `content-box`) i padding panelu (`.panel` nebyl `border-box`). Opraveno:
- `.panel { box-sizing: border-box }` – padding se vejde dovnitř `width`.
- `--board-size: min(70vh, calc(100vw - 1.5rem - 12px))` – strop počítá s okraji body i rámem desky.

Po opravě jsem programově změřil vodorovné přetečení v simulovaném viewportu: **0 px na 320 i 390 px** (`scrollWidth - clientWidth === 0`).

## Jak jsem ověřoval
Dev server v sandboxu není z uživatelova Chrome dosažitelný (jiná síť), `data:` URL nástroj blokuje. Ověřoval jsem tedy reálné CSS pravidla v izolovaném `iframe` (viewport = šířka iframu, takže media query ≤640 px se spustí):
- 360 px i 390 px: stav nahoře (na střed), tři tlačítka vedle sebe v jednom řádku, hláška o remíze pod nimi, panel v toku nad deskou (nepřekrývá) – vizuálně OK.
- Řádek potvrzení vzdání („Opravdu vzdát? / Ano / Zrušit") sedí vedle sebe taky.
- 320 px: tři tlačítka se přes `flex-wrap` zalomí na 2+1 (dokumentovaný fallback), bez vodorovného přetečení.
- `pnpm build` prošel po obou úpravách.

## Vědomé kompromisy
- **Tlačítka na ~320 px:** `nowrap` drží čistý jeden řádek na běžných ≥360 px (většina dnešních telefonů), ale na nejmenších (~320 px) se poslední tlačítko zalomí (2+1). Volba: čistý běžný případ vs. dokonalé nejmenší displeje. Radši 2+1 než dvouřádková tlačítka všude. Fallback nepřeteče.
- **Landscape:** viz `verify` – svislý scroll místo překryvu, přijatelná degradace, ne blocker. Neřešil jsem zvláštním breakpointem, aby fáze zůstala malá; případný landscape breakpoint je snadné doplnit později.

## Otázky / nic zásadního
Žádný rozhodovací křižovatka na ADR. Pokud budeš chtít landscape doladit, je to samostatná drobná fáze.

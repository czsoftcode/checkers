---
phase: 43
verdict: done
steps:
  - title: "Gate drag startu jen na myš"
    status: done
  - title: "Sladit komentáře a JSDoc"
    status: done
  - title: "Test: dotyk/pero netáhne, tap projde"
    status: done
  - title: "Spustit testy a ruční ověření"
    status: done
verify:
  - title: "Na reálném dotykovém zařízení kámen nejde táhnout, jen tapnout"
    detail: "jsdom nemá layout ani reálné PointerEvent, takže dotykový drag ani hit-test se automaticky netestují. Ověř na mobilu/tabletu: (1) kámen se nedá uchopit a posouvat prstem, jen ťuknutí ho vybere a druhé ťuknutí na cíl provede tah; (2) klikání/výběr funguje plynule jako před fází 42, nic se „nerozhazuje“; (3) víceskok tapem funguje; (4) pokud máš pero (stylus), chová se jako dotyk = jen tap."
  - title: "Na desktopu myší drag beze změny"
    detail: "Ověř, že tažení kamene myší (uchopení, plynulý pohyb, drop na legální pole, návrat při dropu mimo) funguje přesně jako po fázi 42."
---

# Phase 43 — report z auto session

## Co se udělalo
Tažení kamenů (drag & drop z fáze 42) je nově vyhrazené **jen myši**. V `board-view.ts`
v handleru `pointerdown` (uvnitř `attachDrag`) se změnila vstupní podmínka: gesto se
založí jen když `event.pointerType === 'mouse'` (a je to primární ukazatel s levým
tlačítkem). Dotyk i pero (`pointerType` ∈ {'touch','pen'}) `pointerdown` hned opustí a
desku ovládá výhradně `click` (tap), který se od fáze 20 nezměnil. Cíl fáze splněn:
na dotyku/peru se netáhne, na desktopu myší drag beze změny.

Komentáře u `click` bloku i JSDoc `attachDrag` sladěny s realitou (tažení jen myší).

## Nález ze self-review (opraveno v rámci fáze)
Před reportem jsem pustil nezávislý sub-agent (čerstvý kontext) na vstupní bod pointer
events. Našel reálnou, byť okrajovou regresi: reset `suppressNextClick = false;` jsem
původně nechal **až za** novým gatem, takže se pro dotyk/pero nikdy neprovedl. Na
hybridním zařízení (myš + dotyk) mohlo myší gesto ukončené `pointercancel`em (bez
následného `click`) nechat `suppressNextClick = true` a **další dotykový tap by se tiše
spolkl** (první tap by nic neudělal). Do fáze 42 se to pro dotyk resetovalo.

Oprava: `suppressNextClick = false;` je teď **před** gatem — každý stisk zruší uvízlou
supresi bez ohledu na typ ukazatele. Přidán regresní test (myší `pointercancel` → dotykový
tap musí projít); ověřeno, že má zuby — po dočasném vrácení resetu za gate test padne.

`gesture = null;` zůstal za gatem záměrně: patří k životnímu cyklu myšího gesta, dotykový
stisk by jím neměl osiřet rozjeté myší tažení.

Druhý nález sub-agenta (pointerType undefined/'' → drag vypnutý) je vědomé konzervativní
chování v souladu s cílem (raději vypnout drag na neznámém vstupu než ho omylem spustit);
reálné prohlížeče `pointerType` vždy nastaví. Neřešeno.

## Ověření
- `pnpm --filter @checkers/web test` — 182 testů zelených (15 souborů), přibyly testy pro
  touch/pen (drag se nezaloží, pohyb nic neposune, tap přes click funguje) + regresní test.
- `pnpm --filter @checkers/web typecheck` (tsc --noEmit) — čistý.
- `pnpm lint` (eslint) — čistý.
- Vizuál/UX na reálném dotyku a desktopovém dragu ověří člověk (viz `verify` výše).

## Poznámky
- Žádné rozhodnutí hodné ADR — jediná varianta byla gate podle `pointerType`, což zadání
  přímo určilo (pero = dotyk = jen tap).

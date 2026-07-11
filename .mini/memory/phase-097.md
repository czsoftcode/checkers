# Phase 97 — Notace létavého braní (formatMove)

**Goal:** Rozšířit formatMove na klouzavé braní létavé dámy: každý braný kámen ověřit na diagonálním segmentu přes raySquares místo jumpedSquareBetween, důvěřovat move.captures (Move je nese). parseMove pro flying braní VĚDOMĚ mimo řez - notace nevidí desku a z textu jako 26x10 nejdou u létavé dámy brané kameny rekonstruovat (na segmentu může stát víc kamenů); PDN se nenačítá zpět (non-goal projektu), takže nikde nechybí. Americká notace beze změny čísel (roundtrip i format testy zelené). formatMove ruleset param už existuje z B1 (prostý tah). Uzavírá notační zbytek todo 56 a DOKONČUJE fázi B (todo 57); todo 56 zůstává otevřené (state/GameState + ~8 call sites -> D).

## Steps
- [done] formatMove: flying braní přes raySquares
- [done] Golden testy formatMove flying braní
- [done] parseMove flying: doložit vědomou mezeru testem
- [done] Americká brána: notace beze změny čísel

## Auto-commit
- Phase 97: Notace létavého braní (formatMove)

## Run report
---
phase: 97
verdict: done
steps:
  - title: "formatMove: flying braní přes raySquares"
    status: done
  - title: "Golden testy formatMove flying braní"
    status: done
  - title: "parseMove flying: doložit vědomou mezeru testem"
    status: done
  - title: "Americká brána: notace beze změny čísel"
    status: done
---

# Fáze 97 — report z auto session

## Co se udělalo

**formatMove: flying větev.** V capture smyčce `formatMove` (`packages/rules/src/notation.ts`)
přibyla větev pro `ruleset.king === 'flying'`. Místo `jumpedSquareBetween` (skok o 2, americká)
se braný kámen `move.captures[i]` ověří jako člen diagonálního segmentu `raySquares(current, landing)`
a že NEleží na poli dopadu. Výstupní řetězec se nemění — `[from, ...path].join('x')`, brané pole se
nepíšou (PDN je nezapisuje). Import `raySquares` už v souboru byl (z fáze B1). Americká (`short`)
zůstala beze změny na `jumpedSquareBetween`.

Klíčová vlastnost `raySquares`: vrací pole od `from` (exkluzivně) po `to` (inkluzivně) a zastaví se
na `to`, takže pole ZA polem dopadu se do segmentu nedostanou. Proto `captured` musí ležet striktně
mezi `current` a `landing`; klauzule `captured === landing` odmítne dopad na brané pole (poslední
prvek segmentu).

**parseMove beze změny.** `parseMove` se vědomě nemění. U dlouhého létavého braní (segment > 2)
`jumpedSquareBetween` vrátí `null` a `parseMove` vyhodí `RangeError` — text jako `26x10` nejde bez
desky rozbalit na brané kameny (na segmentu může stát víc kamenů). PDN se u nás nečte zpět (non-goal),
takže mezera nikde nechybí. Krátké braní muže v poolu (segment délky 2) `parseMove` čte identicky
jako obyčejný skok — round-trip drží. Žádná cesta k tichému „vyprání" korupce: buď identita (krátké),
nebo výjimka (dlouhé).

**Testy.** V `test/flying-notation.test.ts` přibyly golden testy: dlouhé braní (`4x18`), vzdálený
dopad na témže paprsku (`4x29`), vícenásobné braní (`25x18x4`), krátké braní muže poolu (`10x19`,
segment délky 2) a dvě negativní (braný kámen mimo segment, braný kámen === dopad → `RangeError`).
Samostatný test dokládá vědomou mezeru: `formatMove` vyrobí `4x29`, ale `parseMove('4x29')` vyhodí
`RangeError`.

## Ověření

- Notační testy (flying-notation, notation, notation-roundtrip): 24 zelené.
- Celý balík `rules`: 337 testů zelených; celý workspace `pnpm test`: rules + ai(54) + server(156)
  + web(563) zelené, americká čísla beze změny.
- `pnpm typecheck` (6 balíků) a `pnpm lint` čisté.
- Nezávislý sub-agent (čerstvý kontext) prošel logiku flying větve, chybové cesty, zuby testů a
  kontrakt s `applyMove` (turecký úder) — bez reálných nálezů.

## Poznámky / vědomé kompromisy

- `formatMove` je čistě STRUKTURÁLNÍ relaxace: nevidí desku, nekontroluje, zda dřív braný kámen
  neleží na pozdějším segmentu (to `applyMove` odmítne jako „víc kamenů na segmentu"). Plnou legalitu
  drží brána `legalMoves`; notace jen věří `move.captures`. Konzistentní s dokumentovaným kontraktem
  a s americkou větví.
- `captured === undefined` je defenzivní guard zrcadlící `landing === undefined`; při shodné délce
  `captures`/`path` (kontrolováno výš) není z validních polí dosažitelný, ale drží styl souboru.

Tento krok uzavírá notační zbytek todo 56 a dokončuje fázi B (todo 57). Todo 56 (state/GameState +
call sites → fáze D) zůstává otevřené — mimo řez této fáze.

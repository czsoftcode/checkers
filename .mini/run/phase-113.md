---
phase: 113
verdict: done
steps:
  - title: "Filtr maxima v legalMoves"
    status: done
  - title: "Fixture: tři zuby maxima"
    status: done
  - title: "Brána: perft + suita + tsc"
    status: done
---

# Phase 113 — report z auto session

## Co se udělalo
1. **Filtr maxima v `legalMoves`** (packages/rules/src/moves.ts): uvnitř větve `jumps.length > 0`, samostatný blok `if (ruleset.mustCaptureMaximum)` VEDLE (ne uvnitř) stávajícího `kingCapturePriority`. Spočítá `maxCaptures = Math.max(...jumps.map(m => m.captures.length))` a vrátí MNOŽINU všech skoků s tou délkou (`filter`, ne jeden tah). Komentář vysvětluje, že jde jen o KVANTITU (FID pravidlo 7, bez vážení dámy), kvalita je IT-4, blok je flag-vázaný a běží jen při existujících skocích.

2. **Test** packages/rules/test/italian-max-capture.test.ts (styl czech-king-priority):
   - (a) 3-braní (muž 5→14→23→32, bere 9,18,27) vs disjunktní 2-braní (muž 4→11→20, bere 8,16) → ITALIAN vrátí JEN 3-braní, 2-braní CHYBÍ (adversariálně, `toEqual` na přesné pole).
   - (b) dvě rovná 3-braní (muž 1 a muž 5) → OBĚ zůstanou (množina, ne jeden tah).
   - (c) tatáž pozice jako (a) s AMERICAN_RULESET → OBĚ braní přítomná (flag-vázanost, americká netknutá).
   - Geometrie pozic jsem ověřil empiricky přes dočasný explorační skript (smazán) – první pokusy se křížily přes společné diagonály, finální řetězce jsou prokazatelně disjunktní bez postranních větví.

3. **Brána**: `tsc` čistý (všech 6 balíčků). Celá suita zelená: rules 393, cli 24, engine 268, ai 57, server 199, web 629. Perft explicitně (american/pool/russian/czech, 50 testů) zelené – čísla beze změny → aditivní filtr nezasáhl ostatní varianty.

## Self-review (nezávislý sub-agent)
Fáze sahá na veřejný vstupní bod `legalMoves` a kontrakt mezi moduly, proto jsem pustil nezávislého adversariálního sub-agenta (čerstvý kontext). Potvrdil:
- Unhappy path bezpečná: `Math.max(...spread)` běží jen uvnitř `jumps.length > 0`, každý skok má `captures.length >= 1` (leaf se pushuje jen při `path.length > 0`), takže žádné `-Infinity` ani nulové maximum.
- Aditivnost/regrese: `mustCaptureMaximum: true` má jen ITALIAN a čte ho jen `legalMoves`; ostatní varianty flag=false → blok se přeskočí, výstup bajt-identický.
- AMERICAN kontrola v (c) je validní: v pozici jsou jen muži, takže rozdíly `manCannotCaptureKing`/`king='short'` nemají co ovlivnit a `capturePriority` se nečte – jediný pozorovatelný rozdíl je `mustCaptureMaximum`.

Jediný akční nález: **zastaralá dokumentace v ruleset.ts** (komentáře tvrdily, že `mustCaptureMaximum` „spí" / `legalMoves` ho nečte). **Opraveno** na 3 místech (modulový doc, doc pole, ITALIAN doc) – nyní odráží, že maximum je aktivní od IT-3 a spí už jen `capturePriority` (IT-4). tsc po úpravě komentářů stále čistý.

## Skryté vazby pro budoucí fáze (ne chyby této fáze)
- **Pořadí filtrů kingCapturePriority → mustCaptureMaximum**: `kingCapturePriority` má `return` DŘÍV. Kdyby budoucí varianta zapnula oba flagy, přednost dámy by se vyhodnotila první BEZ aplikace maxima. Dnes nedosažitelné (Czech má jen prioritu, Italian jen maximum), komentář to přiznává. IT-4 (kompozice max + kvalita pro italskou) to musí řešit vědomě – kvalita operuje NAD max-množinou.
- Test (b) (dvě rovná 3-maxima) nemá zuby proti *smazání* filtru (obě braní projdou i bez něj) – hlídá jinou mutaci (filter→jeden tah). Regresní pojistkou proti smazání filtru je test (a).

# Phase 113 — Italská: povinné maximum braní

**Goal:** V legalMoves (packages/rules/src/moves.ts) při zapnutém mustCaptureMaximum ponechat jen skoky s MAXIMÁLNÍM počtem braných kamenů (metrika = move.captures.length přes všechny plné cesty, vyfiltrovat kratší). Striktně ADITIVNÍ větev, aktivní JEN italským flagem (mustCaptureMaximum=true) - ostatní varianty (flag=false) beze změny. Řeší JEN kvantitu (nejvíc kamenů); kvalitativní FID priorita (dáma>muž, víc dam, pořadí braní) přijde v IT-4 a NENÍ součástí této fáze. Neinteragovat se stávajícím kingCapturePriority filtrem (českou) - italská ho nemá (má capturePriority='italianFull'), ohlídat že se české chování nezmění. Brána: fixture kde 2-braní se v legalMoves NEobjeví když existuje 3-braní (adversariálně - kratší braní odmítnuto), a kde více rovných maxim zůstane zachováno; perft 1-6 american/pool/russian/czech BEZE ZMĚNY čísel; celá suita zelená; tsc čistý.

## Steps
- [done] Filtr maxima v legalMoves
- [done] Fixture: tři zuby maxima
- [done] Brána: perft + suita + tsc

## Auto-commit
- Phase 113: Italská: povinné maximum braní

## Discussion
# Phase 113 — Italská: povinné maximum braní

## Intent
Přidat do `legalMoves` (packages/rules/src/moves.ts, ř. 401-416) druhý, nezávislý, flag-vázaný filtr: při `mustCaptureMaximum=true` z posbíraných skoků ponechat jen ty s NEJVYŠŠÍM počtem braných kamenů (`max` přes `move.captures.length`), kratší vyhodit. Řeší JEN kvantitu FID pravidla 7 (nejvíc KAMENŮ, každý kámen = 1, BEZ vážení dámy). Kvalita (přednost dámou, víc dam, pořadí braní) je IT-4 a NENÍ tady. Po této fázi je italská braní = (muž nebere dámu, IT-2) + (jen maxima, IT-3), stále BEZ kvalitativní priority → italská je záměrně neúplná, testuje se jen počet.

## Key decisions
- **Výstup je MNOŽINA všech tahů s rovným maximem, ne jeden tah.** Dvě různá 3-braní → obě zůstanou legální (hráč vybírá; IT-4 pak nad touto množinou rozhodne kvalitou). Naivní „vrať nejdelší" (jeden) je ŠPATNĚ. Potvrzeno uživatelem.
- **Metrika = `move.captures.length`.** Pro italskou (extendJumps, non-turkish, `captures` drží distinct braná pole) je délka = počet kamenů, žádné dvojí počítání. Bez vážení druhu figury.
- **Dva samostatné `if` bloky, žádný společný pipeline.** Nový blok `if (ruleset.mustCaptureMaximum)` je nezávislý na stávajícím `if (ruleset.kingCapturePriority)`. V této vlně se nikdy nepotkají (italská nemá kingCapturePriority, česká nemá mustCaptureMaximum). Kompozici max+kvalita pro italskou řeší až IT-4 — TADY nekombinovat.
- Blok běží jen když `jumps.length > 0` (uvnitř existující větve povinného braní), takže `Math.max(...captures.length)` nedostane prázdné pole. Cesta prostých tahů (žádné skoky) se nedotýká.

## Watch out for
- **Regrese = hlavní bod.** Blok gated `if (ruleset.mustCaptureMaximum)`; american/pool/russian/czech mají flag `false` → přeskočí se → výstup `legalMoves` bajt-identický → perft 1-6 se nehne. Brána to musí potvrdit.
- **NEzměnit české chování** — `kingCapturePriority` blok nechat přesně jak je, nový blok vedle. Ověřit, že czech testy (czech-king-priority) zůstanou zelené.
- **Fixture se zuby:** (a) 3-braní vytlačí 2-braní z `legalMoves` (adversariálně — kratší braní se v seznamu NEobjeví); (b) dvě rovná 3-braní OBĚ zůstanou (množina, ne jeden); (c) KONTROLA: stejná pozice jako (a) s AMERICAN_RULESET nechá 2 i 3 braní (důkaz flag-vázanosti a netknuté americké).
- **Pořadí filtrů (pozn. pro IT-4):** FID aplikuje maximum PRVNÍ, kvalitu druhou. Až IT-4 přidá kvalitativní filtr pro `capturePriority='italianFull'`, musí operovat NAD množinou z tohoto maxima. Tato fáze jen produkuje max-množinu.
- **Tato fáze NESAHÁ na generátor** (moves.ts extendJumps atd.) — jen na `legalMoves`. Generační omezení (muž nebere dámu) je hotové v IT-2.

## Run report
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

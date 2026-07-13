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

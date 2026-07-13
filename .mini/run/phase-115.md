---
phase: 115
verdict: done
steps:
  - title: "Rešerše třetí-stranného oracle (timeboxed)"
    status: done
  - title: "Nezávislý italian-reference-gen.ts"
    status: done
  - title: "perft-italian.test.ts: cross-check + bod divergence"
    status: done
  - title: "Doladicí fixtury ITALIAN_RULESET"
    status: done
  - title: "Brána jádra"
    status: done
---

# Phase 115 — report z auto session

## Co se povedlo

Brána jádra italských pravidel je zelená. Přidány tři soubory v `packages/rules/test/`:

- **`italian-reference-gen.ts`** — nezávislá druhá implementace generátoru (souřadnice row/col, vlastní DFS braní přes blokery, vlastní `makeSuccessor`, FID kaskáda kvality). Z `src/` importuje jen typy a `squareToCoords` (fyzické umístění kamenů), žádnou logiku tahů.
- **`perft-italian.test.ts`** — perft brána (24 testů): fixní italská čísla hloubka 1–8 `[7,49,302,1469,7361,36473,177532,828783]`, cross-check knihovna==reference do hloubky 8, cross-check proti publikované americké 1–5, bod divergence a jeho příčina, plus 4 ručně ověřené malé pozice (knihovna==reference==ruční oracle).
- **`italian-fixtures.test.ts`** — behavior fixtury (10 testů): krátká dáma se hýbe/bere o 1 pole všemi směry i vzad, nebere přes mezeru (zuby proti POOL létavé dámě); muž se hýbe i bere jen vpřed; muž braním na dámské řadě se promění a tah končí.

**Reference sedí na knihovnu ve VŠECH hloubkách 1–8** (přesná shoda, ne dolaďování).

## Bod divergence (zdokumentováno v hlavičce testu)

Italská se od americké **poprvé rozejde v hloubce 6** (36473 vs 36768). Změřeno. Hloubky 1–5 jsou identické s publikovanými americkými čísly (7/49/302/1469/7361) — zadarmo cross-check proti třetí straně, že se italská pravidla nespouští předčasně. Příčina divergence v hloubce 6 je **výhradně pravidlo maxima** — doloženo v testu tím, že italská s vypnutým maximem i kvalitou dává v hloubce 6 přesně americké 36768 (dámy tak mělko nejsou, takže `manCannotCaptureKing` i kvalitativní kaskáda jsou inertní).

## Třetí-stranný oracle

Timeboxovaná rešerše: publikovaná italská 8×8 perft čísla z otevírací pozice **neexistují** (dostupné jen 10×10 mezinárodní a 8×8 americká). Stejně jako u pool/ruské tedy brána padá na druhou implementaci — dle plánu fáze, nezablokovalo to. Zdroj i závěr zapsán do hlavičky `perft-italian.test.ts`.

## Adversariální self-review

Fáze sahá na kontrakt mezi moduly (reference zrcadlí pravidla z `moves.ts`), proto proběhl nezávislý sub-agent s čerstvým kontextem. Mutačně potvrdil zuby (vypnutí maxima/kvality shodí konkrétní testy), ověřil nezávislost reference, mechaniku DFS (turecký úder u krátké figury, proměna-stop), ruční souřadnice pozic i logiku divergence. **Žádná konkrétní chyba.**

## Přiznaný limit (v hlavičkách obou testů)

Referenci píše týž autor jako knihovnu → je nezávislá pro **mechaniku** (souřadnice, aplikace tahu, počítání, DFS), NE pro **výklad FID kaskády kvality**. Sdílené špatné pochopení kvality (hlavně bod 4 „nejdřív braná dáma") by se v obou kódech shodlo a perft by to nechytil. Správnost kaskády proto drží ručně spočtené golden fixtury (italian-max-capture, italian-quality-priority, a ručně ověřené pozice v perft-italian brána c), NE perft. Uživatel tento limit bere na vědomí (viz discuss).

## Stav brány

Vše mechanicky ověřeno mnou: celá vitest suita zelená (rules 435, cli 24, engine 268, ai 57, server 199, web 629), `pnpm -r typecheck` čistý, eslint nových souborů čistý. Ostatní perfty (american/pool/russian/czech) i IT-2/3/4 fixtury jsou součástí zelených 435 rules testů, čísla beze změny. **Teprve teď smí italská do UI (IT-6+).**

Žádné rozhodnutí typu ADR (zvolená strategie oracle byla určena už v discuss, ne nově zde) — `/mini:decision` není potřeba.

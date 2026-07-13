# Phase 115 — Italská: perft proti FID

**Goal:** perft-italian.test.ts s hodnotami 1-6 ověřenými proti NEZÁVISLÉMU zdroji (NE vlastní výpočet zadrátovaný do testu - to nemá zuby, jen hlídá že se nezmění vlastní kód, ne že je správně). Central problem fáze = najít/postavit důvěryhodný oracle italských perft čísel; italská se od americké rozejde jakmile přijde braní různých délek (~hloubka 4-5, pravidlo maxima), takže americká čísla lze recyklovat nanejvýš pro pár nejmělčích hloubek. Oracle strategie se rozhodne v discuss (publikovaná čísla / druhá implementace / ruční ověření mělké hloubky + diferenciální cross-check s americkou). Plus explicitní doladicí fixtury: krátká dáma o 1 pole všesměr, muž i braní jen dopředu, proměna na poslední řadě UKONČÍ tah (nepokračuje jako dáma). BRÁNA JÁDRA: italská perft 1-6 sedí proti nezávislému zdroji; všechny italské fixtures IT-2..IT-4 (muž nebere dámu, maximum, FID priorita) zelené; ostatní varianty beze změny čísel; tsc čistý. Teprve po této bráně smí italská do UI. Scope-riziko: pokud nezávislý zdroj neexistuje a musí se stavět druhá implementace, může přerůst jednu fázi - pak rozdělit.

## Steps
- [done] Rešerše třetí-stranného oracle (timeboxed)
- [done] Nezávislý italian-reference-gen.ts
- [done] perft-italian.test.ts: cross-check + bod divergence
- [done] Doladicí fixtury ITALIAN_RULESET
- [done] Brána jádra

## Auto-commit
- Phase 115: Italská: perft proti FID

## Discussion
# Phase 115 — Italská: perft proti FID

## Intent
Tvrdá brána jádra italských pravidel: dokázat, že generátor (IT-2 muž nebere dámu + IT-3 maximum + IT-4 FID priorita) je SPRÁVNĚ, ne jen „nezměněný". Napsat `perft-italian.test.ts` s hodnotami ověřenými proti NEZÁVISLÉMU zdroji + doladicí fixtury na konfiguraci ITALIAN_RULESET. Teprve po zelené bráně smí italská do UI (IT-6+).

## Key decisions
- **Oracle strategie = stejná jako pool/ruská (osvědčené v projektu 2×): NEZÁVISLÁ druhá implementace.** Publikovaná 8×8 perft čísla neexistují ani pro pool/ruskou (jen 10×10 mezinárodní). Postavit NOVÝ `italian-reference-gen.ts` (packages/rules/test/) v souřadnicích (row,col), BEZ importu `moves.ts`/tabulek/číslování knihovny, s VLASTNÍ implementací: krátká dáma o 1 pole, muž vpřed, povinné braní, `manCannotCaptureKing`, `mustCaptureMaximum` (kvantita), FID kvalita (dáma>muž → víc dam → nejdřív braná dáma). Cross-check `perft(ITALIAN_RULESET)` == `perftRef` pro hloubky 1-6 (klidně hlouběji). Vzor: `pool-reference-gen.ts` (existuje), ALE italská má krátkou dámu + max + kvalitu → dedikovaný soubor, ne rozšíření pool-reference (jiná pravidla, nezaplétat).
- **Diferenciální cross-check s americkou:** změřit hloubku, kde se italská POPRVÉ rozejde od americké (7/49/302/1469/7361/36768). Do té hloubky italská == americká (žádné braní s volbou / žádná dáma → max/kvalita/man-king se nespustí) = zadarmo ověření proti PUBLIKOVANÉMU americkému zdroji, že se pravidla nespouští, když nemají. Dokumentovat bod divergence (jako perft-czech/pool/russian).
- **Třetí-stranný oracle: ZKUSIT dohledat v `do`** (jiný italský engine / publikovaná partie s perftem). Uživatel to chce. Rychlá rešerše; pokud se něco najde → extra cross-check (zlato). Pokud ne → fallback na reference-gen jako u pool/ruské (NE blokovat fázi na neexistujícím zdroji).
- **Doladicí fixtury** (levné, oddělené od perftu): krátká dáma se hýbe/bere o 1 pole VŠEMI směry; muž se hýbe i bere JEN vpřed; muž na poslední řadě se promění a tah KONČÍ (nepokračuje jako dáma). Většina je konfigurace ITALIAN_RULESET → potvrdit chování.

## Watch out for
- **ZÁSADNÍ LIMIT NEZÁVISLOSTI:** druhá implementace píše TÝŽ autor. Sdílené ŠPATNÉ pochopení FID pravidla 7 (hlavně klauzule 4 „nejdřív braná dáma") by se v obou kódech SHODLO na špatném čísle a perft by to NECHYTIL. Reference-gen je nezávislý pro MECHANIKU (souřadnice, počítání, aplikace tahu), NE pro VÝKLAD pravidel. Správnost klauzule 4 stojí na FID textu + ručních fixturách (IT-4 + zde), ne na perftu. Uživatel tento limit bere na vědomí; proto se navíc zkouší třetí-stranný oracle.
- **Reference-gen NESMÍ importovat nic z `src/` pro logiku tahů** (jinak není nezávislý). Smí sdílet jen typy/pomůcky pro převod pozice (jako `fromPosition` v pool-reference).
- **Zafixovaná čísla se NESMÍ „doladit" podle generátoru** — nesedící číslo = chyba v generátoru NEBO v reference-genu, řeší se hledáním rozdílu, ne přepsáním očekávané hodnoty (viz hlavička perft-russian).
- **Ostatní varianty:** perft american/pool/russian/czech beze změny čísel; tato fáze do `src/` sahá jen minimálně (možná vůbec — hlavně testy + reference-gen). Pokud „doladění" odhalí chybu v ITALIAN_RULESET/moves.ts, oprav a znovu proženeš celou bránu.
- **Scope-riziko:** stavba reference-genu s max+kvalitou je největší kus; je náročnější než pool/ruská (ty nemají max). Projekt to ale 2× zvládl v jedné fázi. Kdyby přerostlo, rozdělit (reference-gen zvlášť od doladicích fixtur). Perft strop knihovny = 12 (`MAX_PERFT_DEPTH`); hlubší běhy do commitu nedávat kvůli času (viz perft-russian hloubky 9-10 ověřené ručně mimo commit).

## Run report
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

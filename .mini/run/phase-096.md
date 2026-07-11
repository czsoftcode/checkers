---
phase: 96
verdict: done
steps:
  - title: "Protáhnout ruleset do perft"
    status: done
  - title: "Web research: zafixovat ruský perft zdroj"
    status: done
  - title: "Otevírací perft pool vs ruská (brána a)"
    status: done
  - title: "Druhá nezávislá implementace generátoru"
    status: done
  - title: "Perft z pozic s dámami vs druhá impl (brána b)"
    status: done
  - title: "Nezávislý sub-agent review pravidlových předpokladů"
    status: done
---

# Fáze 96 — report z auto session

## Co se povedlo

**Ruleset do perft (krok 1).** `perft(position, depth, ruleset = AMERICAN_RULESET)` předává ruleset do `legalMoves` i `applyMove`. Americká perft 1–6 zůstala BEZE ZMĚNY (defaultní ruleset), všech 12 stávajících perft testů zelených.

**Našel a opravil jsem REÁLNOU chybu v generátoru pool.** Web research pravidel (kroky 2) potvrdil z primárních zdrojů (Wikipedia American Pool Checkers, draughts.github.io, Russian draughts): v pool checkers se muž, který během braní dosáhne dámské řady, promuje a **KONČÍ tah** — nepokračuje, i kdyby další braní geometricky šlo (APCA doslova: „turns into a king and stops, even if it is possible to continue the capture"). Generátor po fázi 95 tuto zarážku NEMĚL: protože pool bere i vzad, muž po dopadu na dámskou řadu nelegálně pokračoval jako muž. Empiricky doloženo: pozice s černým mužem 22 vracela `{from:22,path:[31,24],captures:[26,27]}` místo správného `{from:22,path:[31],captures:[26]}`. Tj. **premisa fáze „pool je po fázi 95 pravidlově kompletní" NEPLATILA.**

Oprava: v `moves.ts extendJumps` bezpodmínečná zarážka „muž na proměnné řadě braním končí". Pro americkou variantu je no-op (muž bere jen vpřed, z poslední řady skok vpřed není → americká čísla bajt-identická, ověřeno). `PROMOTION_ROW` jsem vytáhl do `board.ts` jako jediný zdroj pravdy sdílený `apply.ts` i `moves.ts` (dřív žil jen v apply.ts). Přidán `POOL_RULESET`.

**Druhá nezávislá implementace (krok 4)** — `test/pool-reference-gen.ts`. Záměrně JINÁ struktura: souřadnice (row,col) na mřížce 8×8, žádné tabulky NEIGHBORS/JUMPS ani číslování 1–32, vlastní aplikace tahu (rovnou následnické pozice), turecký úder přes blokery UNIFORMNĚ i pro muže (moves.ts u muže odebírá okamžitě a spoléhá na paritní argument — cross-check tedy reálně ověřuje i ten).

**Brána (a) — otevírací perft.** Publikovaná ruská 8×8 čísla se NENAŠLA (dostupné jsou jen 10×10 mezinárodní, World Draughts Forum), takže podle plánu fáze brána (a) padá na druhou implementaci. Pool perft 1–8 = [7, 49, 302, 1469, 7482, 37986, 190146, 929902], moves.ts == referenční impl na všech hloubkách. Pool se od americké liší už v hloubce 5 (7482 vs 7361) → braní muže vzad se prokazatelně zapojilo.

**Hranice divergence pool↔ruská** stanovena, ne odhadnuta: první braní muže končící na dámské řadě se v otevíracím stromu objeví až v hloubce 7 (měřeno detektorem `hasManCaptureToPromo`). Do hloubky 6 se pool a ruská PROKAZATELNĚ shodují (jediný rozdíl — proměna uprostřed braní — vůbec nenastane). Test to zabíjí regresí.

**Brána (b) — pozice s dámami.** Tři ručně postavené pozice (klouzavá dáma s volbou dopadu; turecký úder — lomené dvojité braní `{path:[9,2],captures:[14,6]}`; mix mužů a dam), moves.ts == referenční impl do hloubky 5. Reálně prořezává riziko fáze 95.

**Zuby ověřeny reálným rozbitím:** po dočasném vyřazení zarážky padnou právě 2 testy proměny-stop; po obnovení projdou. Cross-check má zuby proti regresi generátoru; explicitní test navíc dokazuje, že zarážka větev reálně mění (perft 2 vs 0 bez pravidla).

## Nezávislý sub-agent review (krok 6)

Čerstvý kontext potvrdil všechny 4 pravidlové předpoklady proti primárním zdrojům včetně nejcitlivějšího (stop při proměně). Žádnou pravidlovou CHYBU nenašel. Tři upozornění, dvě jsem rovnou zapracoval:
- **Zuby zarážky byly úzké** (jediná pozice, velká fixtura ji nechrání). → Přidal jsem DRUHOU pozici (bílý muž, zrcadlová barva i směr). Geometricky má muž z dámské řady nejvýš jednu pokračovací větev, proto se šíře dělá druhou pozicí, ne víc směry.
- **Cross-check nedokazuje správnost pravidel** (obě impl sdílejí výklad autora — tu drží jen externí zdroje). → Explicitně dopsáno do hlavičky i do bloku proměny.
- **Latentní past (nezapracováno, mimo řez):** budoucí `RUSSIAN_RULESET` by měl stejnou konfiguraci jako `POOL_RULESET` a tiše dostal pool chování. Než se ruská přidá, musí vzniknout pole typu `promoteMidCapture`. Zdokumentováno v komentářích `ruleset.ts` i `moves.ts`.

## Co zůstává otevřené / na vědomí

- **todo 56 i 57 zůstávají otevřené** (dle discuss): notace flying braní (B2b), varianta v GameState/metadatech + ~8 call sites → fáze D. Tato fáze zavřela jen perft-threading z todo 56, todo se nezaškrtává.
- **Ruská proměna uprostřed braní (pokračování jako dáma) NENÍ implementována** — mimo řez. Zarážka „muž stop" je správná pro pool i americkou, pro ruskou bude potřeba přepnout.
- Celý monorepo zelený: rules 330, cli 24, engine 250, ai 54, server 156, web 563; lint + typecheck OK.

## Doporučení

Před `/mini:done` spusť **`/mini:decision`** — fáze obsahuje reálné křižovatky hodné ADR: (1) premisa „pool kompletní po fázi 95" neplatila, chybu jsem opravil V RÁMCI fáze místo blokace; (2) publikovaný ruský zdroj se nenašel → brána (a) vědomě padla na druhou implementaci; (3) zarážka proměny je bezpodmínečná (bez pole v Rulesetu) s dopadem na budoucí ruskou variantu.

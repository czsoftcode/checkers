# Phase 96 — Perft pro pool + externí ověření

**Goal:** Protáhnout ruleset do perft (zbytek todo 56 pro perft) a přidat perft fixture pro pool checkers ověřenou proti JEDNOMU zafixovanému externímu zdroji; strategii zdroje zafixovat v discuss (kandidát: publikovaná ruská perft čísla, která se s poolem v mělkých hloubkách prokazatelně shodují do hloubky, kde poprvé může nastat proměna uprostřed braní - s dokumentovanou hranicí divergence; záloha: nezávislá druhá implementace generátoru jako cross-check). Pool je po fázi 95 pravidlově kompletní na úrovni knihovny. Notace flying braní (B2b) NENÍ součástí. Řez z todo 57 (fáze B); todo 56 i 57 zůstávají otevřené (state/GameState + call sites -> D).

## Steps
- [done] Protáhnout ruleset do perft
- [done] Web research: zafixovat ruský perft zdroj
- [done] Otevírací perft pool vs ruská (brána a)
- [done] Druhá nezávislá implementace generátoru
- [done] Perft z pozic s dámami vs druhá impl (brána b)
- [done] Nezávislý sub-agent review pravidlových předpokladů

## Auto-commit
- Phase 96: Perft pro pool + externí ověření

## Discussion
# Phase 96 — Perft pro pool + externí ověření

## Intent
Dát perftu povědomí o variantě (protáhnout `ruleset` do `perft` → `legalMoves`/`applyMove`;
dnes volá bez ruleset = vždy americká) a OVĚŘIT, že generátor pro pool počítá správně.
Perft = detektor chyb generátoru: spočítá počet listů stromu legálních tahů do hloubky N;
shoda s nezávislým zdrojem (byť o 1 uzel) = generátor korektní. Nesouvisí se sílou AI ani
hloubkou searche. Pool je po fázi 95 pravidlově kompletní na úrovni knihovny.

## Key decisions
- **DVOJITÁ brána (potvrzeno uživatelem).** Otevírací perft SÁM O SOBĚ je slabý test: otevírací
  pozice nemá dámy a ty se objeví až hluboko (~10+ tahů po proměně), takže perft 1-6 z otevření
  testuje hlavně tahy mužů + braní vzad, ale KLOUZAVÉ BRANÍ LÉTAVÉ DÁMY (riziko fáze 95) skoro vůbec.
  Proto:
  - (a) **Otevírací perft** pool 1-N proti PUBLIKOVANÝM RUSKÝM číslům (pool a ruská se v mělkých
    hloubkách shodují, dokud nemůže nastat proměna uprostřed braní; hranici divergence zdokumentovat).
    Ověří celkovou mašinérii + braní mužů vzad.
  - (b) **Perft z RUČNĚ POSTAVENÝCH pozic S DÁMAMI** na desce, aby se klouzavé braní reálně prořezalo.
    Publikovaná čísla nemají → ověřit NEZÁVISLOU DRUHOU IMPLEMENTACÍ generátoru (nebo ručně dopočtenými
    uzly).
- **Zdroj (potvrzeno).** Primárně najít a zafixovat JEDNA publikovaná ruská perft čísla (web research).
  Druhá implementace jako cross-check jen pro (b) a jako ZÁLOHA, když se pro (a) autoritativní zdroj
  nenajde.
- **Notace flying braní (B2b) NENÍ součástí.** todo 56 i 57 zůstávají otevřené (state/GameState +
  ~8 call sites → fáze D). B3 zavírá jen perft-threading z todo 56 (ale todo 56 se nezaškrtává).

## Watch out for
- **Druhá implementace nechytne chyby VÝKLADU pravidel** — píše ji stejná hlava se stejným slepým
  místem, chytne jen mechanické chyby. Publikovaná čísla jsou nezávislá na mém pochopení pravidel →
  proto primárně ona; druhá impl je slabší záchrana.
- **Předpoklad k OVĚŘENÍ, ne gospel:** pool se od ruské liší JEN proměnou uprostřed braní (Russian ano,
  pool ne; pool promuje na konci tahu = dnešní apply.ts). Pokud je enumerace rozdílů neúplná, shoda
  perftu pool↔ruská je neplatná. Ověřit proti zvolenému zdroji PŘED použitím čísel.
- **Hranice divergence pool↔ruská** (hloubka, kde poprvé může nastat proměna uprostřed braní z otevření)
  musí být stanovena, ne odhadnuta — pod ní čísla platí, nad ní ne. Zdokumentovat v fixtures.
- **`MAX_PERFT_DEPTH = 12` je jen pojistka proti zamrznutí** (perft roste exponenciálně), NE nastavení
  síly. Neplest s AI strop hloubky 12 (jiný, nezávislý mechanismus).
- **Web research na perft čísla:** zdroje se liší důvěryhodností; zafixovat JEDEN a zapsat ho do
  fixtures jako referenci (princip vize "jeden zdroj na variantu").

## Run report
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

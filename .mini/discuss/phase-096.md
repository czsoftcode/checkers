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

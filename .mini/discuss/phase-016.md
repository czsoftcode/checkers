# Phase 16 — Poziční evaluace + self-play harness

## Intent
Dvě věci, nestejně těžké:
1. Silnější poziční evaluace enginu: k dnešnímu materiálu + zadní řadě + postupu
   (`evaluate.ts`) přidat mobilitu, kontrolu dvojitého rohu a soudržnost zadní řady.
2. Self-play harness jako brána: nová evaluace vs. stará, párované partie se
   střídáním barev a randomizovanými zahájeními, s DOKAZATELNÝM náskokem.

Pozor: dáma je při bezchybné hře remíza → dvě podobně silné evaluace většinou
remizují. Bez správně postaveného harnessu (randomizace + metrika + šumový práh)
brána nic nezměří. Harness je zrádnější část fáze než evaluace sama.

## Key decisions
- **Brána na FIXNÍ HLOUBKU, ne na čas.** Nová evaluace bude dražší (hlavně
  mobilita) → za stejný čas mělčí hloubka. Fixní hloubka izoluje kvalitu
  evaluace od její rychlosti. Rychlost měřit zvlášť jako informativní telemetrii
  (uzly/s, čas na tah), NE jako součást pass/fail brány.
- **Evaluace se do searche INJEKTUJE jako parametr** (`searchRoot`/`negamax`/
  `searchTimed` dostanou eval funkci) s výchozí hodnotou = produkční `evaluate`,
  aby se produkční cesta tvarově nezměnila. NE zamrazit kopii staré evaluace do
  testu – to by testovalo kopii, ne reálný kód (checklist bod 3/4).
- **Kritérium brány = přísné, opřené o kontrolní běh:**
  - Nejdřív KONTROLNÍ běh stará-vs-stará (stejné N, stejná zahájení) → změří
    reálný šum harnessu (očekává se ~50 %).
  - Nová-vs-stará musí: (a) NEmít regresi (neprohrát víc partií, než vyhraje)
    A ZÁROVEŇ (b) skóre (výhra 1, remíza 0,5) měřitelně nad šumovým pásmem
    (orientačně ≥ 55 %). Přesné číslo + případné navýšení N doladit v plan
    podle toho, co kontrolní běh ukáže.
- **Randomizace zahájení: k rozhodnutí v plan.** Princip: zahrát pár náhodných
  úvodních půltahů ze seedu → startovní pozice, TU SAMOU dát oběma barvám
  (color swap), aby se odečetla výhoda tahu. Počet úvodních půltahů (návrh 2–6)
  doladit v plan.

## Watch out for
- **Celočíselné skóre je tvrdý kontrakt.** Search stojí na triku okna `best - 1`
  (`search.ts:30-34`), který funguje jen s celými skóre. Každá nová váha
  evaluace = celé číslo, žádné float bonusy.
- **Mobilita – cena.** `negamax` volá `legalMoves(position)` UŽ před evaluací
  (`search.ts:168`, detekce povinného braní) a evaluace běží jen v klidných
  listech (bez skoků). → mobilitu STRANY NA TAHU jde dostat skoro zadarmo z už
  vygenerovaných tahů; extra cena je jen za mobilitu SOUPEŘE (generace pro
  druhou barvu). V plan rozhodnout: jednostranná mobilita zdarma vs. oboustranná
  za cenu jedné generace navíc.
- **Dvojitý roh – definovat pole v číslování TOHOTO projektu** (1–32,
  `squareToCoords`, řada 0 = zadní řada černého nahoře) a nechat uživatele
  ověřit v plan.
- **Soudržnost zadní řady** – dnes existuje bonus za jednoho muže na zadní řadě
  (`BACK_ROW_BONUS`). Začít jednoduše (zobecnit na počet vlastních mužů držených
  vzadu, dokud to má smysl – soupeř má co proměnit), složitější obranné vzory
  (most/phalanx) jen pokud bude potřeba. Přesně v plan.
- **Harness jako skript vs. vitest test – rozhodnout v plan.** 200+ partií na
  fixní hloubce může být pomalé; zvážit standalone skript (pnpm) pro bránu +
  lehčí smoke test do CI, aby CI nezhrublo.
- **Todo 15 se NEodškrtává** (`--from-todo` se nepoužil) – z položky zbývá
  transpoziční tabulky + Zobrist hash na navazující fázi.

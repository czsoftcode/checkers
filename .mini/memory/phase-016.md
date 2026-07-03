# Phase 16 — Poziční evaluace + self-play harness

**Goal:** Engine dostane silnější poziční evaluaci (mobilita, kontrola dvojitého rohu, soudržnost zadní řady) a vznikne self-play harness (nová vs. stará evaluace, >=200 partií, střídání barev, randomizovaná zahájení) - brána: nová evaluace prokazatelně vítězí nad starou.

## Steps
- [done] Injektovatelná evaluace do searche
- [done] Evaluace v2: mobilita, dvojitý roh, zadní řada
- [done] Randomizovaná párovaná zahájení
- [done] Self-play harness (modul + skript)
- [done] Brána: kontrolní běh + srovnání nové vs. staré

## Auto-commit
- Phase 16: Poziční evaluace + self-play harness

## Discussion
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

## Run report
---
phase: 16
verdict: done
steps:
  - title: "Injektovatelná evaluace do searche"
    status: done
  - title: "Evaluace v2: mobilita, dvojitý roh, zadní řada"
    status: done
  - title: "Randomizovaná párovaná zahájení"
    status: done
  - title: "Self-play harness (modul + skript)"
    status: done
  - title: "Brána: kontrolní běh + srovnání nové vs. staré"
    status: done
---

# Fáze 16 — report z auto session

## Nejdůležitější: brána skončila FAIL (a je to platný výsledek)

Cíl fáze byl postavit měřicí aparát a prokázat, že evaluace v2 je silnější než v1.
**Aparát je hotový a funguje; převahu v2 se prokázat NEPODAŘILO.** To diskuse
(`.mini/discuss/phase-016.md`) předem označila za legitimní konec fáze, ne za chybu.

Naměřeno (self-play, fixní hloubka, N = 200 partií na zápas, párovaná zahájení
se střídáním barev):

| Hloubka | Kontrola v1-vs-v1 | Experiment v2-vs-v1 | Práh | Verdikt |
|--------:|-------------------|---------------------|------|---------|
| 4 | 46,8 % (38V/111R/51P) | 49,0 % (38V/120R/42P) | ≥ 57,1 % | FAIL |
| 5 | 51,5 % (33V/140R/27P) | 48,8 % (20V/155R/25P) | ≥ 55–57 % | FAIL |

- v2 nemá měřitelnou převahu – na obou hloubkách má dokonce **o pár proher víc
  než výher** a hlavně **výrazně víc remíz** (155/200 na hloubce 5). Poziční
  složky v tomto nastavení vah dělají engine remízovějším a marginálně slabším.
- v2 je **2–3× pomalejší** (mobilita počítá `legalMoves` dvakrát) – informativní
  telemetrie, není součást pass/fail kritéria (proto fixní hloubka, ne čas).
- Kontrola v1-vs-v1 zůstala v pásmu sanity (odchylka od 50 % pod limitem),
  takže harness NENÍ systematicky vychýlený – FAIL je reálný signál, ne artefakt.

## Co vzniklo

- **Injektovatelná evaluace do searche** (`search.ts`): `searchRoot`/`negamax`/
  `searchTimed` berou `EvalFn`, produkční default zůstává `evaluate` na všech
  cestách. Testy dokazují, že podstrčená evaluace mění výběr tahu (i na časované
  cestě `searchTimed`).
- **`evaluateV2`** (`evaluate.ts`): materiál + postup + podmíněná zadní řada
  (bonus jen dokud má soupeř muže k proměně) + dvojitý roh (pole 4/8, 25/29) +
  mobilita. Vše celočíselné (kontrakt okna `best − 1`). Unit testy na každou
  složku + jeden exaktní literálový test (chytí i špatnou hodnotu vah).
- **Self-play harness** (`selfplay.ts`, interní, ne v public API): randomizovaná
  párovaná zahájení, `runMatch` na fixní hloubce, reprodukovatelné, telemetrie.
- **Gate skript** (`scripts/selfplay-gate.ts`, `pnpm selfplay-gate [N] [hloubka]`):
  kontrolní běh + experiment, N-aware práh, odlišené exit kódy.

## Ověřeno mechanicky

- Celá sada enginu: **136 testů zelených** (bylo 109), brána M3 stále 100/100.
- `typecheck` + `lint` celého workspace čisté (do tsconfigu enginu přidán `scripts`).
- Gate exit kódy empiricky: 0 = PASS, 1 = FAIL, 2 = špatný argument; 3 = neočekávaná
  chyba (strukturálně oddělený try/catch – crash se nemaskuje jako FAIL).

## Nezávislý self-review (sub-agent, čerstvý kontext) — co jsem zapracoval

Před reportem proběhl adversariální self-review. Opraveno:
- **[nález 1, vážné] Kolize exit kódu** crash vs. legitimní FAIL – oba dřív exit 1.
  Teď má neočekávaná chyba kód 3 + stack; 0/1/2 jsou jen pro verdikt/argument.
- **[nález 2, vážné] Metodika prahu** – práh visel na jednom šumovém běhu kontroly.
  Přepsáno: práh = 50 % + 2σ (σ ≈ 0,5/√N), kontrola je teď jen sanity check
  harnessu (podezřelý → blokuje PASS), ne vstup do prahu.
- **[nález 4] Injektáž do `searchTimed`** byla netestovaná – doplněn test.
- **[nález 5] Testy evaluace** neuměly chytit špatnou váhu – doplněn literálový test.
- **[nález 6] Parsování argumentů** brалo `1e3`/`0x10` – teď striktně `^\d+$`.

Zdokumentováno, NEopraveno (vědomě mimo rozsah fáze – patří k rozhodnutí o dalším směru):
- **[nález 3, střední] Mobilita přes `legalMoves` obrací znaménko**, když má soupeř
  povinné braní (typicky když můj kámen visí): `oppMoves` je malé → term mě
  „odmění" v pozici, kde hrozím ztrátou materiálu. Je to jedno z pravděpodobných
  vysvětlení, proč v2 neprokázala převahu. Označeno v kódu jako známý defekt.

## Trade-offy a na co si dát pozor dál

- **v2 je jen kandidát, ne vítěz.** Před uzavřením směru je potřeba ROZHODNOUT:
  buď ladit v2 (opravit mobilitu dle nálezu 3, přenastavit váhy a znovu spustit
  bránu), nebo v2 opustit a jít rovnou na transpoziční tabulky + Zobrist (zbytek
  todo 15). Harness je připravený obojí změřit.
- **Plná brána trvá minuty** (hloubka 5, N=100 → 400 partií ≈ 8–9 min; hloubka 6
  ≈ 16 min). Default skriptu je hloubka 6 / 100 zahájení; pro rychlou iteraci
  volej menší N/hloubku (`pnpm --filter @checkers/engine selfplay-gate 30 4`).
- **Mobilita je drahá** (2× `legalMoves` na list). Kdyby se v2 dostala do produkce,
  zpomalí engine 2–3× → mělčí hloubka za stejný čas. Fixní-hloubková brána tenhle
  náklad NEvidí; reálná síla na čas může být horší, než hloubková brána naznačuje.
- **Todo 15 zůstává otevřené** – z položky zbývá TT + Zobrist na navazující fázi.

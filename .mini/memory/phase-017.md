# Phase 17 — Transpoziční tabulky + Zobrist hash

**Goal:** Search dostane Zobrist hash pozice a transpoziční tabulku (exact/lower/upper bound se správnou kontrolou hloubky), integer-safe; brána = měřitelný pokles prohledaných uzlů na fixní hloubce při zachování stejného nejlepšího tahu (TT vs. bez TT souhlasí na sadě pozic).

## Steps
- [done] Zobrist tabulka + hash pozice
- [done] TT datová struktura
- [done] Napojení TT do negamax + počítání uzlů
- [done] Korektnostní testy TT vs. bez TT
- [done] Brána: skript úbytku uzlů + orientační čas

## Auto-commit
- Phase 17: Transpoziční tabulky + Zobrist hash

## Discussion
# Phase 17 — Transpoziční tabulky + Zobrist hash

## Intent
Zbývající kus todo 15: search dostane Zobrist hash pozice + transpoziční
tabulku (TT), aby přes transpozice ubylo prohledaných uzlů → hlubší search za
stejný čas. Poziční evaluace (druhá půlka todo 15) je hotová z fáze 16. Cíl
této fáze je RYCHLOST/hloubka, ne síla evaluace.

Hashuje se `Position` = `board` (32 polí, každé `null | {color, kind}`, tj. 4
typy kamene × 32 polí) + `turn`. Hash žije JEN v enginu; `Position` ani balík
`rules` se NEmění (sdílí je server/klient, žádný důvod je zatěžovat).

## Key decisions
- **Přesnost kořene je tvrdý kontrakt.** Kořen (`search.ts:150-170`) sbírá
  VŠECHNY tahy se shodným nejlepším skóre — podklad pro tie-break a kalibraci
  remíz. Trik okna `best - 1` funguje jen s PŘESNÝMI skóre; TT vrací meze
  (lower/upper). → TT čte i píše JEN uvnitř `negamax` (ply ≥ 1). Kořen zůstává
  přesný jako dnes, z TT bere maximálně pořadí tahů (zkusit uložený nejlepší
  jako první), NE skóre/cutoffy.
- **Brána na MNOŽINU tahů, ne na jeden tah.** Brána porovnává celou množinu
  `bestMoves` A skóre mezi TT-on a TT-off na sadě fixtures a několika fixních
  hloubkách. Rozejití = FAIL (TT porušila přesnost kořene). Vedle toho brána
  měří úbytek prohledaných uzlů (musí prokazatelně klesnout).
- **Klíč = 53-bit číslo** (JS `number`), ne BigInt. Rychlé, bez alokace na
  horké cestě. Vědomě přijatá mizivá šance kolize (~10⁻⁵ na dlouhém běhu) —
  pro hloubky 5-6 v pohodě. Zobrist hodnoty tedy 53-bit celá čísla.
- **Hashování PŘEPOČTEM z 32 polí v každém uzlu** (zatím), ne inkrementálně.
  Jednodušší; inkrement (XOR rozdílu z tahu: kámen, braní, proměna, obrat
  strany) je pozdější optimalizace, když bude potřeba.
- **Životnost TT:** jedna tabulka na volání `searchTimed`, sdílená napříč
  iterativním prohlubováním (hlavní zisk), na začátku KAŽDÉHO volání vyčištěná.
  Bez stárnutí záznamů / bez držení přes partii (nedeterminismus, složitost) —
  do v1 ne.
- **Struktura TT:** pole PEVNÉ velikosti (index = otisk mod velikost), náhrada
  „preferuj hlubší záznam", při ČTENÍ ověřit plný klíč (kvůli kolizím kbelíku).
  Předvídatelná paměť — engine má tvrdý timeout, `Map` rostoucí s unikátními
  pozicemi by mohl na dlouhém přemýšlení nafouknout paměť.
- **Orientační měření času** (čas-do-hloubky) přidat vedle brány jako
  NEblokující kontrolu — ať neodešleme TT, co je na hodinách pomalejší, i když
  uzlů ubylo.

## Watch out for
- **Node-gate ≠ zrychlení na hodinách.** Brána měří úbytek uzlů; režie
  hashování (přepočet 32 polí/uzel) + čtení TT ji může sežrat. Reálná síla na
  čas může být horší, než úbytek uzlů naznačuje → proto orientační měření času.
- **Tři typy záznamu (exact / lower / upper) jsou notorický zdroj tichých
  chyb**: špatná kontrola hloubky (použít záznam jen když `entry.depth >=
  zbývající hloubka`), špatné určení typu meze (fail-high → lower, fail-low →
  upper, jinak exact), návrat skóre z jiné hloubky. Chce to cílené testy
  (search s TT vs. bez TT musí na fixtures vrátit stejnou množinu bestMoves i
  skóre), ne „běží to".
- **Kolize kbelíku vs. kolize klíče.** Ověření plného 53-bit klíče při čtení
  chytne kolizi kbelíku (dvě pozice, stejný index), NE kolizi klíče (dvě pozice,
  stejný 53-bit otisk) — ta zůstává vědomě přijatým rizikem (viz rozhodnutí o
  klíči).
- **Skóre zůstávají CELÁ čísla** (kontrakt z evaluate.ts / trik okna `best-1`).
  TT nesmí zavést žádné float.
- **WIN_SCORE - ply záznamy:** skóre výhry závisí na `ply` (vzdálenost od
  kořene). Uložit/číst mat-skóre přes TT bez korekce na ply je klasická chyba
  (mat v jiné hloubce). Buď mat-skóre v TS neukládat/nepoužívat pro cutoff, nebo
  korigovat o ply — rozhodnout v plan.

## Run report
---
phase: 17
verdict: done
steps:
  - title: "Zobrist tabulka + hash pozice"
    status: done
  - title: "TT datová struktura"
    status: done
  - title: "Napojení TT do negamax + počítání uzlů"
    status: done
  - title: "Korektnostní testy TT vs. bez TT"
    status: done
  - title: "Brána: skript úbytku uzlů + orientační čas"
    status: done
---

# Phase 17 — report z auto session

Transpoziční tabulka + Zobrist hash jsou hotové. Brána fáze (úbytek uzlů + shoda
výsledků) je **PASS**. Nezávislý self-review (čerstvý kontext) i vlastní testy
potvrzují, že TT nemění výsledek fixní hloubky.

## Co vzniklo
- `src/zobrist.ts` — 53-bit Zobrist hash (poloviny hi 21 b / lo 32 b, XOR,
  složení `hi*2^32 + lo` < 2^53). Přepočtem z 32 polí na uzel (ne inkrementálně).
- `src/transposition.ts` — TT pevné velikosti (2^20), index `klíč % velikost`,
  ověření plného klíče při čtení, náhrada „preferuj hlubší".
- `src/search.ts` — TT napojená do `negamax` (nekořen, jen `depth ≥ 1`), počítání
  uzlů, `searchTimed` vytváří TT a sdílí ji přes iterace.
- Testy: `zobrist.test.ts` (9), `transposition.test.ts` (7), `search-tt.test.ts`
  (61). Celý engine: 213 testů zelených, lint + typecheck čisté.
- Brána: `scripts/tt-gate.ts` (`pnpm --filter @checkers/engine tt-gate [hloubka] [pozice]`).

## Výsledek brány (úbytek uzlů roste s hloubkou)
| hloubka | úbytek uzlů | čas s TT / bez TT |
|---|---|---|
| 5 | ~15 % | 1,71× (POMALEJŠÍ) |
| 6 | ~26 % | ~1,1–1,2× (POMALEJŠÍ) |
| 7 | ~34 % | ~0,90–0,97× (break-even) |
| 8 | ~48 % | ~0,71× (rychlejší) |

## HLAVNÍ VÝHRADA — přečíst před uzavřením směru
Cíl fáze byl *rychlost / hlubší search za stejný čas*. **Brána měří úbytek uzlů
a ten PASS je pravdivý, ale na hodinách se přínos objeví až od hloubky ~7.** Pod
ní režie hashe (přepočet 32 polí na uzel) úsporu uzlů sežere a přidá. Histogram
M3 brány ukazuje těžiště reálné hry na hloubkách 5–7, tedy z velké části POD
bodem zlomu → reálná síla na čas se teď nezlepší, na hloubce 6 se o ~20 % zhorší.
Node-gate ≠ splněný cíl „hlubší search za stejný čas". Fáze to předvídala
(orientační měření času je proto součást brány), není to skrytá vada — ale
`VERDIKT: PASS` se nesmí číst jako „TT je čistý přínos".

Levné řešení je odložená optimalizace z rozhodnutí: **inkrementální hashování**
(XOR rozdílu při tahu místo přepočtu) by režii odstranilo a bod zlomu posunul
hluboko dolů. Doporučuju TT nechat zapnutou (korektní, na provozních hloubkách
break-even, s hloubkou roste přínos) a inkrementální hash zvážit jako navazující
krok, pokud bude síla na čas potřeba.

## Rozhodnutí k zaznamenání (spusť `/mini:decision` před `/mini:done`)
Během implementace padlo netriviální rozhodnutí, které z kódu později nebude
zřejmé: skóre se z TT přebírá jen při **`entry.depth === depth`**, ne standardním
`>= depth`. Standardní `>=` byl vědomě ZAMÍTNUT: přenesl by hlubší výsledek do
mělčího uzlu → `searchRoot` s TT by se na fixní hloubce rozešel s během bez TT a
rozbil by kontrakt „identická množina nejlepších tahů" (páteř kalibrace remíz).
Cena: méně reuse skóre, ale řazení TT-tahem (hlavní zisk) funguje z libovolné
hloubky, takže úbytek uzlů zůstává. To je hlavní ADR fáze.

## Odchylky od plánu / diskuse (vědomé, ne vady)
- **Kořen (`rootSearch`) TT nesahá vůbec** — ani k řazení. Diskuse říkala „z TT
  bere maximálně pořadí tahů"; zvolil jsem přísnější variantu (kořen je na TT
  úplně nezávislý), aby přesnost kořene byla zaručena konstrukcí, ne jen důkazem.
- **`clear()` v produkci fakticky nevolá nikdo** — `searchTimed` čistí přes
  `new TranspositionTable()`. `clear()` je plánovaný, otestovaný primitiv (drží
  API kontrakt „vyčištěná na začátku"); necháno záměrně.
- Iterace hloubky 1 v `searchTimed` do TT nic neuloží (celá běží s `depth=0`) →
  iterace 2 z ní nemá řazení. Očekávané, bezvýznamné.

## Zuby testů (ověřeno dočasným rozbitím kódu)
- Odebrání kontroly klíče (`entry.key === key`) → `search-tt.test.ts` padne.
- Záměna typu meze při zápisu (upper ↔ lower) → padne.
- Exact návrat bez kontroly hloubky → padne.
- Slabé místo: `=== depth` → `>= depth` u lower/upper mezí NEshodí žádný test —
  moje fixtures nevytvářejí transpozice na RŮZNÉ zbývající hloubce, takže tuhle
  konkrétní divergenci nespustí. Kontrola hloubky u `exact` větve zuby MÁ (viz
  výš). `===` je tedy konzervativní, provably-safe volba, ne empiricky vynucená.

## Watch out for (pro navazující práci)
- Skóre zůstávají CELÁ čísla (kontrakt `best-1` okna). TT nezavádí float.
- Mat-skóre (`|score| ≥ WIN_SCORE - 1000`) se do TT NEUKLÁDÁ (závisí na `ply`).
- Kolize KLÍČE (dvě pozice, stejný 53-bit otisk) je vědomě přijaté riziko volby
  53-bit klíče; ověření klíče chytá jen kolizi kbelíku, ne kolizi otisku.

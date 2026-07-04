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

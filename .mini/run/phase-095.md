---
phase: 95
verdict: done
steps:
  - title: "Generátor: klouzavé braní létavé dámy"
    status: done
  - title: "apply.ts: validace klouzavého braní (turecký úder)"
    status: done
  - title: "Golden testy braní (pool reference)"
    status: done
  - title: "Americká brána: krátká cesta beze změny"
    status: done
  - title: "Nezávislý adversarial sub-agent review"
    status: done
---

# Fáze 95 — report z auto session

## Co je hotové
Létavá dáma teď umí **klouzavé braní** s tureckým úderem, na obou stranách kontraktu (generátor i validátor).

- **`moves.ts` — nová `extendFlyingKingJumps`.** Stará `extendJumps` je **bajt-identická** (přibyl jen komentář nad ní). `jumpMovesFrom` routuje létavou dámu (`kind==='king' && ruleset.king==='flying'`) do nové cesty, vše ostatní (muž, krátká dáma) jede starou. Nová funkce v každém směru klouže přes prázdná pole k prvnímu obsazenému; je-li to nebraný soupeř a je za ním prázdné pole, vzniká větev pro KAŽDÝ prázdný dopad a rekurzí se pokračuje. Turecký úder: brané kameny se **neodebírají** z pracovní desky (zůstávají blokery), `captures.includes(over)` brání dvojímu braní. Terminace je zaručená — `captures` monotónně roste, dřív braný blokuje, takže hloubka ≤ počtu soupeřových kamenů.
- **`apply.ts` — nová flying větev ve smyčce (`else if (flyingKing)`).** Každý segment `current→landing` se ověřuje přes `raySquares`: právě jeden obsazený = deklarovaný capture (soupeřův, ještě nebraný), ostatní mezipole i dopad prázdné. Brané kameny se drží na desce jako blokery a mažou se **naráz až po smyčce** (`capturedSquares`) — zrcadlo generátoru. Krátká/short cesta beze změny (okamžité mazání).

## Ověření (mechanicky, sám)
- `packages/rules`: **312 testů zelených** (300 původních + 12 nových), typecheck čistý.
- Celé monorepo: typecheck OK ve všech 6 balíčcích; testy zelené — rules 312, cli 24, engine 250, ai 54, server 156, web 563. `eslint .` bez nálezů.
- **Americká brána drží:** perft 1-6 a všechny původní testy zelené beze změny čísel (stará cesta nedotčená).
- **Golden testy jedou přes reálný kód obou stran** (`legalMoves → applyMove → kontrola desky`), očekávané hodnoty jsem groundoval reálnou geometrií z `board.ts`, ne odhadem. Pokrývají: volbu dopadu, vícenásobné braní s volbou dopadu v každém kroku, tureckou smyčku (návrat na origin), a negativně: přejetí dřív braného kamene, dopad na spent pole, dva soupeři na jednom paprsku, „sebrání" vlastního kamene, muž pod flying zůstává krátký.
- **Testy mají zuby — ověřeno mutací:** mutace generátoru na okamžité mazání shodí ring test; mutace apply na okamžité mazání shodí test „pozdější segment nepřejede dřív braný kámen". Pozici pro ten test jsem musel upravit ([18,14w,23w]), protože v původní ring pozici bylo cílové pole prázdné a i chybná varianta házela výjimku „z jiného důvodu" — teď rozliší korektní (throw) od chybného (chybně by prošlo).

## Nezávislý adversarial review
Pustil jsem sub-agenta s čerstvým kontextem. Šel nad rámec checklistu: postavil **nezávislý souřadnicový referenční generátor** (nesdílí tabulky z `board.ts`) a srovnal 152 544 pozic — množina tahů se shodla beze zbytku; 920 136 fuzz tahů prošlo `applyMove` bez jediného rozporu gen↔apply. Verdikt: **korektní k odevzdání, žádné blokující chyby.** Dvě kosmetické poznámky jsem hned opravil: nepřesné slovo „mapa" v komentáři (`capturedSquares` je pole) a doplnil dva chybějící negativní testy (vlastní kámen, muž pod flying).

## Poznámky / co je vědomě mimo
- Notace flying braní a perft flying varianty jsou **mimo řez** (fáze B2b/B3) — golden testy asertují `Move` objekty přímo, ne přes `formatMove/parseMove`. Do reálné hry se flying zapojí až ve fázi D; v izolaci ho zatím nic nevolá.
- `applyMove` z principu nevaliduje plnou legalitu (povinnost braní, úplnost sekvence) — brána je členství v `legalMoves`, to je zděděné vědomé rozhodnutí, ne regrese. Datovou korupci desky ale flying větev nedovolí (potvrzeno fuzzem).
- Rozhodnutí „dvě oddělené cesty braní (krátká vs. klouzavá turecká), sjednocení odmítnuto" už bylo zaznamenáno v diskusi/ADR fáze — nový crossroads k `/mini:decision` nevznikl.

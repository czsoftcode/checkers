# Phase 94 — Létavá dáma: prostý tah (klouzání)

**Goal:** Přidat king: 'flying' do Ruleset a implementovat paprskové generování PROSTÉHO tahu dámy (klouže po diagonále, dokud nenarazí na kámen nebo okraj), včetně ray-aware validace v apply.ts a notation.ts - sem přirozeně dopadá threading ruleset do applyMove odložený z fáze A (na king:'flying' se reálně větví, není to mrtvý parametr). Braní létavé dámy a perft jsou MIMO řez (fáze B2/B3). Brána: golden testy klouzavého prostého tahu dámy (různé vzdálenosti, blokace kamenem/okrajem), apply a notation přijmou i dlouhý prostý tah, a americká varianta beze změny = všechny dosavadní testy zelené beze změny čísel. Řez z todo 57 (fáze B), 57 zůstává otevřené do dokončení B2+B3.

## Steps
- [done] Přidat 'flying' do typu Ruleset
- [done] board.ts: helper paprsku diagonály
- [done] moves.ts: klouzavý prostý tah dámy
- [done] apply.ts: ray-aware validace prostého tahu
- [done] notation.ts: ray-aware prostý tah
- [done] Brána: lint + celý suite + golden flying zelené

## Auto-commit
- Phase 94: Létavá dáma: prostý tah (klouzání)

## Run report
---
phase: 94
verdict: done
steps:
  - title: "Přidat 'flying' do typu Ruleset"
    status: done
  - title: "board.ts: helper paprsku diagonály"
    status: done
  - title: "moves.ts: klouzavý prostý tah dámy"
    status: done
  - title: "apply.ts: ray-aware validace prostého tahu"
    status: done
  - title: "notation.ts: ray-aware prostý tah"
    status: done
  - title: "Brána: lint + celý suite + golden flying zelené"
    status: done
---

# Phase 94 — report z auto session

## Co je hotovo

Přidán `king: 'short' | 'flying'` do `Ruleset` (AMERICAN zůstává `'short'`) a implementováno paprskové generování PROSTÉHO tahu létavé dámy napříč jádrem rules:

- **board.ts**: nová geometrie `raySquares(from, to)` – pole od `from` (exkluzivně) po `to` (inkluzivně), `null` na mimodiagonále / mimodesku / `to === from`. Jde po krocích přes `neighborOf`, takže vrací i mezipole (volající si ověří obsazenost). Neexportuje se z indexu – stejný režim jako `isNeighbor`.
- **moves.ts**: `simpleMovesFrom`/`generateSimpleMoves` přijímají ruleset (default AMERICAN); pro `king:'flying'` dáma KLOUŽE po diagonále přes prázdná pole a zastaví PŘED prvním kamenem/okrajem (na obsazené pole nedopadne). `legalMoves` nyní ruleset reálně předává dál (dřív nepředával).
- **apply.ts**: `applyMove` přijímá ruleset (threading odložený z fáze A); pro létavou dámu ověří prostý tah paprskem (mezipole musí být prázdná) místo `isNeighbor`.
- **notation.ts**: `formatMove`/`parseMove` přijímají ruleset; flying povolí strukturálně prostý tah po diagonále na libovolnou vzdálenost (notace desku nevidí, obsazení nekontroluje – to hlídá apply/legalMoves).

## Threading NENÍ mrtvý parametr

Testy to hlídají přímo: stejný dlouhý tah `18→5` pod default AMERICAN (`short`) spadne jako teleport (`RangeError`), pod FLYING projde. Muž ve flying variantě zůstává krátký. To je důkaz, že se na `king:'flying'` reálně větví.

## Brána

- **lint** (eslint .) čistý, **typecheck** celý workspace zelený.
- Přidání volitelného parametru `ruleset` rozbilo jedno bodové volání `.map(formatMove)` v `cli/modes.ts` (map předává index jako 2. argument) – opraveno na `.map((move) => formatMove(move))`. Grep potvrdil, že jinde žádné bare-reference volání změněných funkcí není.
- **Celý suite zelený beze změny čísel**: rules 300 (24 souborů; +4 nové flying testy: ray-squares, flying-simple-moves, flying-apply, flying-notation; +1 pojistka), cli 24, engine 250 (perft 1–6 i brána M3 beze změny), ai 54, server 156, web 563. Americká varianta se nezměnila (všichni volající jedou na default AMERICAN).

## Nezávislý self-review (čerstvý kontext)

Fáze sahá na chybové cesty a kontrakty mezi moduly, takže dle CLAUDE.md proběhl nezávislý red-team sub-agent. **Žádný kritický defekt v rozsahu fáze.** Ověřil geometrii paprsku (off-by-one, terminace klouzání), zachování americké varianty, žádnou mutaci vstupu při výjimce a že testy mají zuby. Tři latentní nálezy:

1. **(střední, landmine pro fázi B, MIMO řez)** Ruleset se nepropaguje přes stavovou vrstvu: `advanceState` volá `applyMove` natvrdo bez rulesetu a `GameState` pole ruleset nemá; stejně perft, web controller, server store, engine search, ai book. Dnes nedosažitelné (flying se přes GameState nespustí), ale jakmile se postaví flying partie přes `GameState`, `legalMoves(FLYING)` vygeneruje klouzavý tah a `advanceState → applyMove(AMERICAN)` ho odmítne jako teleport – klasický seam divergence generátor/apply. Patří do fáze B (threading přes GameState/metadata místnosti), todo 57 zůstává otevřené.
2. **(nízká, doplněno)** Chyběl round-trip test `legalMoves(FLYING) → applyMove(FLYING)`. **Doplnil jsem ho** (`flying-apply.test.ts`) – prožene každý tah generátoru přes apply bez výjimky na třech pozicích (volná deska, blokace vlastním i cizím kamenem, roh). Levná pojistka se zuby proti budoucí divergenci.
3. **(kosmetika, ponecháno)** Ve flying větvi apply.ts smyčka přes paprsek kontroluje i `landing`, který je už ověřen jako prázdný výše. Neškodná defenzivní redundance, žádný bug.

## Poznámka k dalšímu postupu

Řez z todo 57 (fáze B). Braní létavé dámy (paprskový skok) a per-varianta perft jsou MIMO tuto fázi – fáze B2/B3. Threading rulesetu přes `GameState` a zbývající call sites (nález 1) je součást fáze B, ne úklidu této fáze. Žádné rozcestí hodné ADR jsem nepotkal – řešení bylo přímočaré rozšíření podle zadání.

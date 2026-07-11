# Phase 95 — Létavá dáma: braní (generátor + apply)

**Goal:** V moves.ts (extendJumps) implementovat klouzavé braní létavé dámy - dojeď po diagonále k PRVNÍMU soupeřovu kameni (prázdná pole před ním), dopad na LIBOVOLNÉ prázdné pole za ním (každý dopad je větev), pokračování vícenásobného braní z dopadu - s odebráním na KONCI sekvence (turecký úder: brané kameny blokují a nelze je brát dvakrát), což nahrazuje dnešní chybné okamžité odebrání pro flying; plus ray-aware validace braní v apply.ts. Notace flying braní a perft jsou MIMO řez (fáze B2b/B3). Brána: golden testy klouzavého braní včetně tureckého úderu (pozdější segment nesmí přejet dřív braný kámen) a volby dopadu; americké braní beze změny (perft 1-6 a všechny testy zelené). Řez z todo 57 (fáze B), 57 zůstává otevřené.

## Steps
- [done] Generátor: klouzavé braní létavé dámy
- [done] apply.ts: validace klouzavého braní (turecký úder)
- [done] Golden testy braní (pool reference)
- [done] Americká brána: krátká cesta beze změny
- [done] Nezávislý adversarial sub-agent review

## Auto-commit
- Phase 95: Létavá dáma: braní (generátor + apply)

## Discussion
# Phase 95 — Létavá dáma: braní (generátor + apply)

## Intent
Naučit generátor (`moves.ts` / `extendJumps`) a validátor (`apply.ts`) brát létavou dámou:
klouzavý skok (přijeď k prvnímu soupeři z dálky přes prázdná pole, dopadni na libovolné
prázdné pole za ním) včetně vícenásobného braní z dopadu. Notace flying braní a perft jsou
MIMO řez (fáze B2b / B3) — v izolaci je zatím nic nevolá, flying se do reálné hry zapojí až v D.

## Key decisions
- **Referenční varianta = pool checkers.** Nejjednodušší flying (bere letmo, muž i dozadu, žádná
  priorita, žádná proměna uprostřed braní). Standardní pool/ruský výklad létavého braní se zapíše
  NATVRDO do test fixtures jako zdroj pravdy — žádný externí federační dokument se nepřipíná,
  fixture JE reference. (Priorita braní dámou = česká a proměna uprostřed = ruská patří do fáze C.)
- **Tři pravidla létavého braní (potvrzeno uživatelem):**
  - (a) Dopad na LIBOVOLNÉ volné pole za braným kamenem (volba hráče, ne povinně první ani nejdál);
    každý dopad = samostatný tah/větev.
  - (b) ŽÁDNÉ povinné maximum — kratší braní legální i když existuje delší (jako americká). Povinné
    maximum je non-goal vlny.
  - (c) TURECKÝ ÚDER — brané kameny zůstávají na desce jako PŘEKÁŽKY až do konce sekvence: nelze je
    brát dvakrát, nelze přes ně přejet ani na ně dopadnout; všechny se smažou naráz na konci tahu.
- **Dvě cesty braní (potvrzeno).** Krátká dáma + muž = dnešní kód BEZE ZMĚNY (okamžité odebrání,
  krok-2 přes neighborOf/jumpOf). Létavá dáma = NOVÁ klouzavá cesta s tureckým úderem. Chrání to
  americká čísla (perft 1-6) i POŘADÍ tahů (selfplay/opening determinismus). Cena = malá duplikace,
  vědomě přijatá; sjednocení do jedné turecké cesty se ODMÍTÁ (riziko změny pořadí amerických tahů).
- Detekce létavé dámy: `piece.kind === 'king' && ruleset.king === 'flying'` (stejně jako už dělá
  B1 pro prostý tah v apply.ts).

## Watch out for
- **Turecký úder je korektnostní mina.** Dnešní okamžité odebrání (`board[over-1]=null` v extendJumps)
  je pro flying ŠPATNĚ: pozdější dlouhý segment může přejet přes dřív brané pole. Paritní argument
  v komentáři extendJumps ("dopady a braní se nikdy nepotkají") platí JEN pro krok-2 krátký skok,
  ne pro klouzání. Nová cesta musí držet brané kameny na desce jako blokery a mazat je až na konci.
- **Cross-module kontrakt generátor ↔ apply.** Oba se musí shodnout na sémantice "braný, ale ještě
  na desce": blokuje pohyb, nelze brát dvakrát, odebrán na konci. apply.ts dnes maže captures PRŮBĚŽNĚ
  ve smyčce — pro flying to musí odložit na konec, zrcadlově ke generátoru. Golden test ať ověřuje
  REÁLNÝ kód obou stran (generuj → aplikuj → zkontroluj desku), ne jen jednu stranu.
- **Americká brána.** Krátká cesta (muž + short dáma) musí zůstat bajt-identická — nejen množina, ale
  i POŘADÍ tahů (na něm visí selfplay seed a opening testy). Zajištěno větvením na flying; starou cestu
  nesahat.
- **Muž v poolu NENÍ létavý.** Bere krok-2 skokem (+ manCaptureBackward už z fáze 93), turecký úder
  timing muže neovlivní (parita), takže muž zůstává na staré cestě. V B2 se muž a dáma nemíchají
  (proměna uprostřed = fáze C).
- **Golden testy testují můj výklad.** Ruční očekávané hodnoty = riziko, že testuju vlastní chybu.
  Použít učebnicové flying pozice s jednoznačnou odpovědí a před reportem pustit NEZÁVISLÉHO sub-agenta
  (čerstvý kontext) na adversarial review — fáze sahá na chybové/geometrické cesty i kontrakt mezi
  moduly (viz CLAUDE.md).
- **Notace a perft mimo řez.** Golden testy asserují Move objekty přímo, ne přes formatMove/parseMove.
  Flying braní se do PDN/perftu dostane až v B2b/B3.

## Run report
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

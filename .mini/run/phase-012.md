---
phase: 12
verdict: done
steps:
  - title: "Kostra balíčku packages/cli"
    status: done
  - title: "Herní smyčka bez terminálu"
    status: done
  - title: "Random hráč se seedovaným PRNG"
    status: done
  - title: "Textové vykreslení desky a tahů"
    status: done
  - title: "Režim random vs random"
    status: done
  - title: "Režim člověk vs random"
    status: done
verify:
  - title: "Zahrát si interaktivní partii v opravdovém terminálu (TTY)"
    detail: "Pipe vstup (echo tahů do stdin) je pokrytý testy podprocesu, ale skutečné interaktivní sezení – zobrazení promptu, čitelnost desky, Ctrl+C/Ctrl+D uprostřed přemýšlení – jsem mechanicky ověřit nemohl. Spusť: pnpm --filter @checkers/cli start -- --mode human"
---

# Phase 12 — report from the auto session

## Co vzniklo

Nový balíček `packages/cli` (@checkers/cli), závislý jen na @checkers/rules:

- `src/game.ts` – čistá herní smyčka `playGame(black, white, onPly?)` bez I/O. Je zároveň bránou legality: tah od strategie projde jen přes členství v `legalMoves` (porovnání kanonickým PDN z `formatMove`), nelegální tah = Error. Výsledek se vyhodnocuje po každém půltahu (kontrakt `advanceState`). Pojistka `MAX_GAME_PLIES = 20 000` proti rozbité terminaci (matematická mez je ~16 200).
- `src/players.ts` – random hráč nad dodaným PRNG; odmítá prázdný seznam tahů i rng mimo [0, 1).
- `src/prng.ts` – mulberry32, vědomá kopie z test supportu rules (test support cizího balíčku není veřejné API; duplicita je levnější než falešná závislost).
- `src/render.ts` – ASCII deska: kameny m/k/M/K (stejné kódování jako `positionKey`), prázdná tmavá pole ukazují své PDN číslo (člověk má čísla pro zadání tahu před sebou).
- `src/modes.ts` – režimy nad rozhraním `CliIO` (testovatelné in-process): random vs random a člověk vs random s validací vstupu (parseMove + brána legality, chybný vstup = hláška a nový prompt).
- `src/main.ts` – vstupní bod: parseArgs, seed, barva, readline.

Spuštění: `pnpm --filter @checkers/cli start -- --mode random --seed 42` nebo `--mode human [--color white]`. Bez `--seed` se hraje s náhodným seedem, který se vypíše (partie je zpětně reprodukovatelná).

## Exit kódy (kontrakt CLI)

0 = dohraná partie s výsledkem, 1 = chybné argumenty / runtime chyba, 2 = partie přerušená člověkem (EOF/Ctrl+C, s hláškou). Žádná cesta nekončí 0 bez vypsaného výsledku.

## Chycená chyba za běhu

První implementace vstupu přes `rl.question` ztrácela řádky: u pipe vstupu dorazí všechny řádky naráz a ty mezi dvěma otázkami readline tiše zahodil (ověřeno reálným spuštěním – z `11-15\nblbost\n8-11\n` se zpracoval jen první řádek). Opraveno vlastní frontou řádků přes událost `line`; spawn test tuto chybu nyní přibíjí (víceřádkový stdin se nesmí ztratit).

## Nezávislý sub-agent review (před reportem)

Fáze sahá na vstupní bod procesu a chybové cesty, takže dle projektových pravidel proběhl review čerstvým sub-agentem. Závažné nálezy žádné; tři nižší opraveny hned:

1. `Number(values.seed)` bralo `--seed=` jako 0 (tichá deterministická partie) – nově regex `^\d+$` + `isSafeInteger`, jinak exit 1.
2. Rozlišení přerušená vs. dohraná partie se zahazovalo (obojí exit 0) – nově exit 2 pro přerušení.
3. `--color` se v random režimu tiše ignorovala – nově exit 1 s hláškou.

Neopraveno (vědomě): dvojí výpočet `legalMoves` na půltah (bezvýznamné u partií o stovkách půltahů); netestovaný čistě defenzivní guard souběžného čtení a cesta „runtime chyba → stack" (nejde rozumně vyvolat zvenčí přes argumenty).

## Testy (mají zuby)

24 testů ve 4 souborech: herní smyčka (terminace přes 30 seedů, determinismus, odmítnutí nelegálního i strukturálně nesmyslného tahu), render (přesné řetězce, dámy, poškozená deska), režimy in-process (odmítání vstupů s hláškami, EOF, plná partie „robota čtoucího nabídku tahů" – parsuje skutečný výstup, spadl by při rozbití výpisu i smyčky) a 9 spawn testů skutečného podprocesu (exit kódy, determinismus, víceřádkový stdin). Celá brána zelená: lint, typecheck, 259 testů rules beze změny.

## Poznámky

- CLI běží přes `tsx` (devDependency jen v cli): balíčky exportují přímo TS zdrojáky a rules používá `.js` specifikátory, které nativní type stripping Node 24 nerozřeší – zvažovaná alternativa (build krok / přejmenování specifikátorů) zamítnuta. Kandidát na `/mini:decision`, pokud to chceš mít v ADR.
- pnpm při instalaci zablokoval build skript esbuild (závislost tsx); ověřeno, že tsx funguje i bez něj (platformní binárka jde z optional dependency). Není potřeba nic schvalovat.
- Změněný `pnpm-lock.yaml` je součást fáze (CI jede s --frozen-lockfile).

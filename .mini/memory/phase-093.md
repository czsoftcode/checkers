# Phase 93 — Ruleset abstrakce (jádro rules)

**Goal:** Zavést typ Ruleset s americkým defaultem a protáhnout ho volitelným parametrem do legalMoves/applyMove uvnitř balíčku rules (výběr směrů muže/dámy a proměna čtou z Ruleset místo natvrdo), bez nové varianty a beze změny volajících. Brána: všechny dosavadní testy včetně perft 1-6 zelené BEZE ZMĚNY čísel = důkaz, že refaktor nezměnil americkou variantu. Threading do ~8 call sites (engine/web/ai/server) je mimo řez, přijde ve fázi B/D - todo 56 zůstává otevřené.

## Steps
- [done] Definovat typ Ruleset + AMERICAN default
- [done] moves.ts: směry čtené z Ruleset
- [done] Volitelný parametr ruleset do generátoru
- [done] Seam test: braní vzad při manCaptureBackward:true
- [done] Brána: lint + celý test suite zelené beze změny čísel

## Auto-commit
- Phase 93: Ruleset abstrakce (jádro rules)

## Run report
---
phase: 93
verdict: done
steps:
  - title: "Definovat typ Ruleset + AMERICAN default"
    status: done
  - title: "moves.ts: směry čtené z Ruleset"
    status: done
  - title: "Volitelný parametr ruleset do generátoru"
    status: done
  - title: "Seam test: braní vzad při manCaptureBackward:true"
    status: done
  - title: "Brána: lint + celý test suite zelené beze změny čísel"
    status: done
---

# Phase 93 — report z auto session

## Co jsem udělal
- **`packages/rules/src/ruleset.ts`** (nový): typ `Ruleset { manCaptureBackward: boolean; king: 'short' }` a konstanta `AMERICAN_RULESET` (`false`, `'short'`). Záměrně minimální — `flying` dáma a `promoteMidCapture` se dolijí ve fázi B, ne teď (žádný dead config).
- **`packages/rules/src/moves.ts`**: původní jediná `moveDirs(color, kind)` rozdělena na dvě funkce podle role:
  - `simpleMoveDirs` — směry prostého tahu (muž vždy vpřed, dáma všemi směry o 1 pole). Na ruleset zatím nezávisí.
  - `captureDirs(color, kind, ruleset)` — směry braní; u muže `ruleset.manCaptureBackward ? ALL_DIRS : MAN_DIRS[color]`. **Toto je jediný reálný seam této fáze.**
  - Ruleset protažen jako volitelný parametr (default `AMERICAN_RULESET`) do `legalMoves`, `jumpMovesFrom` a `extendJumps` (celá cesta braní). Žádný volající se nemění.
- **`packages/rules/src/index.ts`**: export `AMERICAN_RULESET` (hodnota) a `Ruleset` (typ).
- **`packages/rules/test/ruleset-seam.test.ts`** (nový, +4 testy): default nebere vzad, `manCaptureBackward:true` bere z 18 přes 14 na 9, seam prochází i přes `legalMoves` (povinnost braní zviditelní skok), a braní vpřed je v obou variantách identické.

## Brána — splněna
- `pnpm lint` čistý.
- `pnpm typecheck` (celý workspace, 6 balíčků) zelený.
- `pnpm test` celý workspace zelený: rules 270 (266 + 4 nové seam), engine 250 (vč. perft 1–6), web 563, server 156, ai 54, cli 24.
- Perft testy tvrdí přesná čísla a zůstala zelená → **důkaz, že refaktor nezměnil americkou variantu.**

## Odchylka od doslovného plánu (vědomá, s odůvodněním)
Krok 3 v plánu jmenoval i `simpleMovesFrom` a `generateSimpleMoves` jako příjemce `ruleset`. Nejdřív jsem jim parametr přidal, ale nezávislý self-review (čerstvý kontext) správně upozornil, že tam byl **mrtvý** — prostý tah muže na ruleset dnes nezávisí a `simpleMoveDirs` ho nečte. Parametr s defaultem `AMERICAN_RULESET` na nepoužívající funkci je navíc tichá past: volající ve flying variantě by mohl čekat efekt na prostý tah, který nenastane. To jde přímo proti pravidlu „žádná abstrakce pro budoucnost". Proto jsem parametr z obou funkcí **odebral**; vrátí se ve fázi B, až ho `simpleMoveDirs` opravdu bude číst (klouzavý pohyb dámy). Seam této fáze (braní muže vzad) žije celý v cestě braní a je kompletní i otestovaný.

## Mimo řez (dle zadání)
Threading Rulesetu do ~8 call sites (engine/web/ai/server) a proměna uprostřed braní patří do fáze B/D — todo 56 zůstává otevřené. `applyMove` jsem nechal beze změny: proměna je v americké variantě fixní a `promoteMidCapture` v minimálním Rulesetu není.

## Self-review
Nezávislý sub-agent potvrdil: americké chování zachováno 100 %, žádná záměna simple/capture směrů, nová větev dosažitelná a testovaná reálným kódem (ne mockem), test má zuby (při chybě v `captureDirs` spadne), geometrie 18→14→9 ověřena proti `board.ts`. Jediný nález (mrtvý `void ruleset`) je vyřešen odebráním výše.

## Poznámka
Test kryje jen braní vzad u ČERNÉHO muže; bílý je symetrický přes `MAN_DIRS`, riziko nízké. Kdyby ses chtěl pojistit proti překlepu ve směrech bílého, stačí přidat jeden zrcadlový případ — nechal jsem to mimo, ať test nepřerůstá nad rámec seamu.

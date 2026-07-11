---
phase: 100
verdict: done
steps:
  - title: "Registr variant: VariantId + rulesetForVariant"
    status: done
  - title: "GameState nese variantu"
    status: done
  - title: "Engine: ruleset přes search/evaluate + protokol"
    status: done
  - title: "AI: ruleset přes computeAiMove + kniha jen americká"
    status: done
  - title: "Brána: všechny balíčky zelené + neměnnost"
    status: done
  - title: "Nezávislý sub-agent review"
    status: done
---

# Fáze 100 — report z auto session

## Co se udělalo
Ruleset varianty je protažený přes celý compute-core, americká je default všude:

- **rules — registr (`src/variant.ts`, nový):** `VariantId` ('american'|'pool'|'russian'|'czech'),
  `VARIANT_IDS`, `isVariantId` (runtime brána i proti prototypovým vlastnostem přes
  `hasOwnProperty`), `rulesetForVariant(id)` → mapa na `Ruleset`. Neznámé id vyhazuje
  `RangeError`, NEdefaultuje tiše. Exportováno z `index.ts`.
- **rules — GameState (`state.ts`, `result.ts`):** `GameState` má nové POLE `variant: VariantId`
  (ne parametr — kvůli ruské mid-capture proměně, kde applyMove potřebuje ruleset).
  `initialGameState(position, variant='american')`. `advanceState`/`gameResultFromState`
  NEMĚNÍ signaturu — čtou `state.variant` → registr → předají ruleset do `applyMove`/`legalMoves`.
  `positionKey`/Zobrist beze změny (varianta není v hashi). `gameResult` dostal volitelný
  `ruleset` (default american).
- **engine (`protocol.ts`, `handler.ts`, `search.ts`, `evaluate.ts`):** `BestmoveRequest`/
  `EvaluateRequest` += `variant?` (import `VariantId` z rules). PROTOCOL_VERSION zůstává 3
  (zpětně kompat., bez bumpu). Handler validuje wire pole přes `isVariantId` → neznámé =
  `invalid_message`, chybějící = american. Ruleset teče do `searchTimed`/`searchRoot`/`negamax`
  (všechna `legalMoves`/`applyMove`) i do `evaluateFn`. `EvalFn` má nově volitelný 2. arg
  `ruleset?` (v1 evaluate ho nepotřebuje a nedeklaruje — přiřaditelné; v2 ho konzumuje pro mobilitu).
- **ai (`choose.ts`):** `ComputeAiMoveOptions` += `variant?` (default american). Kniha zahájení
  se konzultuje JEN pro american (`book !== undefined && variant === 'american'`); pool/ruská/
  česká jdou rovnou do searche. `isLegalMove` re-validuje proti rulesetu varianty.
- **server:** store staví stav jen přes `initialGameState()` → americká teče automaticky,
  žádná ruční konstrukce GameState (jen jeden testový literál doplněn o `variant`).

## Nové zkoušky (mají zuby)
- `rules/test/variant.test.ts`: každé id → správný ruleset (kontrola konkrétních polí, ne jen
  „něco vrátil"); neznámé/prototypové id vyhazuje; `isVariantId` propouští jen známá.
- `rules/test/game-state-variant.test.ts`: ruská partie přes `advanceState` udělá na cíli DÁMU
  (mid-capture), kontrast s americkým `applyMove` = MUŽ. Rozbití threadingu → pád.
- `engine/test/handler.test.ts`: bestmove `variant:'pool'` vrátí tah legální v poolu a NElegální
  v americké (braní vzad); bez pole = americká; evaluate s variantou nespadne; neznámá varianta =
  `invalid_message`.
- `ai/test/choose.test.ts`: `computeAiMove(..., variant:'pool')` vrátí legální pool tah; kniha se
  pro pool NEkonzultuje (rng-must-run), americká cesta s knihou beze změny.

## Brána
Typecheck 6/6 balíčků zelený. Testy BEZE ZMĚNY dosavadních čísel + nové:
rules 369→382, engine 250→254, ai 54→57; cli 24, server 156, web 563 beze změny. Lint čistý.

## Nezávislý sub-agent review
Čerstvý kontext prošel všech 5 kontraktů (registr, GameState↔protokol, zpětná kompat. bez bumpu,
threading search/evaluate, kniha jen americká) — ŽÁDNÝ nález tiché koruce ani rozbitého kontraktu.
Jediná poznámka (ne nález): handler diskriminuje úspěch/chybu přes `'code' in ruleset`, konzistentní
s existujícím `'code' in strength`; teoretické riziko jen kdyby `Ruleset` v budoucnu dostal pole `code`.

## Poznámky pro člověka
- Shipovaná aplikace zatím žádnou neamerickou variantu do enginu NEPOSÍLÁ (web selection/controller +
  server dto = D2/D3, mimo řez). Reachability plumbingu je proto dokázaná POUZE testy — to je přesně
  deklarovaný cíl fáze („plumbing není mrtvý"), ne opomenutí.
- Žádné ADR-hodné rozcestí (klíčová rozhodnutí — varianta jako pole, id string, kniha jen americká —
  padla už v diskusi fáze 100). `/mini:decision` netřeba.

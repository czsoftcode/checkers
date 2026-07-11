# Phase 100 — Ruleset přes engine + AI (plumbing)

**Goal:** Protáhnout ruleset přes compute-core: rules-state (GameState nese variantu, advanceState/gameResult ji čtou pro detekci konce hry přes legalMoves v dané variantě), engine (evaluate/handler/search + protokol worker/bestmove pole varianty), ai (choose/opening-book), vše s americkým defaultem. Nová zkouška: computeAiMove/search vrátí legální tah pro NE-americký ruleset (pool) = plumbing není mrtvý. Všechny dosavadní testy zelené BEZE ZMĚNY čísel. MIMO řez: web (selection/controller) + server (dto) wiring a výběr v lobby (D2/D3); per-varianta evalWeights (D1). Uzavírá compute-core část todo 56 (web selection/controller + server dto zůstávají -> D2/D3). Řez z todo 59 (fáze D); 56 i 59 zůstávají otevřené. Nízkoriziková páteř (jako fáze 93), odblokuje D1/D2/D3.

## Steps
- [done] Registr variant: VariantId + rulesetForVariant
- [done] GameState nese variantu
- [done] Engine: ruleset přes search/evaluate + protokol
- [done] AI: ruleset přes computeAiMove + kniha jen americká
- [done] Brána: všechny balíčky zelené + neměnnost
- [done] Nezávislý sub-agent review

## Auto-commit
- Phase 100: Ruleset přes engine + AI (plumbing)

## Discussion
# Phase 100 — Ruleset přes engine + AI (plumbing)

## Intent
Protáhnout ruleset přes compute-core (rules-state + engine + ai), americká default, aby varianta mohla
téct výpočtem tahu a stavem partie. Páteř pro D1 (eval váhy) / D2 (AIvP lobby) / D3 (PvP lobby). Čistý
refaktor, uživateli neviditelný. Web selection/controller + worker-protocol + lobby picker = D2; plná
server room/dto partition = D3; per-varianta evalWeights = D1.

## Key decisions
- **Varianta jako POLE v GameState (varianta B, potvrzeno) — NE parametr.** Zabíjí footgun: `advanceState`
  volá `applyMove`, který pro ruskou potřebuje ruleset (mid-capture promotion mění výsledek). Param s
  defaultem by tiše aplikoval americká pravidla na ruskou partii = potichu poškozená hra. Sebe-popisný
  stav to vylučuje.
  - `GameState` += `variant` (id string, default 'american'). `initialGameState(position, variant='american')`.
  - `advanceState(state, move)` a `gameResultFromState(state)` NEMĚNÍ signaturu — čtou `state.variant`,
    přes registr `rulesetForVariant(id)` vezmou ruleset a předají applyMove/legalMoves.
  - Dotkne se server store MINIMÁLNĚ (aditivní pole, default american) — NE plná room/dto partition (D3).
  - Žádná migrace uloženého stavu: rozehraná partie se do LocalStorage neukládá (jen dokončená jako PDN,
    ta GameState nenese).
- **Protokol enginu nese variantu jako ID STRING (potvrzeno), ne Ruleset objekt.** BestmoveRequest /
  EvaluateRequest += `variant?: 'american'|'pool'|'russian'|'czech'` (default american, zpětně kompat.
  jako maxDepth — BEZ bumpu verze protokolu). Engine handler mapuje id→ruleset přes registr. Objekt po
  drátě NE (leakuje tvar configu, riziko rozjezdu).
- **Registr `rulesetForVariant(id)` (data-driven, vize ho chce pro lobby).** Vzniká tady, engine ho reálně
  konzumuje (není dead). Neznámé id → CHYBA (RangeError), NE tiché defaultnutí na americkou.
- **Otvírková kniha jen americká (potvrzeno).** computeAiMove použije book pouze pro american; pool/ruská/
  česká jdou rovnou do searche (kniha je non-goal pro flying varianty).
- **Rozsah D0 = rules-state + engine (protokol/handler/search/evaluate) + ai (choose/computeAiMove) +
  minimální server-store pole.** Web wiring + picker = D2. Server room partition = D3. evalWeights = D1.

## Watch out for
- **Registr id→ruleset je nové místo tiché chyby** (překlep 'russian'→český ruleset = tiše jiná hra).
  Test: každé id vrací ruleset se správnými poli; neznámé id vyhodí, nedefaultuje.
- **advanceState/applyMove pro ruskou/pool MUSÍ dostat ruleset z GameState** — jinak tichá koruce partie
  (americká pravidla na neamerickou hru). To je hlavní důvod varianty B.
- **Americká i všechny dosavadní testy zelené BEZE ZMĚNY čísel** — default 'american' všude, kde se
  varianta nenastaví. D0 je pro amerického hráče i pro itch (offline AIvP) neviditelná; bundle roste
  zanedbatelně (rulesety jsou drobné consty).
- **Nová zkouška plumbingu (reachability):** computeAiMove/search vrátí LEGÁLNÍ tah pro NE-americký
  ruleset (pool) — jinak je protažení mrtvé.
- **positionKey/Zobrist zůstávají position-only** (varianta NENÍ v hashi) — repetition v rámci partie je
  stejnovariantní, vize to explicitně chce.
- **Preference (LocalStorage) vs varianta partie (GameState) jsou DVĚ věci** — relevantní až pro D2, ale
  pozor: jediný zdroj pravdy = picker → GameState; LocalStorage jen odraz. (Není součást D0.)
- **PWA je non-goal**, ale tento design ji neblokuje (AIvP+varianta je čistě klientské, server jen pro PvP).

## Run report
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

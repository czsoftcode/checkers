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

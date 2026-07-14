# Phase 119 — Italská: AI váhy a sanity

## Intent
Zajistit, že AI hraje italskou rozumně a legálně. ZJIŠTĚNO: fáze je MINIMÁLNÍ = verify + self-play sanity, ŽÁDNÉ nové váhy. Cíl je self-play sanity, NE turnajová síla.

## Key decisions
- **NULA nových vah — italská jede na stávajících short-king vahách (potvrzeno uživatelem, minimum).** `evaluate` (packages/engine/src/evaluate.ts ř.58-59) počítá `kingValue = ruleset.king==='flying' ? KING_VALUE_FLYING(300) : KING_VALUE(130)`. Italská má `king='short'` → 130 (jako americká) zadarmo. Muž 100, postup, zadní řada jsou na variantě nezávislé. NEladit cenu dámy kvůli „muž nebere dámu" (durabilnější dáma) — je to neověřitelný odhad od stolu při „sanity, ne turnaj"; 130 > 100 už dámu cení výš. ARBITR = self-play: kdyby AI systematicky blbě měnila dámy, teprve pak ladit (ne teď).
- **„AI vybírá jen legální italské tahy" = VERIFY plumbingu, ne nová práce.** `search.ts` protahuje `ruleset` do `legalMoves`/`applyMove`/`evaluateFn` (fáze 100). `const moves = legalMoves(position, ctx.ruleset)` → search uvažuje JEN legální italské tahy (max+priorita) automaticky.
- **Self-play harness + precedent existují:** `packages/engine/src/selfplay.ts` + `packages/engine/test/selfplay-flying-king.test.ts` (per-varianta sanity vzor). Italská dostane analogický `selfplay-italian` sanity test.

## Watch out for
- **evaluateV2 quirk (pro italskou NErelevantní, ale ověřit aktivní eval):** `evaluateV2` (ř.156) hardcoduje `KING_VALUE` (neswitchuje flying!) — pro italskou (short) je 130 správně tak jako tak. V `do` POTVRDIT, kterou evaluaci production search reálně používá (v1 `evaluate` vs v2 `evaluateV2`), a italský eval-test cílit na TU aktivní.
- **Mobilita v2 × italský max-filtr (uživatel bere na vědomí):** je-li aktivní v2, mobilitní term = `MOBILITY_WEIGHT × (myMoves − oppMoves)` přes `legalMoves(ruleset)`. U italské v capture pozicích legalMoves vrací jen osekanou max množinu (často 1 tah) → mobilita je šumivější než jinde. Spadá pod „sanity, ne turnaj"; chytne to self-play. NEřešit hlouběji (rozhodnuto).
- **Testy fáze (verify + sanity):**
  - eval-test: `evaluate(pozice_s_dámou, ITALIAN_RULESET)` cení dámu 130 (short), NE 300 — potvrdí short-king cestu pro italskou (a že se omylem nedostane na flying).
  - legalita-test: AI-vybraný tah (searchRoot/bestMove) na pozici s vynuceným max braním je VŽDY prvkem `legalMoves(position, ITALIAN_RULESET)` (ctí maximum+prioritu).
  - `selfplay-italian`: italská vs italská — partie TERMINUJÍ (žádné zamrznutí/nekonečno), žádný nelegální tah, žádná zjevná blbost (metrika á la selfplay-flying-king).
- **Regrese:** evaluace ostatních variant (flying i short) beze změny; perft nedotčen (do rules se nesahá); celá suita zelená; tsc čistý. Italská NEmění existující konstanty (MAN_VALUE/KING_VALUE/KING_VALUE_FLYING) — jen je konzumuje přes ruleset.king.

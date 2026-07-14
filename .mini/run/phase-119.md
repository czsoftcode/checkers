---
phase: 119
verdict: done
steps:
  - title: "Potvrdit aktivní evaluaci + eval-test italské"
    status: done
  - title: "Legalita-test: AI vybírá jen legální italské tahy"
    status: done
  - title: "selfplay-italian sanity"
    status: done
  - title: "Brána"
    status: done
---

# Phase 119 — report z auto session

## Co se udělalo
Fáze byla podle discuss MINIMÁLNÍ: **žádné nové váhy, žádná změna produkčního kódu** — jen ověření (verify) + self-play sanity. Přidán jediný soubor: `packages/engine/test/selfplay-italian.test.ts` (5 testů, 3 describe bloky). `evaluate.ts`, `rules/` i všechny konstanty (`MAN_VALUE`/`KING_VALUE`/`KING_VALUE_FLYING`) zůstaly beze změny — potvrzeno `git status` (jen nový `??` soubor). Perft a evaluace ostatních variant jsou tím pádem nedotčené z definice.

## Která evaluace je aktivní (doloženo)
Produkční search jede na **v1 `evaluate`**:
- `search.ts:231` — `searchRoot(..., evaluateFn = evaluate, ...)` (default),
- `search.ts:491` — `searchTimed`: `const evaluateFn = options.evaluate ?? evaluate`,
- `handler.ts:225` — produkční handler volá `searchTimed(position, { timeMs, ruleset, ... })` **bez** vlastní `evaluate`.
- `evaluateV2` je použita **jen** ve `scripts/selfplay-gate.ts`, nikde v produkci.

Italská má `ruleset.king === 'short'` → `evaluate` jí dá krátkou dámu `KING_VALUE` (jako americká) zadarmo, na flying (`KING_VALUE_FLYING`) se nedostane. Eval-test proto cílí přímo na v1 `evaluate`.

## Testy a jejich zuby (po adversarial self-review)
Spustil jsem nezávislého sub-agenta (čerstvý kontext) na red-team návrhu testů. Dva reálné nálezy jsem opravil:

1. **Cross-module kontrakt (pravidlo 4):** eval-test původně porovnával natvrdo `130`/`300`. Přepsáno na produkční konstanty `KING_VALUE`/`KING_VALUE_FLYING` + assert `KING_VALUE !== KING_VALUE_FLYING` (premisa zubu). Legitimní rekalibrace ceny dámy teď test neshodí bez italsky specifické příčiny.
2. **Zavádějící zub:** případ `maxCapture` (3-braní vs 2-braní) tvrdil, že „2-braní se nevybere kvůli maximu". Sub-agent empiricky doložil, že tam material míří stejně jako maximum (3 kameny > 2), takže i americký search by 3-braní vybral — tenhle případ **nediskriminuje** rozbité plumbing. Přepsáno na poctivý zub: 2-braní je legální americky, ale ve filtrované italské množině NENÍ (kdyby filtr maxima umřel, objevilo by se) + AI-vybraný tah ∈ té množiny.

Plné zuby na plumbing `ruleset → search` nese případ **`manOverKing`** (muž 10 bere muže 15; americky by pokračoval přes dámu 24 na 28, italsky se zastaví na 19): kdyby se ruleset do searche neprotáhl, AI by vybrala nelegální přeskok dámy a assert spadne.

## Self-play sanity
`italská engine vs random`, 20 partií (á la `selfplay-flying-king.test.ts`, TIME_MS=25): **20/20 výher, 0 proher, 0 remíz** (ověřeno probe testem). Práh `MIN_WINS=12` má tedy velkou rezervu, klíčový invariant je `losses === 0`. Terminace je ohlídaná tvrdě: `expect.soft(result).not.toBe('ongoing')` vytáhne případné zamrznutí/nekonečno napovrch místo tiché remízy. Každý engine tah je nezávisle ověřen `legalMoves(ITALIAN).toContainEqual(picked)`.

## Brána (splněno mechanicky)
- Celá vitest suita zelená: rules 435, cli 24, engine 273 (vč. 5 nových), ai 57, server 206, web 660.
- `pnpm -r typecheck` čistý (všech 6 balíčků).
- `eslint` na novém souboru čistý.
- Konstanty i evaluace ostatních variant beze změny (žádný diff mimo nový test).

## Otevřené / na vědomí
- **Flaky riziko self-play:** hloubka je řízená časem (TIME_MS=25), takže trajektorie mohou být napříč stroji jiné — stejný kompromis jako u stávajícího `selfplay-flying-king` testu. Rezerva 20/20 vs práh 12 to drží, ale na velmi pomalém CI je to teoreticky citlivé. Vědomě ponecháno konzistentní s precedentem.
- **„Nezávislé ověření legality"** v self-play volá týž produkční `legalMoves` — chytne nesoulad search↔legalMoves, ne chybu samotného `legalMoves`; tu kryjí perft testy na úrovni rules. Rovněž shodné s flying precedentem.

Žádný blocker, žádné rozhodnutí typu „zvážená a zamítnutá alternativa" nad rámec discuss (rozhodnutí „nula nových vah" padlo už tam) → `/mini:decision` nepovažuji za nutné.

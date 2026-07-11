---
phase: 101
verdict: done
steps:
  - title: "Cena létavé dámy v evaluate (v1)"
    status: done
  - title: "Unit testy hodnocení"
    status: done
  - title: "Self-play sanity ve flying variantě"
    status: done
  - title: "Brána: americká beze změny + ostatní zelené"
    status: done
---

# Phase 101 — report z auto session

## Co se udělalo

Produkční evaluace (`evaluate` v1 – ověřeno, že search/`searchTimed` i `computeAiMove`
volají v1, ne v2) teď rozlišuje cenu dámy podle varianty:

- `packages/engine/src/evaluate.ts`: `evaluate` dostal volitelný param `ruleset`
  (default `AMERICAN_RULESET` → beze změny). Cena dámy = `ruleset.king === 'flying'
  ? KING_VALUE_FLYING (300) : KING_VALUE (130)`. Nová konstanta `KING_VALUE_FLYING`.
- `packages/engine/src/index.ts`: export `KING_VALUE_FLYING`.
- Search kontrakt je celý: `negamax` volá `ctx.evaluateFn(position, ctx.ruleset)`
  (search.ts:337) i v quiescence; `ctx.ruleset` staví `searchTimed`/`searchRoot`
  z options. Žádná cesta ruleset neztrácí, TT se tvoří čerstvá na volání.

## Testy

- `evaluate.test.ts`: flying rulesety (pool/ruská/česká) cení dámu na 300, american
  na 130; muži se cenou nemění; americká pozice s dámou beze změny čísel.
- `selfplay-flying-king.test.ts`:
  - **Část A (cílený search, izolovaná cena):** pevná pravidla generování tahů,
    měněná JEN cena dámy přes injektovaný `evalFn` (short 130 vs flying 300). Flying
    cena volí jiný tah než short (pool/ruská/česká) a v pool self-play si dámu udrží
    (0 vs 1). Pozice nalezena empiricky, ne od stolu.
  - **Část B (self-play sanity):** pool engine přes reálnou `searchTimed(..., {ruleset})`
    porazil random 20:0:0.
- Zelené: engine 268, ai 57, rules 382. Typecheck čistý v engine/ai/web/server.
  Americká brána engine-vs-random beze změny (100 výher, 0 proher).

## Adversariální self-review (nezávislý sub-agent) našel reálnou vadu — opravena

Fáze sahá na kontrakt mezi moduly, tak jsem před reportem pustil nezávislého
sub-agenta. Našel **skutečnou díru v zubech** původní části A testu: mísila vliv
PRAVIDEL (krátká vs létavá dáma generuje jiné tahy) s vlivem CENY. Test tvrdil,
že prokazuje dopad ceny na rozhodnutí, ale prošel by i s rozbitou cenou (král
zůstával/mizel kvůli pravidlům, ne kvůli ceně). Přepsal jsem část A na správnou
izolaci: stejná pravidla, měněná jen cena. **Ověřeno mutací** (flying → 130):
původní verze by prošla, nová verze shodí 10 testů. Zuby teď reálně měří cenu.

## Otevřené / vědomě mimo řez

- **`evaluateV2` létavou dámu ignoruje** (natvrdo `KING_VALUE`). Není to produkční
  defekt — v2 se používá jen ve `scripts/selfplay-gate.ts` (produkce jede v1,
  ověřeno). Nechal jsem ji vědomě: dát v2 flying cenu bez self-play podložení by
  bylo „od stolu", přesně to, před čím fáze varuje. Latentní past pro případ, že
  by se v2 kdy povýšila na produkční eval — kandidát na todo.
- **Offline web zatím neposílá `variant` do `computeAiMove`** (`web/src/local/
  compute-move.ts`, `local-client.ts` remízová nabídka volá `searchTimed` bez
  `ruleset`) → offline UI hraje dnes americky end-to-end. Konzistentní (ne bug),
  ale znamená to, že rozlišení ceny se projeví jen v engine subprocesu při přijetí
  `variant` a u přímých volajících `computeAiMove` s nastaveným `variant`. Napojení
  varianty do offline UI je mimo tuto fázi — todo 56 a 59 zůstávají otevřené.
- Hodnota 300 je podložena self-play sanity (poráží random, drží dámu), ne turnajovou
  silou. Pokud pozdější ladění ukáže pod/přeceňování, mění se jediná konstanta
  `KING_VALUE_FLYING`.

Verdikt: **done** — všechny 4 kroky hotové, všechny balíčky zelené, americká větev
prokazatelně beze změny.

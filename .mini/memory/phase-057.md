# Phase 57 — Kniha: víc kandidátů na pozici

**Goal:** Přepsat knihu zahájení z modelu 'jeden tah na pozici (konflikt = chyba)' na 'víc kandidátních tahů na pozici s deterministickým výběrem', aby šel v následující fázi uložit reálný větvící se strom zahájení; seed zůstává minimální (důkaz mechaniky), s testy se zuby na větvení, výběr i fallback. Mimo rozsah: naplnění reálnou teorií (další fáze), zrcadlová symetrie/transpozice, náhodný výběr pro variabilitu.

## Steps
- [done] Typ knihy: kandidáti místo jednoho tahu
- [done] Deterministický výběr v lookupBookMove
- [done] Volající app.ts na nový typ
- [done] Migrace existujících testů na nový tvar
- [done] Testy se zuby na mechaniku
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 57: Kniha: víc kandidátů na pozici

## Run report
---
phase: 57
verdict: done
steps:
  - title: "Typ knihy: kandidáti místo jednoho tahu"
    status: done
  - title: "Deterministický výběr v lookupBookMove"
    status: done
  - title: "Volající app.ts na nový typ"
    status: done
  - title: "Migrace existujících testů na nový tvar"
    status: done
  - title: "Testy se zuby na mechaniku"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Phase 57 — report z auto session

## Co se udělalo

Kniha zahájení (`packages/server/src/opening-book.ts`) přešla z modelu
`ReadonlyMap<string, Move>` („jedna pozice = jeden tah, konflikt = Error") na
`OpeningBook = ReadonlyMap<string, readonly Move[]>` („jedna pozice = seznam
kandidátů"). Tím je mechanicky připravená na příští fázi, kde se naplní reálnou
větvící se teorií zahájení.

Konkrétně:
- `buildBook` teď kandidáty **hromadí** místo přepisu; identické tahy
  **dedupuje** přes `movesEqual` (shodné prefixy linií nutně narazí na tutéž
  pozici+tah). Jediná tvrdá pojistka zůstala: **nelegální tah v seedu → Error**.
- `buildBook` je nově **exportovaný** (kvůli testům se zuby na řízeném vstupu).
- `lookupBookMove` vrací **první vložený** kandidát (`[0]`), signatura
  `Move | undefined` beze změny → volání v `app.ts:516` se nezměnilo.
- `app.ts` `BuildAppOptions.openingBook` typ na `OpeningBook`; produkční
  `SEED_LINES` **beze změny** (minimální, jedna linie) → na hru žádný dopad.

## Verifikace (mechanicky, sám)

- `pnpm -w typecheck` čistý; `pnpm lint` čistý.
- `pnpm --filter @checkers/server test`: **162 passed** (bylo 156, +6 nových
  jednotkových testů knihy).
- **Zuby ověřeny dočasným rozbitím kódu:**
  - vypnutý dedup → padne test (b) `1 kandidát (dedup)`;
  - obnovené „konflikt = Error" → padnou (a), (b), (d) (větvení/výběr).
  Po revertu vše zpět zelené.

## Self-review nezávislým sub-agentem (čerstvý kontext)

Sub-agent potvrdil OK: cross-module kontrakt klíče (seed i lookup klíčují stejným
`positionKey` z rules, testováno proti reálné `Position`), determinismus výběru
(`[0]` nad polem plněným `push`, ne iterační pořadí Map), dedup, i nedotčený
kontrakt fáze 30 (knižní tah dorazí až pollingem).

Dva jeho nálezy jsem **opravil hned** (levné, míří na checklist „tichá záměna"):
1. Reexport `OpeningBook` a `buildBook` z `index.ts` (veřejné API `BuildAppOptions`
   je typu `OpeningBook`, ale typ šel dřív jen strukturálně).
2. **Kanárkový test (f)** nad produkčním `OPENING_BOOK`: každá pozice smí mít
   právě 1 kandidát (seed je lineární). Chytí neúmyslnou kolizi v seedu hned –
   bez něj by zrušení „konflikt = Error" nechalo omylem přidaný legální kolizní
   tah tiše čekat na indexu 1+ a ve fázi 58 (náhodný výběr) by začal kazit hru.
   Až fáze 58 přidá záměrné větvení, tento test se vědomě upraví.

Nálezy nechané vědomě (nízké): typ `OpeningBook` nevynucuje neprázdný seznam
(past `undefined` na existujícím klíči) – `buildBook` prázdný seznam nikdy
nevytvoří, riziko jen u ručně injektované knihy v testech; drží dokumentační
slib, ne runtime guard.

## Poznámky pro člověka

- Bez dopadu na hru: produkční seed i chování počítače v úvodu partie jsou
  stejné jako po fázi 56. Tohle je čistá interní příprava.
- CHANGELOG zapsán do `[Unreleased]` jako `Changed` (žádný version bump – nic
  uživatelsky viditelného).
- Rozhodnutí modelu (seznam kandidátů + deterministický výběr `[0]` místo
  náhody, dedup místo Erroru) padlo přímo z projektové vize a nemá zavržený
  vážný protinávrh → ADR jsem nezakládal.

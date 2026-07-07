---
phase: 53
verdict: done
steps:
  - title: "Store: nasadit ballot podle daného indexu"
    status: done
  - title: "zod: volitelný ballotIndex v těle POST /games"
    status: done
  - title: "Route: validace rozsahu + cross-field, předání do store"
    status: done
  - title: "Testy se zuby + ověření unhappy path"
    status: done
---

# Phase 53 — report z auto session

## Co je hotové
Server umí přijmout v `POST /games` volitelný `ballotIndex` a nasadit fixní 3-move ballot místo losu. Vše ověřeno mechanicky (typecheck + 146 testů + lint zelené), nic nezůstává pro lidské oko.

**Store (`store.ts`):**
- Vyextrahována privátní `applyBallotByIndex(index)` — „přehraj `THREE_MOVE_BALLOTS[index]` přes playBallot → advanceState". Los (`seedBallot`) i fixní nasazení ji sdílí → jeden zdroj pravdy o popballotové pozici, žádná duplikace smyčky.
- `create` má nový volitelný parametr `ballotIndex`. Když je zadaný u championship → nasadí fixní; jinak losuje. `RangeError` na neplatný index zůstává (programová chyba → 500). Guard: `ballotIndex` s ne-championship úrovní hodí RangeError (proti tichému zahození indexu; route to blokuje 400 dřív).

**Route + schema (`app.ts`):**
- zod `createGameBodySchema` má `ballotIndex: z.number().int().nonnegative().optional()` — ověří TYP (celé číslo ≥ 0); špatný typ/záporné/neceločíselné/NaN/Infinity → 400 už z parse.
- Route po parse ověří to, co zod nevidí: rozsah `< THREE_MOVE_BALLOTS.length` (import z `@checkers/rules`) a cross-field pravidlo „index jen s championship". Obojí → 400 s cílenou zprávou PŘED voláním store (klientský špatný index se tak nikdy nedostane do store, kde by dal 500).
- DTO se nemění (`ballotIndex` už v odpovědi byl).

## Klíčová vlastnost potvrzená
Fixní ballot je **barvově agnostický** — nesahá na `humanColor` ani spouštění enginu. Index vždy vyrobí tři půltahy (černý-bílý-černý); kdo je engine řeší existující `maybeTriggerEngine`. Kolo 2 (otočená barva z fáze 52) funguje bez zásahu do barevné logiky. Doloženo testem „stejný index, obě barvy → stejné tahy".

## Testy se zuby (ověřeno)
Dočasně jsem nechal `create` ignorovat `ballotIndex` (vždy los) → **3 testy spadly** (store „nasadí právě ten ballot", „barvově agnostický", API „přes API ne los"). Po revertu zase zelené. Teeth využívají řízený rng (`() => 0`) napevno na JINÝ index, než jaký se posílá — ignorovaný index se tím pozná.

Route unhappy-path pokryté (všechny 400 invalid_request): index = délka decku, záporný, neceločíselný, `ballotIndex` + Začátečník. Regrese: championship bez indexu pořád losuje; ostatní úrovně beze změny.

## Nezávislý self-review
Fáze sahá na vstupní bod (`POST /games`), chybové cesty (400 vs 500) i cross-module kontrakt (route ↔ store ↔ rules deck) → spuštěn nezávislý sub-agent s čerstvým kontextem. **Žádný potvrzený ani pravděpodobný nález.** Ověřil dvouvrstvou obranu (klient se nikdy nedostane na 500), hranice rozsahu (off-by-one OK), chování zodu na NaN/Infinity/obří čísla/string, barvovou agnostiku, čistotu refaktoru losu a že chybová cesta nezanechá polovičatou partii v store (`seeded` se počítá před `games.set`). Jediná zmínka byla kosmetická: zod-parse hláška nezmiňovala `ballotIndex` — **opraveno** (doplněno do textu).

## Mimo rozsah (navazující klientská fáze)
Rytmus „2 kol", LocalStorage a auto-start kola 2 zůstávají na klientovi. Tahle fáze dodala jen serverovou podporu, kterou fáze 52 odložila.

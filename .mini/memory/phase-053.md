# Phase 53 — Server: fixní ballot parametrem partie

**Goal:** POST /games na úrovni Mistrovství přijme volitelný ballotIndex; když je zadaný, server ho po ověření rozsahu (0 ≤ i < délka THREE_MOVE_BALLOTS) nasadí jako vynucené zahájení stejnou autoritativní cestou (playBallot → advanceState) místo náhodného losu. Chybějící index = normální náhodný los (degradace pro starší klienty), index mimo rozsah nebo špatný typ = 400 (žádný tichý fallback). Rytmus 2 kol a LocalStorage zůstávají mimo tuto fázi (navazující klientská fáze).

## Steps
- [done] Store: nasadit ballot podle daného indexu
- [done] zod: volitelný ballotIndex v těle POST /games
- [done] Route: validace rozsahu + cross-field, předání do store
- [done] Testy se zuby + ověření unhappy path

## Auto-commit
- Phase 53: Server: fixní ballot parametrem partie

## Discussion
# Phase 53 — Server: fixní ballot parametrem partie

## Intent
Dnes server ballot VŽDY losuje (`store.seedBallot` → `Math.floor(rng() * THREE_MOVE_BALLOTS.length)`).
Tahle fáze přidá do `POST /games` volitelný `ballotIndex`, kterým klient řekne „nasaď TENHLE ballot"
místo losu. Účel: umožnit navazující klientské fázi přehrát v kole 2 Mistrovství STEJNÉ zahájení jako
v kole 1. Server zůstává jediná autorita — klientovi nevěří, ověří rozsah indexu a ballot nasadí SVOU
cestou (`playBallot` → `advanceState`), stejně jako u losu.

Rozsah TÉTO fáze = jen server (příjem + validace + nasazení fixního indexu). Rytmus 2 kol, LocalStorage
a auto-start kola 2 jsou navazující KLIENTSKÁ fáze.

## Key decisions
- **1a — rozsah validovat v route, vrátit 400.** `seedBallot` na špatný index hází `RangeError`, který
  error handler (`app.ts:99`) překlápí na 500. Špatný `ballotIndex` je ale KLIENTSKÝ vstup → musí být 400.
  Proto route ověří `Number.isInteger(i) && 0 <= i < THREE_MOVE_BALLOTS.length` PŘED voláním store a na
  neshodě vrátí 400. Store dostane už zaručeně platný index (jeho interní `RangeError` zůstává pro
  programovou chybu = broken rng → 500, to je správně).
- **2a — `ballotIndex` u ne-Mistrovství úrovně = 400.** Mimo `championship` se ballot nenasazuje. Poslat
  `ballotIndex` s jinou úrovní je nesmyslná kombinace = klientská chyba → 400, ne tiché ignorování
  (tiché ignorování maskuje klientskou chybu, viz projektový checklist „žádný tichý falešný úspěch").
- **3 — rytmus „2 kol":** kolo 1 losem, klient si zapamatuje `ballotIndex`, kolo 2 pošle STEJNÝ index
  + otočenou barvu (barva už z fáze 52). Po 2 kolech RESET a KONEC — další partii vyvolá člověk tlačítkem
  „Nová hra". Automatické je JEN kolo 2. Celé tohle chování je klientské = mimo tuhle fázi.

## Watch out for
- **Fixní ballot je barvově AGNOSTICKÝ — barvy se v této fázi NEDOTÝKÁME.** Index vždy vyrobí stejné tři
  půltahy (černý–bílý–černý) bez ohledu na `humanColor`. Kdo je po ballotu na tahu první, řeší existující
  `maybeTriggerEngine` (spustí engine, jen když `turn === opposite(humanColor)`): kolo 1 (člověk černý) →
  po ballotu bílý = engine táhne první; kolo 2 (člověk bílý) → po ballotu bílý = člověk táhne. Obojí už
  funguje bez zásahu do barevné logiky. Nepřidávat žádnou vazbu ballot↔barva.
- **Nepustit klientský špatný index přes store (→ 500).** Range check MUSÍ být v route před `store.create`,
  jinak `seedBallot`/`playBallot` hodí `RangeError` a dostaneme 500 místo 400.
- **Refaktor bez duplikace autoritativní cesty:** `seedBallot` (los) a nový fixní nasazovací kód musí sdílet
  „přehraj ballot podle indexu přes advanceState" — los jen navíc index vylosuje. Neduplikovat playBallot→
  advanceState smyčku, ať zůstává JEDEN zdroj pravdy o tvaru popballotové pozice.
- **zod vs. route:** zod ověří TYP (`ballotIndex` volitelný integer ≥ 0) → 400 na špatný typ. Rozsah proti
  délce decku a cross-field pravidlo (index + ne-championship) ověří route → 400 s cílenou zprávou.
  (Alternativně zod `superRefine`, ale route dává jasnější hlášky; obojí je 400.)
- **`THREE_MOVE_BALLOTS.length` do app.ts:** dnes se importuje jen ve `store.ts`; route ho bude potřebovat
  pro range check → import z `@checkers/rules`.
- **DTO se nemění:** `ballotIndex` už v odpovědi je (`dtoFor` → `gameToDto`). Fixní i losovaný index se
  vrací stejně, klient nepozná rozdíl v tvaru.
- **Test se zuby:** create s `ballotIndex=k` (rng napevno na JINÝ index) → `record.ballotIndex === k` a
  první tři tahy = `THREE_MOVE_BALLOTS[k]`. Kdyby create index ignoroval a losoval, test padne. Plus:
  index mimo rozsah / záporný / neceločíselný → 400; `ballotIndex` + Začátečník → 400; chybějící index na
  Mistrovství → normální los pořád funguje (degradace pro starší klienty).

## Run report
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

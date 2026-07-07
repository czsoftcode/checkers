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

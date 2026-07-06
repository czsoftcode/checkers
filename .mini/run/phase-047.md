---
phase: 47
verdict: done
steps:
  - title: "Úroveň championship v levels.ts"
    status: done
  - title: "Seedovatelný picker ballotu na serveru"
    status: done
  - title: "Los + nasazení v store.create (+ ballotIndex)"
    status: done
  - title: "POST /games spustí engine po ballotu"
    status: done
  - title: "Testy se zuby"
    status: done
  - title: "Verifikace + nezávislý self-review"
    status: done
verify:
  - title: "Reálný engine (ne stub) po ballotu odehraje bílého do limitu"
    detail: "Nový integrační bod: POST /games teď u Mistrovství spouští engine hned při založení. V CI je ověřený jen in-process stubem (engine-move.test); s reálným podprocesem enginu tenhle konkrétní start (bílý táhne první z popballotové pozice) v testech neběží. Plné odklikání navíc čeká na klientskou fázi – Mistrovství zatím nejde vybrat z UI."
---

# Phase 47 — report z auto session

## Co je hotové
Server umí úroveň Mistrovství (`championship`): při `POST /games` s touto úrovní
vylosuje jeden ze 156 třítahových zahájení a nasadí ho. Partie začíná
popballotovou pozicí s **bílým (engine) na tahu** a třemi tahy v historii; engine
se proto spouští **už při založení** (u ostatních úrovní začíná černý/člověk, tam
je to no-op → zpětně kompatibilní).

Konkrétně:
- `levels.ts`: `championship` v `LEVELS`, `STRENGTH_BY_LEVEL.championship = undefined`
  (plná síla jako Profesionál; rozdíl je jen vynucené zahájení).
- `prng.ts` (nový): kopie `mulberry32` (NEimportuje se z cli/rules – vědomá duplicita).
- `store.ts`: konstruktor bere injektovaný `rng` (default `Math.random`); `seedBallot`
  vylosuje index, `playBallot` spáruje tahy proti reálným `legalMoves`, tři `Move`
  se přehrají přes `advanceState`. `ballotIndex` (index nebo `null`) je nové pole
  v `StoredGame`/`GameRecord`.
- `dto.ts`: `GameDto.ballotIndex` (aditivní pole, klient ho zatím nemusí číst).
- `app.ts`: `buildApp` propouští `rng` do store; `POST /games` po `create` loguje
  vylosovaný ballot a volá `maybeTriggerEngine`, odpověď nese čerstvý `engineStatus`.

## Testy (zuby)
- `ballot.test.ts` (nový): deterministický los na seed; invariant po ballotu
  (bílý na tahu, černých 12, bílých 11–12, 3 tahy); **všech 156 ballotů** projde
  reálnou cestou rules (řízený rng přes střed intervalu); neballotové úrovně →
  `ballotIndex null`, výchozí rozestavění; rozbitý rng → `RangeError` (guard).
- `engine-move.test.ts`: Mistrovství → 201, bílý na tahu, `engineStatus 'thinking'`,
  engine dotáhne na pozadí (překlopí na černého) = **engine táhl první**; kontrolní
  test, že professional POST engine NEspustí.
- `levels.test.ts`, `dto.test.ts` doplněny/opraveny (nový 6. arg `gameToDto`).
- Celá suite zelená: server 122/122, rules/cli/engine/web beze změny. Lint + typecheck čisté.

## Nezávislý self-review (čerstvý kontext)
Sub-agent proběhl mutačně (rozbil produkční kód, spustil testy, vrátil zpět).
**Žádný blokující nález.** Ověřeno, že testy chytnou: posun indexu o 1, „vždy index 0",
vypnutý guard i mock místo reálné cesty. Chybové cesty (NaN/záporný/≥1 rng) končí
hlasitým `RangeError`. `engineStatus 'thinking'` v odpovědi je deterministický (žádný
race – `runEngineMove` se zastaví na prvním `await`).

Nálezy nízké závažnosti a jak jsem s nimi naložil:
1. **Odůvodnění přehrání přes advanceState bylo v komentáři nepravdivé** – tvrdilo,
   že čítače remízy „musí odrážet tři půltahy, ne začínat od nuly". Realita: všech
   156 ballotů má na 3. půltahu pokrok, takže čítače končí na nule tak jako tak;
   přehrání je funkčně ekvivalentní převzetí hotové pozice. **Opraveno** – komentář
   teď říká pravdu (přehrání drží jeden zdroj pravdy o tvaru `GameState` a je robustní,
   ne že mění chování). Není to bug, jen zavádějící zdůvodnění.
2. **Web klient neaktualizován** – `server-client.ts` nezná `championship` ani
   `ballotIndex`. Záměrně: rozsah je jen server, runtime guard extra pole ignoruje,
   nic se nerozbije. Mistrovství zatím **nejde vybrat z UI** – to je navazující fáze.
3. `console.log` na každou Mistrovství partii je vědomý (log losu kvůli
   ověřitelnosti/férovosti), ne chyba.

## Vědomě mimo rozsah
- **Zotavení z `error` po pádu enginu** (i na tahu 0 u Mistrovství) – stávající
  chování napříč všemi úrovněmi, ne specifikum této fáze. Doporučeno založit
  samostatnou backlog položku (probráno v diskusi).
- **Klientský výběr úrovně + orientace desky + název zahájení** – navazující fáze.
- **Volba barvy / turnajová férovost** (2× s prohozenými barvami) – jiná fáze;
  člověk hraje vždy černou.

## Poznámka
Padl jeden reálný trade-off (přehrání ballotu přes `advanceState` vs. převzetí
hotové pozice z `playBallot`). Není to ostrá křižovatka se zamítnutou alternativou –
obě cesty dají identický stav – takže ADR asi netřeba. Pokud to chceš zachytit,
`/mini:decision` před `/mini:done`.

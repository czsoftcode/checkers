---
phase: 8
verdict: done
steps:
  - title: "Klíč pozice a typ GameState"
    status: done
  - title: "Posun stavu po tahu (advanceState)"
    status: done
  - title: "Výsledek stavu s remízami"
    status: done
  - title: "Test terminace seedovaným playoutem"
    status: done
  - title: "Export API a zelený workspace"
    status: done
---

# Phase 8 — report ze session

## Co vzniklo
- `packages/rules/src/state.ts` (nový): `positionKey` (textový klíč: strana na tahu + 32 znaků desky, poškozenou pozici včetně děr a nesmyslných buněk odmítá RangeError), `GameState` (immutable: pozice + `pliesWithoutProgress` + `repetitionHistory`), `initialGameState`, `advanceState` (pokrok = braní nebo tah mužem → čítač 0 a historie zahozená; prostý tah dámou → čítač +1), konstanta `MAX_PLIES_WITHOUT_PROGRESS = 80`.
- `packages/rules/src/result.ts`: `GameResult` rozšířen o `'draw'`; `gameResultFromState` – pořadí: prohra bez tahu (přednost, rozhodnutí z diskuse) → remíza čítačem ≥ 80 → remíza trojím opakováním.
- Testy: `test/game-state.test.ts` (25 testů) a `test/termination.test.ts` (50 seedovaných partií random vs random, všechny terminují, deterministický PRNG mulberry32 – žádný Math.random).
- Exporty z `index.ts`; celý workspace zelený (lint + typecheck + 217 testů rules).

## Nad rámec plánu (z nezávislého self-review)
Fáze zavádí kontrakt mezi moduly, takže dle CLAUDE.md proběhl self-review sub-agentem s čerstvým kontextem. V jádru remízové logiky chybu nenašel; tři nálezy jsem opravil:
1. **Kontrakt „vyhodnoť po každém půltahu"** byl nevyslovený – dávkové přehrání tahů mohlo remízu „přejet". Detekce opakování teď počítá KTERÝKOLI klíč v historii (ne jen aktuální pozici), takže opakování uvnitř úseku bez pokroku se dohledá i zpětně; kontrakt je explicitně v docstrinzích `advanceState` i `gameResultFromState`. Zbytková mez: remízu z ČÍTAČE přejetou pokrokem zpětně dohledat nelze (informace je resetem zničená) – proto kontrakt per-půltah platí dál a server (todo 16/17) ho musí dodržet.
2. **`positionKey` sliboval víc, než dělal** – díra v poli a nesmyslná buňka se serializovaly tiše (dvě různě poškozené desky mohly sdílet klíč). Teď RangeError, přibito testy.
3. **Doplněné testy:** přednost prohry i před opakováním (ne jen před čítačem), stejná deska s jinou stranou na tahu se nepočítá, retro-detekce opakování, poškozený stav propaguje RangeError.

## Ověření, že testy mají zuby (mutace)
Čtyři dočasné mutace zdrojáku, každá shodila testy: práh opakování 3→2, práh 3→4, pokrok bez tahu muže, vypnutá přednost prohry. Vše vráceno, finální stav zelený.

## Unhappy path (projito)
- Poškozená pozice (krátká deska, cizí turn, díra, nesmyslná buňka) → RangeError, žádný tichý klíč.
- Strukturálně neplatný tah v `advanceState` → RangeError z `applyMove`, vstupní stav nezmutovaný.
- Ručně poskládaný nekonzistentní `GameState` → nevede na falešnou remízu (počítá se jen to, co v historii opravdu je).
- `advanceState` na skončeném stavu projde bez chyby – vědomé, zdokumentované (server hlídá konec sám).

## Poznámky
- Během mutační kontroly mi `git checkout` omylem vrátil `result.ts` na verzi z HEAD – obnoveno z kontextu, finální běh testů to potvrzuje (217/217).
- Empirický test terminace (50 partií) je pojistka, ne důkaz – skutečná garance plyne z pravidla 80 půltahů + konečného počtu pokroků (~16 000 půltahů teoretická mez, strop testu 5 000).
- Žádné rozhodnutí typu „zvážená a zamítnutá alternativa" nad rámec diskusních poznámek nevzniklo – ADR není potřeba.

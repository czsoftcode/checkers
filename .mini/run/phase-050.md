---
phase: 50
verdict: done
steps:
  - title: "Store: humanColor v záznamu + resign podle barvy"
    status: done
  - title: "POST /games: přijmout a předat humanColor"
    status: done
  - title: "app.ts: engine podle uložené barvy na všech místech"
    status: done
  - title: "DTO: humanColor v GameDto"
    status: done
  - title: "Integrační test human=white end-to-end + regrese"
    status: done
---

# Phase 50 — report z auto session

## Co je hotové
Barva enginu přestala být konstanta `ENGINE_COLOR='white'`. Barva ČLOVĚKA
(`humanColor`) je teď uložená u partie a engine hraje opačnou stranu
(`opposite(humanColor)`). Vše se řídí uloženou barvou:

- **store.ts** — `GameRecord`/`StoredGame` mají `humanColor` (readonly); `create(level, humanColor='black')`;
  nový čistý helper `opposite()`. `resign()` už NEnastavuje natvrdo `white-wins`, ale výhru enginu =
  `opposite(humanColor)+'-wins'` (člověk černý → white-wins, člověk bílý → black-wins).
- **app.ts** — nová funkce `engineColorOf(record)`; nahrazeny VŠECHNY výskyty `ENGINE_COLOR`
  (maybeTriggerEngine, dva guardy v runEngineMove, guard /moves, guard /hint). Nabídka remízy počítá
  `engineScore` z pohledu enginu; konstanta přejmenovaná `DRAW_ACCEPT_MAX_WHITE_SCORE → DRAW_ACCEPT_MAX_ENGINE_SCORE`.
  Chybové hlášky „(bílý)" zobecněny na „počítač". `POST /games` přijímá `humanColor` (enum, default black,
  neznámá → 400) a předává do store; `dtoFor` předává `humanColor` do DTO.
- **dto.ts** — `humanColor` v `GameDto` + parametr `gameToDto()` (aditivní).
- **index.ts** — re-export `opposite`.

## Ověření (vše mechanicky, sám)
- `pnpm lint` čistý, `pnpm typecheck` (všechny 4 balíky) čistý.
- Server testy: **137 passed** (bylo 128 + 9 nových). Celý workspace zelený (cli, web 207, engine 250).
- Nové testy s zuby (padnou při návratu k napevno 'white'): `store.test.ts` (resign obou barev, default black),
  `dto.test.ts` (humanColor v DTO), `human-color.test.ts` (9 testů: engine se spustí u human=white,
  zpětná kompat. u default black, neznámá barva → 400, guard /moves i /hint, vzdání → black-wins + PDN 0-1,
  práh remízy z pohledu enginu accept/reject, **Mistrovství+white: po ballotu engine netáhne**).

## Poznatek z implementace
Klíčové zjištění z diskuse se potvrdilo: když je člověk bílý, engine je černý a **táhne první i v normální
partii** (ne jen po ballotu). Řeší to už existující volání `maybeTriggerEngine` v `POST /games` (přidané ve
fázi 47 kvůli ballotu) — s per-record barvou se prostě stane aktivní i mimo Mistrovství. Žádná nová spouštěcí
logika. Ballot beze změny: po 3 půltazích je na tahu bílý; když je bílý člověk, engine (černý) netáhne (test to drží).

## Self-review
Nezávislý sub-agent (čerstvý kontext) nenašel žádnou chybu barvy/znaménka/tichého selhání; potvrdil, že testy
mají zuby. Jeho jediný platný nález (Mistrovství+white bez testu = bod 5 cíle bez zubů) jsem doplnil, plus test
guardu /hint pro obrácenou barvu. Stylové nálezy (8 pozičních argumentů `gameToDto`, čitelnost ternáru v resign)
jsou bez dopadu na chování, nechal jsem je.

## Rozsah / navazuje
Klient se NEMĚNIL (dnešní klient barvu neposílá → default black → beze změny; `isGameDto` je permisivní,
nové pole ignoruje). Orientace desky podle barvy = fáze 51. Střídání barvy + 2 kola v Mistrovství (2×
LocalStorage) = fáze 52.

Žádný zásadní rozcestník s odmítnutou alternativou → ADR (`/mini:decision`) není potřeba; klíčová rozhodnutí
(`humanColor` všude, barva v DTO už teď) padla v diskusi a jsou v `.mini/discuss/phase-050.md`.

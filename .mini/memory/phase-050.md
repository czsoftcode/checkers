# Phase 50 — Server: barva hráče parametrem partie

**Goal:** Server při POST /games přijme barvu člověka (bílá/černá), uloží ji k partii a engine hraje druhou barvu — spouštění tahu enginu (i po nasazení ballotu v Mistrovství), validace tahů i skóre remízy jdou podle uložené barvy, ne podle napevno 'white'; chybějící barva v požadavku = dnešní default (člověk černý, engine bílý). Zpětná kompatibilita: stávající klient bez barvy funguje beze změny.

## Steps
- [done] Store: humanColor v záznamu + resign podle barvy
- [done] POST /games: přijmout a předat humanColor
- [done] app.ts: engine podle uložené barvy na všech místech
- [done] DTO: humanColor v GameDto
- [done] Integrační test human=white end-to-end + regrese

## Auto-commit
- Phase 50: Server: barva hráče parametrem partie

## Discussion
# Phase 50 — Server: barva hráče parametrem partie

## Intent
Nahradit natvrdo zadrátovanou barvu enginu (`ENGINE_COLOR = 'white'` v `app.ts`) a předpoklad
„člověk = černý" údajem uloženým U PARTIE, aby engine mohl hrát i černou a člověk bílou. Klient
ani střídání barvy se NEŘEŠÍ (fáze 51 = orientace desky, 52 = střídání + 2 kola v Mistrovství).
Fáze 50 zůstává **barvě-agnostická**: dostane barvu, posadí engine na opačnou stranu, ballot
losuje beze změny. Default = dnešek (člověk černý, engine bílý) → plná zpětná kompatibilita.

## Key decisions
- **Jeden pojem `humanColor` všude** (potvrzeno uživatelem): pole v těle `POST /games`
  (`humanColor: 'white' | 'black'`, default `'black'`), v `GameDto` i v `GameRecord`. `engineColor`
  si server dopočítá jako opačnou barvu (helper `opposite()` / obdoba z rules). Neznámá hodnota → 400
  (jako u `level`). Sedí to na model „barva člověka se uloží v LocalStorage" a na klientské fáze.
- **Barva se vystaví v `GameDto` už v této fázi** (potvrzeno): přidat `humanColor` do `GameDto` +
  `gameToDto()` **aditivně** (starý klient extra pole ignoruje). Je to kontrakt, ze kterého klient
  ve fázi 51 orientuje desku; bez něj by fáze 50 nešla ověřit z pohledu klienta.
- **Championship párování (kdo je v 1./2. kole jaká barva, 2× LocalStorage) je mimo fázi 50**
  (potvrzeno) → patří do fáze 52. Fáze 50 na barvu jen reaguje, neurčuje ji.

## Watch out for
Zadrátovaná barva / „člověk=černý" je na 7 místech, VŠECHNA musí jít podle uložené barvy:
1. `maybeTriggerEngine` (app.ts:396) – `turn === ENGINE_COLOR` → per-record engineColor.
2. `runEngineMove` – dva guardy (app.ts:444, 468).
3. **Nabídka remízy** (app.ts:218–232): `whiteScore` + práh `DRAW_ACCEPT_MAX_WHITE_SCORE` počítají
   z pohledu BÍLÉHO. Musí být z pohledu **enginu**: `turn === engineColor ? score : -score`, konstantu
   přejmenovat na engine-pohled (`DRAW_ACCEPT_MAX_ENGINE_SCORE`). Sémantika při engine=bílý beze změny.
4. guard nápovědy `/hint` (app.ts:281) a 5. guard tahu `/moves` (app.ts:351).
6. **`store.resign()` (store.ts:235) natvrdo `white-wins`** – NEJZÁLUDNĚJŠÍ past. Vzdání = „vyhrává
   engine", což je `white-wins` jen když je engine bílý; při engine=černý musí být `black-wins`.
   `resign` musí barvu enginu znát (čte z uloženého `humanColor` záznamu, ne konstanta).
7. Chybové hlášky mají v textu natvrdo „(bílý)" (app.ts:286, 356; komentáře 145–148, 164, 181) –
   při obrácené barvě lžou. Zobecnit („počítač") nebo dosadit reálnou barvu enginu.

Další:
- **Engine táhne první i v NORMÁLNÍ partii, když je člověk bílý.** `maybeTriggerEngine` se už dnes
  volá v `POST /games` (kvůli ballotu, fáze 47) → s engineColor=černý se sám spustí. Žádná nová
  spouštěcí logika netřeba; jen se ta existující stane aktivní i mimo Mistrovství. Ověřit testem.
- **Ballot beze změny.** `seedBallot` vždy udělá 3 půltahy (černý-bílý-černý) → po ballotu je na tahu
  bílý. Když je bílý člověk (engine černý), engine po ballotu NETÁHNE (správně). Nepřidávat výjimku.
- **PDN archiv:** `formatGamePdn` mapuje výsledek podle BARVY (`white-wins`/`black-wins`/`draw`), ne
  podle „člověk". Takže stačí, aby `resign` produkoval správnou barvu; ověřit, že formatGamePdn je
  opravdu barvě-orientovaný (ne „human wins"), jinak by archiv u obrácené barvy lhal.
- **Testy se zuby (nová větev human=white / engine=black):**
  (a) `POST /games` bez ballotu → engine (černý) hned `thinking` (dřív idle);
  (b) `resign` člověkem (bílý) → `black-wins` (ne white-wins);
  (c) `/moves`: člověk pošle bílý tah → přijme; pošle černý (enginův) tah → 409 not_your_turn;
  (d) nabídka remízy: práh se počítá z pohledu enginu (černého);
  (e) DTO nese `humanColor`.
  Všechny STÁVAJÍCÍ serverové testy (bez barvy v těle) musí zůstat zelené = default black.
- **Klient `isGameDto`:** přidání `humanColor` do DTO je aditivní; ověřit, že klientská validace
  extra/nové pole neodmítá (nemá strict schema). Úprava klienta je až fáze 51.
- **Fáze sahá na kontrakt server↔klient (DTO) a na chybové cesty (resign/remíza/guardy) →** dle
  projektového CLAUDE.md u `mini do` pustit nezávislý sub-agent self-review (čerstvý kontext).

## Run report
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

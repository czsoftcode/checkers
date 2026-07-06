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

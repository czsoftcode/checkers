---
phase: 56
verdict: done
steps:
  - title: "Kniha: modul, seed a lookup (server)"
    status: done
  - title: "Allowlist úrovní s knihou (levels.ts)"
    status: done
  - title: "Integrace do cesty tahu soupeře (app.ts)"
    status: done
  - title: "Integrační testy se zuby (server)"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
verify:
  - title: "Reálná hra: soupeř zahraje knižní tah v zahájení (Profesionál)"
    detail: "Mechanicky (testy, typecheck, build) ověřeno, že server při zásahu knihy zahraje knižní tah bez volání enginu a jinak hledá jako dřív. V reálném prohlížeči jsem to nespustil (sandbox × tvůj localhost se nepotkají). Dnešní seed je ZÁMĚRNĚ minimální (linie 11-15 23-19 9-14 22-17), takže zásah nastane jen když se partie touhle linií vydá – na běžnou hru to teď má skoro nulový viditelný dopad. Pokud chceš efekt vidět, dá se dočasně rozšířit seed, nebo počkat na obsahovou fázi. Doporučuju /mini:verify až s reálnou knihou."
---

# Phase 56 — report z auto session

## Co je hotové
Kniha zahájení na SERVERU (ne v enginu), konzultovaná v cestě tahu soupeře:

- **`opening-book.ts`** – `OPENING_BOOK` jako `ReadonlyMap<string, Move>` klíčovaná
  `positionKey` z rules (kanonická serializace pozice + strana na tahu, žádný hash →
  bez kolizí). Seed se NEbuduje ručně psanými klíči ani 32-buňkovými deskami, ale
  PŘEHRÁNÍM reálných pravidel od výchozí pozice (`buildBook`), takže klíče i tahy jdou
  z jednoho zdroje a nemůžou se rozejít s tím, co server klíčuje za běhu. Nelegální
  seed / konflikt = Error při načtení modulu (fail loud). `lookupBookMove(book, pos)`.
- **`levels.ts`** – explicitní allowlist `LEVELS_WITH_BOOK` (professional, championship,
  education) + `levelUsesBook(level)`. Vědomě NE odvození z `STRENGTH_BY_LEVEL === undefined`:
  „plná síla" a „používá knihu" jsou dvě různé věci; přidání úrovně vynutí rozhodnutí
  (hlídá test přes `Record<GameLevel, boolean>`).
- **`app.ts` `runEngineMove`** – před `engine.bestmove`: když `levelUsesBook` a lookup
  vrátí tah legální dle `findLegalMove`, zahraje se knižní tah BEZ volání enginu; jinak
  fallback na hledání. Nelegální/chybějící knižní tah → fallback (NE stav `error`).
  `buildApp` dostal volitelný `openingBook` (default `OPENING_BOOK`) jako testovací seam.

## Zásadní nález během implementace (a jak vyřešen)
Knižní tah se počítá SYNCHRONNĚ (žádný `await`). Přes `void runEngineMove(...)` by se
tak aplikoval ještě uvnitř handleru `POST /games` / `/moves` a odpověď by nesla tah už
hotový místo `thinking` – rozbitý kontrakt „engine táhne, klient dopolluje" (fáze 30),
navíc u partie, kde engine (černý) táhne první z výchozí pozice (ta JE v knize). Chytily
to 3 testy `human-color.test.ts`. **Řešení:** u knižního tahu `await Promise.resolve()`
před aplikací → HTTP odpověď na spouštěcí request odejde dřív, tah dorazí až pollingem
(stejně jako u enginu). Dva testy guardu barvy dostaly injektovanou prázdnou knihu –
legitimní izolace (testují barvu/hint, ne knihu; jinak by engine zahrál knižní tah a
premisa „pozice zamrzne na tahu enginu" by neplatila).

## Ověřeno mechanicky
- Typecheck (celé repo), lint, build – čisté.
- **Testy zelené: server 156, rules 266, engine 250, web 244, cli 24.**
- **Zuby ověřeny reálným rozbitím:** dočasné vypnutí knihy v `app.ts` shodilo integrační
  test 1 (engine.calls 0→1, knižní tah se neaplikoval); revert vrátil zeleno.
- Integrační testy se stub enginem POČÍTAJÍCÍM volání: zásah → `engine.calls===0` +
  aplikace KNIŽNÍHO tahu (odlišného od stubu); miss → volá; oslabená úroveň na pozici
  v knize → přesto volá; nelegální knižní tah → fallback, `ongoing`.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Sub-agent nenašel KRITICKÝ ani STŘEDNÍ nález. Potvrdil korektnost timingu/yieldu (v obou
větvích je await PŘED `applyMove`, DTO je snímek), fallbacku na nelegální knižní tah,
gate úrovní (`levelUsesBook` jediná brána, `/hint` mimo, championship se enginu v ballotu
neptá) i serializačního kontraktu (seed z reálných pravidel). Drobné nálezy zpracovány:

- **NÍZKÝ (opraveno):** `movesEqual` porovnával jen délku `captures`, ne obsah – latentní
  chyba helperu, kdyby seed časem obsahoval braní. Doplněno porovnání prvků.
- **NÍZKÝ (dokumentováno):** pre-await guard v `runEngineMove` nechává `thinking` – dnes
  NEDOSAŽITELNÉ (guard je před prvním awaitem), ale můj přidaný `await` dělá async
  strukturu subtilnější. Přidán komentář s invariantem „musí zůstat před prvním awaitem".
- **Kosmetika (upřesněno):** komentář v `levels.ts` o championship/ballotu – kniha se u
  Mistrovství konzultuje i post-ballot (jen se dnešním seedem mine), formulace upřesněna.

## Vědomé trade-offy (ne bug)
- **Minimální seed:** kniha je jen kostra (jedna linie). Na hru to teď má skoro nulový
  viditelný dopad – smysl je mechanika, obsah přijde v pozdější fázi.
- **Zrcadlová symetrie neřešena:** kniha netrefí zrcadlově transponované pozice. Vědomé,
  do obsahové fáze.
- **Nápověda (`/hint`, Výuka) mimo knihu:** zůstává vždy plná síla; kniha se týká tahů
  soupeře, ne nápovědy (schváleno v diskusi).

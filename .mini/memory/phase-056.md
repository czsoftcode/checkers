# Phase 56 — Opening book: formát a lookup (Profesionál)

**Goal:** Engine na úrovni Profesionál (professional) před vlastním hledáním nahlédne do statické knihy zahájení (pozice→tah, klíčováno stávajícím Zobristem) a zahraje knižní tah, je-li pozice v knize; jinak hledá jako dnes. Fáze dodá formát knihy, loader a integraci do search cesty s minimální seed knihou a testy se zuby. Kniha se aktivuje JEN pro professional (Začátečník/Pokročilý beze změny, Mistrovství má ballot). Plnění reálnou teorií zahájení je pozdější fáze.

## Steps
- [done] Kniha: modul, seed a lookup (server)
- [done] Allowlist úrovní s knihou (levels.ts)
- [done] Integrace do cesty tahu soupeře (app.ts)
- [done] Integrační testy se zuby (server)
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 56: Opening book: formát a lookup (Profesionál)

## Discussion
# Phase 56 — Opening book: formát a lookup (Profesionál)

## Intent
POZNÁMKA: původní cíl ve `phases/phase-056.json` je diskusí PŘEDEFINOVÁN (uživatel
schválil „predefinovat"). Platí text níže, ne formulace „Zobrist" a „integrace do
search cesty enginu" z uloženého cíle.

Kniha zahájení **na serveru** (ne v enginu). V cestě tahu soupeře (`app.ts`, volání
`engine.bestmove` cca L498) server nejdřív nahlédne do statické in-memory knihy podle
aktuální pozice:
- **zásah** → použije knižní tah rovnou, BEZ volání enginu; tah stejně projde
  `findLegalMove` (server enginu i knize nevěří);
- **mimo knihu / nelegální knižní tah** → fallback na `engine.bestmove` jako dnes.

Kniha platí pro **plnosilové úrovně**: `professional`, `championship`, `education`.
Oslabené (`beginner`, `intermediate`) knihu NIKDY nekonzultují – mají zůstat
poražitelné. Gate přes EXPLICITNÍ allowlist v `levels.ts` (jediný zdroj pravdy), ne
přes implicitní `STRENGTH_BY_LEVEL[level] === undefined`.

„Mistrovství po odehrání ballotu" vychází SAMO: ballot se předsazuje do historie už
při `store.create`, partie Mistrovství začíná až popballotovou pozicí, engine se na
ballot tahy nikdy neptá. První `bestmove` u Mistrovství je vždy za ballotem → žádné
zvláštní hlídání netřeba.

**Mimo rozsah:** endpoint nápovědy `/hint` (`app.ts` ~L341) se NEMĚNÍ – zůstává vždy
plná síla, bez knihy. Engine balík a protokol se NEMĚNÍ. Minimální seed kniha (pár
vstupů) jen na důkaz mechaniky, NE reálná teorie zahájení (to je pozdější obsahová
fáze).

## Key decisions
- **Umístění: server** (varianta „engine + vlajka `useBook`" zamítnuta). Důvod:
  politika úrovní už je na serveru (`levels.ts`); engine zůstane čistý vyhledávací
  mechanismus (odpovídá architektuře); žádná změna protokolu; menší dopad.
- **Klíč: kanonická deterministická serializace `Position`** (VČETNĚ strany na tahu a
  typu kamene man/king), NE Zobrist. Důvod: lookup jednou za tah (žádný tlak na
  rychlost), Zobrist má kolizní riziko, a neváže server na interní `hashPosition`
  enginu. Struktura `Map<string, Move>`.
- **Formát: inline TS konstanta** (jako ballot deck v `rules/openings.ts`), NE externí
  soubor + loader. Načítání ze souboru odloženo do obsahové fáze.
- **Gate: explicitní per-úroveň allowlist** (např. `LEVELS_WITH_BOOK`) v `levels.ts`
  jako jediný zdroj pravdy, pokrytý testem.
- **Hodnota v knize: celý `Move`**; před použitím ověřit, že je v seznamu legálních
  tahů (`findLegalMove`).

## Watch out for
- **Fallback při nelegálním/chybějícím knižním tahu** → ignorovat knihu, normální
  search. Musí mít test se zuby.
- **Kontrakt serializace (cross-module):** klíčovací funkce a seed vstupy MUSÍ používat
  tutéž serializaci → jedna funkce, testovaná proti REÁLNÉ `Position` z rules, ne proti
  mocku. Stejná logická pozice → stejný klíč (turn, man/king). Kolizní riziko = 0 jen
  když je to plná serializace, ne hash.
- **Barva enginu:** engine hraje obě barvy → kniha musí obsahovat pozice, kde je na
  tahu engine (1. tah i odpověď). Seed podle toho.
- **Zrcadlová symetrie NEŘEŠENA:** minimální kniha netrefí zrcadlově transponované
  pozice. Vědomé; kanonizaci přes symetrii rozhodne až obsahová fáze.
- **Min. doba přemýšlení je na KLIENTOVI** (`controller.ts`, ~700 ms od konce animace
  lidského tahu), nezávisle na rychlosti serveru → okamžitý knižní tah pořád působí
  jako „engine přemýšlí". NEPŘIDÁVAT serverové zpoždění.
- **Místo vložení lookupu:** cesta tahu soupeře v `app.ts` (~L498) PŘED `engine.bestmove`;
  zachovat stávající re-validaci stavu po awaitu (knižní tah aplikovat výhradně proti
  AKTUÁLNÍ pozici, ne proti snímku).
- **Testy se zuby:**
  1. zásah → engine.bestmove se NEVOLÁ, aplikuje se knižní tah (spy na enginu);
  2. mimo knihu → engine.bestmove SE zavolá (fallback);
  3. allowlist úroveň (professional/championship/education) knihu použije, oslabené
     (beginner/intermediate) NE (engine se volá i na pozici, co je v knize);
  4. nelegální knižní tah → fallback na search;
  5. serializační kontrakt testovat proti reálné `Position`, ne mockem.

## Run report
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

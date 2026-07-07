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

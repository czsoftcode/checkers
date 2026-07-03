# Changelog

Všechny podstatné změny projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
verzování se řídí [SemVer](https://semver.org/lang/cs/).

## [Unreleased]

## [0.12.0] - 2026-07-03

### Changed

- Engine už nehraje náhodně: zprávu `bestmove` odbavuje negamax
  s alfa-beta ořezáváním na pevnou hloubku 6 a evaluací v1 (muž 100,
  dáma 130, bonus za hlídanou zadní řadu, drobný bonus za postup mužů).
  Engine preferuje rychlejší výhru a pozdější prohru; mezi stejně dobrými
  tahy rozhoduje seedovatelný tie-break (dřívější `--seed` má teď jen
  tuto roli). Brána M3 splněna: 12 seedovaných partií proti náhodnému
  hráči = 12 výher, každý tah enginu ověřen nezávisle knihovnou pravidel.
- Dokumentace protokolu nově výslovně uvádí limity v1: `bestmove` nenese
  časový limit ani remízový stav partie (čítač půltahů, opakování) -
  obojí přijde s fází časové kontroly.

## [0.11.0] - 2026-07-03

### Added

- Engine jako samostatný proces (`@checkers/engine`, začátek milníku M3):
  JSON Lines protokol na stdin/stdout - požadavky `hello` (handshake vrací
  `protocol` a `engine` id) a `bestmove` (zatím náhodný legální tah,
  seedovatelný přes `--seed`; search přijde v další fázi). Pozice a tah
  putují přímo jako JSON tvar typů z `@checkers/rules`, server je bude
  importovat místo opisování. Spuštění:
  `pnpm --filter @checkers/engine start -- [--seed <n>]`.
- Odolnost protokolu: řádkový buffer správně skládá zprávy rozseknuté mezi
  chunky (i CRLF); nevalidní JSON, špatný tvar zprávy, neznámý typ, vadná
  pozice i pozice bez tahů vracejí odpověď `error` s kódem a proces žije
  dál. Nečekaná chyba enginu vrací `internal_error` se zachovaným `id`
  (volající si odpověď spáruje) a stackem na stderr. Exit kódy: 0 konec
  spojení (EOF/zavřená roura), 1 chybné argumenty.
- Brána fáze kryta integračními testy přes skutečný podproces: handshake,
  legální bestmove ověřený rules knihovnou, rozsekané zprávy, garbage
  vstup, čistý konec na EOF.

## [0.10.0] - 2026-07-03

### Added

- CLI hra (`@checkers/cli`, milník M2): kompletní partie americké dámy
  v terminálu bez UI a serveru. Režim random vs random (důkaz, že pravidla
  vždy terminují - remíza po 80 půltazích bez pokroku) a člověk vs random
  se zadáváním tahů v PDN (`11-15`, `22x15`, `26x17x10`); chybný nebo
  nelegální vstup dostane hlášku a nový prompt, partii nic neshodí.
  ASCII deska ukazuje kameny (m/k/M/K) a čísla prázdných polí 1-32.
  Spuštění: `pnpm --filter @checkers/cli start -- --mode random|human
  [--seed <n>] [--color black|white]`; bez `--seed` se vypíše náhodný seed,
  takže je každá partie reprodukovatelná. Exit kódy: 0 dohraná partie,
  1 chyba, 2 partie přerušená člověkem (EOF/Ctrl+C).
- Herní smyčka CLI je zároveň bránou legality: tah každé strategie
  (i random hráče) projde jen přes členství v `legalMoves` - stejný princip,
  jakým později server ověří tahy enginu.
- Tvrdý strop hloubky perftu (`MAX_PERFT_DEPTH = 12`): hlubší volání odmítá
  `RangeError` místo prakticky nekonečného výpočtu - pojistka pro budoucí
  vystavení přes CLI/server (nález SEC-2).

### Changed

- Projekt oficiálně běží na Node 24 LTS: projektový dokument srovnán
  s realitou repa a `@types/node` zvednuty na ^24, takže typy popisují
  skutečný runtime (nález 10-1, viz ADR fáze 11).
- GitHub Actions v CI přišpendlené na plné commit SHA místo pohyblivých
  tagů (nález SEC-1); aktualizace akcí jsou nově ruční.

### Fixed

- `ALL_DIRS` má jediný zdroj pravdy v `board.ts` (nově i ve veřejném API);
  duplicitní kopie v generátoru tahů a testech odstraněny, obsah konstanty
  přibíjí test (nález 10-2).

## [0.9.0] - 2026-07-03

### Added

- Perft (`perft(position, depth)`): počet listových uzlů stromu legálních
  tahů; vícenásobný skok je jeden tah. Hodnoty 1-6 z výchozí pozice sedí
  na čísla nezávislého zdroje (Aart Bik): 7/49/302/1469/7361/36768 -
  generátor tahů je tím ověřený proti světu, milník M1 (knihovna pravidel)
  je uzavřený.
- Sdílené fixtures (`packages/rules/fixtures/*.json`): jazykově neutrální
  kontrakt pravidel - výchozí pozice s perft hodnotami + pasti z GDD 2.7
  (povinné braní, větvení multi-skoku, zákaz zastavení uprostřed větve,
  muž nebere vzad, proměna ukončuje tah, kruhový skok dámy, zablokovaná
  pozice). Formát popsán ve `fixtures/README.md`; stejné soubory později
  přibijí i případný Rust engine. Testy fixtures načítají z JSON a
  poškozený soubor hlasitě odmítnou.

## [0.8.0] - 2026-07-03

### Added

- PDN notace tahu: `formatMove` převádí tah na text (prostý tah `22-18`,
  skok s celou sekvencí dopadů `26x17x10`), `parseMove` z textu tah
  zrekonstruuje včetně dopočtu braných kamenů z geometrie skoků. Nesmyslný
  zápis i strukturálně vadný tah odmítá `RangeError`. Round-trip
  (tah → text → stejný tah) je ověřený nad všemi legálními tahy
  20 náhodných partií. Zkrácený zápis skoku (`26x10` bez mezidopadů)
  se vědomě nepodporuje - PDN se jen exportuje, cizí soubory se nečtou.

## [0.7.0] - 2026-07-03

### Added

- Stav partie (`GameState`): vrstva nad jednou pozicí - čítač půltahů bez
  pokroku, historie pozic a `advanceState` pro posun po tahu. Pokrok
  (braní nebo tah mužem, včetně proměny) čítač nuluje a historii zahazuje.
- Remízová pravidla (`gameResultFromState`): remíza po 80 půltazích bez
  braní a bez tahu mužem, nebo při trojím opakování stejné pozice se
  stejnou stranou na tahu. Prohra bez tahu má před remízou přednost.
  `GameResult` nově zná hodnotu `draw`.
- Klíč pozice (`positionKey`): deterministická textová serializace desky
  a strany na tahu; poškozenou pozici odmítá `RangeError`.
- Garance terminace: každá partie skončí - ověřeno testem s 50 seedovanými
  náhodnými partiemi (deterministický PRNG, žádná nekonečná hra).

## [0.6.0] - 2026-07-03

### Added

- Detekce konce hry (`gameResult`): hráč na tahu bez legálního tahu
  prohrává - i se zablokovanými kameny na desce (pat v americké dámě
  neexistuje). Vrací `ongoing` / `black-wins` / `white-wins`; remízová
  pravidla přijdou samostatně.

## [0.5.0] - 2026-07-03

### Added

- Aplikace tahu (`applyMove`): vrací novou pozici (vstup se nemění), kámen
  se přesune na konec sekvence, brané kameny zmizí, na tah jde soupeř.
  Validuje strukturu tahu (geometrie kroků, volné dopady, soupeř na braných
  polích) a při porušení vyhazuje `RangeError`; plnou legalitu drží
  `legalMoves` (viz ADR fáze 6).
- Proměna: muž končící na zadní řadě soupeře se stává dámou, prostým tahem
  i skokem. Proměna ukončuje tah - proměněný muž v tomtéž tahu nepokračuje
  v braní jako dáma (past z GDD 2.7, pokryto end-to-end testem).

## [0.4.0] - 2026-07-03

### Added

- Vícenásobný skok: braní pokračuje z pole dopadu, dokud existuje další
  skok - uprostřed sekvence skončit nejde. Větvení vrací každou maximální
  větev jako samostatný tah; volba kratší větve z rozcestí je legální
  (maximum braní se nevyžaduje). Stejný kámen nelze v sekvenci přeskočit
  dvakrát; kruhový skok dámy s návratem na výchozí pole funguje.
- Testy pastí z GDD 2.7 pro multi-skoky: trojskok, větvení, zákaz zastavení
  uprostřed větve, muž nebere vzad ani v pokračování sekvence.

### Changed

- Odstraněno dočasné omezení z verze 0.3.0: skok už nekončí po jednom braní.

## [0.3.0] - 2026-07-03

### Added

- Jednoduché braní: skok přes soupeřův kámen na prázdné pole za ním; muž
  bere jen vpřed, dáma všemi čtyřmi směry.
- Povinnost braní přes nové veřejné API `legalMoves`: existuje-li skok
  kterékoli figury strany na tahu, prostý tah není legální. Prázdný seznam
  tahů je zafixovaný kontrakt pro budoucí detekci konce hry.
- Validace strany na tahu: pozice s neplatným `turn` vyhazuje `RangeError`
  místo tichého „žádné tahy".

### Changed

- Generátory prostých tahů zmizely z veřejného API balíčku rules – jediným
  vstupem pro konzumenty je `legalMoves` (stavební bloky ignorují povinnost
  braní). Dočasné omezení: skok zatím končí po jednom braní, vícenásobné
  skoky přijdou v další fázi.

## [0.2.0] - 2026-07-03

### Added

- Výchozí rozestavění partie (`initialPosition`): černí muži na polích 1-12,
  bílí na 21-32, černý na tahu.
- Generátor prostých tahů (bez braní): muž táhne jen vpřed o 1 pole, dáma
  všemi čtyřmi směry o 1 pole (není dálková). Kotva perft(1): z výchozí
  pozice přesně 7 tahů pro černého i bílého, ověřeno testy proti ručně
  vypsaným tahům.
- Poškozená pozice (deska s jinou délkou než 32 polí) vyhazuje `RangeError`
  místo tichého vynechání tahů.

## [0.1.0] - 2026-07-03

### Added

- Základ knihovny pravidel (`@checkers/rules`): typy partie (barva, kámen,
  pozice, tah s podporou vícenásobných skoků), standardní PDN číslování
  polí 1-32 s převodem na souřadnice a zpět a předpočítané tabulky
  sousedství a skoků (`NEIGHBORS`, `JUMPS`) pro 4 diagonální směry.
  Neplatné vstupy (pole mimo 1-32, světlé políčko, neplatný směr) vyhazují
  `RangeError`; vše kryté 92 testy s ručně spočítanými hodnotami.
- Kostra monorepa: pnpm workspaces se čtyřmi balíčky (`@checkers/rules`,
  `@checkers/engine`, `@checkers/server`, `@checkers/web`).
- Sdílený přísný TypeScript základ (`tsconfig.base.json`, strict +
  `noUncheckedIndexedAccess`).
- Vitest se smoke testy ve všech balíčcích, ESLint 10 s typed lintingem.
- GitHub Actions CI: lint, typecheck a testy na Node 24 při každém pushi.

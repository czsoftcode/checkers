# Changelog

Všechny podstatné změny projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
verzování se řídí [SemVer](https://semver.org/lang/cs/).

## [Unreleased]

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

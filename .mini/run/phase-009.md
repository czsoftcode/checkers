---
phase: 9
verdict: done
steps:
  - title: "Sdílená geometrie skoku (refactor)"
    status: done
  - title: "formatMove: Move → PDN text"
    status: done
  - title: "parseMove: PDN text → Move"
    status: done
  - title: "Round-trip test nad reálnými tahy"
    status: done
  - title: "Export API a zelený workspace"
    status: done
---

# Phase 9 — report ze session

## Co vzniklo
- `packages/rules/src/notation.ts` (nový): `formatMove` (prostý tah `22-18`, skok `26x17x10` s celou sekvencí dopadů) a `parseMove` (z textu zrekonstruuje Move včetně dopočtu braných polí z geometrie skoků). Obojí ověřuje strukturu a nesmysl odmítá RangeError; plnou legalitu dál hlídá brána členství v `legalMoves` – stejný kontrakt jako `applyMove`.
- Refactor: `jumpedSquareBetween`, `isNeighbor` a `ALL_DIRS` přesunuty z privátních kopií v `apply.ts` do sdíleného `board.ts` (jeden zdroj geometrie pro applyMove i notaci). Doslovný přesun, chování beze změny.
- Testy: `notation.test.ts` (formát, parse, 16 neplatných zápisů, round-trip na fixtures včetně kruhového skoku dámy `18x9x2x11x18`), `notation-roundtrip.test.ts` (20 seedovaných partií – KAŽDÝ legální tah každé navštívené pozice přežije Move → text → Move, pojistka > 1000 ověřených tahů). PRNG mulberry32 vytažen do sdíleného `test/support/prng.ts` (používá ho i test terminace).
- Exporty z `index.ts`; workspace zelený (lint + typecheck + 229 testů rules).

## Nad rámec plánu (z nezávislého self-review)
Fáze sahá na chybové cesty a budoucí sdílený formát (archiv M5), takže dle CLAUDE.md proběhl self-review sub-agentem. Empiricky proklepal ~24 hraničních vstupů parseru (vše předvídatelně RangeError, žádný tichý průchod ani cizí výjimka) a našel jednu reálnou díru, opravena: `formatMove` nekontroloval duplicitní braná pole – Move porušující kontrakt typu se tiše serializoval a chyba by bouchla až při pozdějším čtení, daleko od zdroje. Teď RangeError + test.

Vlastní sebekontrola dosažitelnosti odhalila mrtvou větev v parseru (`tokens.length < 2` po `split('x')` nemůže nastat) – odstraněna s vysvětlujícím komentářem.

## Ověření, že testy mají zuby (mutace)
Dvě dočasné mutace, obě shodily testy: skok formátovaný pomlčkou místo `x` (5 testů padlo), vypnutá kontrola sousedství v parseru (1 test padl). Vráceno sedem (ne `git checkout` – poučení z fáze 8), finální stav zelený.

## Unhappy path (projito)
- `parseMove`: prázdný text, jen oddělovač, smíšené/zdvojené oddělovače, velké `X`, vedoucí nuly, bílé znaky, pole mimo 1–32, nesousední prostý tah, krok bez skokové geometrie, duplicitně přeskočené pole, 100k znaků dlouhý vstup (lineární, bez pádu) → vždy RangeError.
- `formatMove`: prázdná path, prostý tah s více dopady / na nesousední pole, captures nesedící počtem ani geometrií, duplicitní captures → RangeError, žádné tiché „vyprání" nesmyslu přes text.
- Round-trip je symetrický: co formatMove přijme, parseMove vrátí identické (ověřeno na všech legálních tazích 20 partií).

## Poznámky
- Zkrácený zápis skoku (`26x10` bez mezidopadů) je vědomě mimo rozsah – jednoznačně rozbalit jde jen se znalostí pozice; my PDN píšeme (export), cizí soubory nečteme. Kdyby archiv v M5 potřeboval číst cizí PDN, je to samostatná práce.
- Žádné rozhodnutí typu „zvážená a zamítnutá alternativa" nevzniklo – ADR není potřeba.

# Phase 46 — 3-move ballot: los zahájení

## Intent
Přinést do knihovny `rules` (čistý TS, nulové I/O) datový seznam přijatých
třítahových zahájení (3-move deck) + čistou funkci, která zvolený ballot odehraje
z `initialPosition()` přes stávající generátor tahů a vrátí odehrané tahy /
výslednou pozici. Cíl: základ pro budoucí úroveň **Mistrovství** (server vylosuje
ballot, nasadí ho jako vynucené zahájení). Tahle fáze je JEN čistá vrstva —
bez serveru, bez UI, bez RNG (los patří až do serverové fáze).

Kontext v2: úprava non-goalu „3-move ballot nedělat" na reálnou práci. Samotný
text non-goalu v `.mini/project.md` je potřeba srovnat zvlášť přes `/mini:project`
(dokument teď tvrdí opak).

## Key decisions
- **Deck = všech 156 zahájení** z Kingsrow „Three-Move Rankings"
  (`~/Stažené/kingsrowrankings.pdf`). Ověřeno: číslování sedí 1:1 na náš projekt
  (černý hraje první, pole 1–12 nahoře); všech 156 je v našem enginu legálních
  (0 selhání při přehrání přes `legalMoves`+`applyMove`).
- **Data se TRANSKRIBUJÍ do committed TS souboru** (`packages/rules/src/openings.ts`
  nebo `ballot.ts`) — PDF je mimo repo, NESMÍ být runtime/test závislost. PDF byl
  jen jednorázový generátor. Extrakce PDF (stdlib zlib, regex na `\d\d-\d\d ...`)
  je hotová a použitelná ke generování souboru; ověřovací skript je
  `scratchpad/validate-deck.mjs`.
- **Formát dat = celočíselné páry `{from, to}` na půltah, ne PDN řetězce.**
  Důvod: deck zapisuje i braní pomlčkou (`13-22`), takže `parseMove(token)` by na
  8 „cross" zahájeních SPADL (13 a 22 nesousedí → RangeError). Pár `from,to` se
  matchuje přímo proti `legalMoves` a braní se vyřeší samo. Do committed souboru
  dát ke každému ballotu komentář s původním PDN + jménem pro čitelnost review.
- **Přehrávací funkce `playBallot(ballot)`:** z `initialPosition()` pro každý
  z 3 půltahů najít v `legalMoves(pos)` tah s `from === ply.from` a
  `path[last] === ply.to`; ověřit PRÁVĚ JEDNU shodu (jinak throw); `applyMove`.
  Vrací odehrané `Move[]` (a/nebo výslednou `Position`). Vzor shody převzatý ze
  serveru `dto.ts:93` (`from` + `pathsEqual`), tady zjednodušený na from+cíl.
- **Návratová hodnota:** doporučeno vracet odehrané `Move[]` (server si je
  přehraje přes `advanceState` do `GameState` — správná historie pro opakování /
  počítadlo bez pokroku). Finální `Position` je odvoditelná; klidně vrátit obojí.
  Stavbu `GameState` a threading historie NEDĚLAT tady — to je serverová fáze.

## Watch out for
- **NENÍ pravda „nula braní, 12:12".** 8 ze 156 zahájení má braní na 3. půltahu
  (černý bere bílého). Správný invariant po ballotu: `turn === 'white'`,
  černých = 12, bílých ∈ {11, 12}. Ply 2 (bílý) brát NEMŮŽE (po 1 tahu černého
  není kontakt) — proto ubývá jen bílý a jen na ply 3.
- **NEparsovat token přes `parseMove`.** Matchovat from+cíl proti `legalMoves`.
  `parseMove("13-22")` = RangeError (nesousedí). Shorthand skoku by sice prošel
  jako `13x22`, ale spoléhat na to je křehké — from+cíl je robustní.
- **Ověřit PRÁVĚ JEDNU shodu na půltah.** Pokud by token neodpovídal žádnému nebo
  víc legálním tahům, `playBallot` musí throw (jasná chyba). To je zároveň zub
  testu: překlep v committed seznamu spadne.
- **PDF do repa NEpatří** a není zdroj pravdy za běhu. Zdroj pravdy = committed
  TS soubor. Test běží nad tím souborem, ne nad PDF.
- **Zuby testu:** pro všech 156 ballotů `playBallot` projde; `turn==='white'`;
  černých 12, bílých 11–12; počet ballotů === 156; žádné duplicity (unikátnost).
  Ověřit, že test má zuby: rozbij cílové pole jednoho ballotu → musí padnout na
  „žádná legální shoda". Netestovat mock — přehrávat reálnou cestou rules.
- **Rank/obtížnost/jméno NEbrát do scope.** Openings mají tvrdou bránu legality;
  jména z PDF jsou přetrhaná a neověřitelná. Případně doplnit později z čistšího
  zdroje, když je bude chtít UI.
- **RNG/los NEPATŘÍ do této fáze.** Los které zahájení padne = serverová fáze
  s jejím PRNG. Tady jen seznam + přehrání.
- **Turnajová férovost má strop (mimo tuto fázi):** na turnaji se ballot hraje
  2× s prohozenými barvami; v appce hraje člověk vždy černou, takže jednotlivá
  partie může být mírně nevyvážená. Řeší se až případným prohazováním barev
  v serverové/UI fázi, ne tady.

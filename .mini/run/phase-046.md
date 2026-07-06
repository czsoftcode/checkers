---
phase: 46
verdict: done
steps:
  - title: "Datový soubor 156 zahájení"
    status: done
  - title: "Funkce playBallot + export"
    status: done
  - title: "Test se zuby nad reálnými pravidly"
    status: done
  - title: "Verifikace + nezávislý self-review"
    status: done
verify:
  - title: "Sémantika decku: je těch 156 zahájení opravdu zamýšlený accepted seznam?"
    detail: "Test hlídá jen legalitu a konzistenci číslo/PDN komentář, ne že jde o správný Kingsrow deck. Číslo omylem změněné na jiný, ale legální tah by prošlo. PDF je mimo repo. Vhodné nechat tchána namátkou porovnat pár zahájení proti originálu."
---

# Phase 46 — report z auto session

## Co se povedlo
- **Deck strojově vytažen z PDF** (`~/Stažené/kingsrowrankings.pdf`) přes stdlib
  zlib + regex; všech **156 unikátních** zahájení. Jednorázový generátor je ve
  scratchpadu (`gen-openings.mjs`, `validate-deck.mjs`), do repa šel jen výsledný
  `packages/rules/src/openings.ts` – PDF NENÍ runtime/test závislost.
- **Číslování decku sedí 1:1** na náš projekt (černý první, pole 1–12 nahoře);
  všech 156 je v našem enginu legálních (0 selhání při přehrání přes
  `legalMoves` + `applyMove`).
- `playBallot(ballot)` páruje každý půltah `from` + poslední pole `path` proti
  `legalMoves`, vyžaduje **právě 1 shodu** (jinak `RangeError`), vrací
  `{ position, moves }` s reálnými `Move` (projdou serverovou validací i
  `advanceState`).
- Test se zuby (`test/openings.test.ts`): 156 ballotů projde, `turn==='white'`,
  černých 12, bílých 11–12, 156 unikátních, kontrakt `moves ↔ ballot`, dva
  negativní testy (nedosažitelný cíl / zablokované pole → `RangeError`).
- **Zuby doloženy**: dočasně jsem rozbil cíl reálného ballotu (12→31) a hlavní
  test spadl přesně na `RangeError: půltah 12->31 má 0 legálních shod`; pak
  vráceno. (Pozor: soubor je netrackovaný, `git checkout` ho nevrátí – vraceno
  ručně sedem.)
- Verifikace zeleně: `pnpm lint`, `pnpm typecheck` (všechny balíčky),
  `pnpm test` (849 testů celkem, 266 v rules).

## Klíčová zjištění (proti původnímu plánu)
- **8 ze 156 zahájení končí braním** na 3. půltahu („cross" otevírky, např.
  Double Cross `9-14 23-18 14x23`). Původní invariant „nula braní, 12:12" byl
  špatně; správně je černých 12, **bílých 11–12**. Deck píše i braní pomlčkou,
  takže `parseMove` tokenu doslova by spadl – proto párování from+cíl proti
  `legalMoves`, ne parsování PDN. Ověřeno, projede všech 156.

## Nezávislý self-review (čerstvý kontext)
Sub-agent potvrdil jako čisté: chybová cesta `playBallot` (throw při 0 i >1
shodách, žádný maskující catch), jednoznačnost párování (probe: max 1 shoda na
půltah přes všech 156), kontrakt se serverem, konzistence číslo ↔ PDN komentář
(0 nesouladů ze 156). Opraveny jeho nálezy:
- **Nález 1 (LOW, opraveno):** hlavní test neasertoval, že vrácené `moves`
  odpovídají datům ballotu → přidán kontrakt `moves[i].from === ballot[i].from`
  a `path.at(-1) === ballot[i].to`.
- **Nález 3 (kosmetika, opraveno):** do komentáře ranku 104 prosákla hlavička
  PDF – vyčištěno na `// 104. 9-13 24-19 11-15` (čísla byla správně).
- **Nález 2 (INFO, ponecháno):** sémantiku decku strojově ověřit nejde – viz
  `verify` výše.

## Vědomé hranice fáze (mimo scope, dle diskuse)
- **RNG/los** které zahájení padne = serverová fáze, ne tady.
- **Turnajová férovost**: člověk hraje vždy černou; bez prohazování barev může
  být jednotlivá partie mírně nevyvážená. Řeší až serverová/UI fáze.
- **Non-goal v GDD** stále tvrdí „3-move ballot nedělat" – srovnat zvlášť přes
  `/mini:project` (dokument teď lže).
- Rank/obtížnost/jméno nejsou v datech, jen v komentářích (bez tvrdé brány).

## Rozhodnutí k zaznamenání?
Klíčová volba „párovat from+cíl proti legalMoves místo parseMove PDN" má reálné
odůvodnění (braní zapsané pomlčkou by parseMove shodilo) a není z kódu později
zjevná – zvaž `/mini:decision` před `/mini:done`.

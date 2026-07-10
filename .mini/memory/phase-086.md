# Phase 86 — Sdílený balíček @checkers/ai

**Goal:** Vytvořit balíček @checkers/ai jako jediný zdroj knihy zahájení (opening book), mapování úroveň→síla (STRENGTH_BY_LEVEL, levelUsesBook, LEVELS, DEFAULT_LEVEL, typ Strength) a orchestrátoru výběru tahu (book → search → chooseMove, s volitelným parametrem maxDepth), napojit na něj server beze změny jeho chování (strop maxDepth 12 zůstává jen nepoužitým parametrem pro budoucí offline klienta, na server se NEaplikuje) a přibít shodu serverové a sdílené cesty kontraktním testem nad reálným kódem obou stran (tatáž pozice + seed + úroveň → týž tah). Přesun opening-book.ts a levels.ts (vč. typu Strength) ze serveru; server je začne importovat z @checkers/ai. Balíček závisí jen na @checkers/rules a @checkers/engine (čisté exporty, žádné node:). Rozsah: JEN balíček + napojení serveru; regrese hlídají stávající serverové testy. Mimo řez: změna webového klienta, Web Worker, offline build, dedup webové kopie GAME_LEVELS.

## Steps
- [done] Založit balíček @checkers/ai (skeleton)
- [done] Rozšířit veřejné API @checkers/engine
- [done] Přesunout opening book do @checkers/ai
- [done] Přesunout mapu úrovní do @checkers/ai
- [done] Orchestrátor výběru tahu v @checkers/ai
- [done] Kontraktní test: orchestrátor == handleLine

## Auto-commit
- Phase 86: Sdílený balíček @checkers/ai

## Discussion
# Phase 86 — Sdílený balíček @checkers/ai

## Intent
Vytvořit balíček `@checkers/ai` jako jediný zdroj logiky výběru tahu AI, aby na něm
budoucí prohlížečový offline klient a dnešní server stavěly z jednoho kódu (online/offline
síla se nesmí rozejít). Tato fáze dělá JEN balíček + napojení serveru; prohlížečový
LocalClient + Web Worker je až následující fáze.

Server dnes skládá tah AI ve dvou větvích (`app.ts` ~ř. 1364-1383):
1. Knižní: `levelUsesBook(level)` → `lookupBookMove(book, position)` → re-validace přes
   `findLegalMove`; nelegální/chybějící knižní tah → fallback na hledání.
2. Hledací: `engine.bestmove(position, STRENGTH_BY_LEVEL[level])` → PODPROCES enginu →
   `handleLine` → `searchTimed` + `chooseMove`.

Balíček `@checkers/ai` sloučí obě větve do jednoho in-process orchestrátoru (book → search →
chooseMove), který příště zavolá prohlížeč. Server sám dál jede přes podproces (nemění se).

## Key decisions
- **Typ `Strength` → do `@checkers/engine`, NE do `@checkers/ai`.** Je to tvar pák protokolu
  enginu (odpovídá polím `BestmoveRequest`: `{maxDepth?, carelessness?}`). Do `@checkers/ai`
  jde jen MAPA `STRENGTH_BY_LEVEL` + `LEVELS`/`DEFAULT_LEVEL` + `levelUsesBook`. `server/
  engine-client.ts` i `@checkers/ai` pak importují `Strength` z `@checkers/engine` = jeden
  zdroj. (Dnes je `Strength` definován v `server/engine-client.ts:66` — ten se přesune do
  enginu a engine-client ho začne importovat.)
- **Kontraktní test porovnává orchestrátor proti `handleLine` (in-process, stejný seed), NE
  proti živému podprocesu.** Živý serverový podproces je v produkci NESEEDOVANÝ
  (`Date.now()`, spawn bez `--seed`), takže s ním nejde deterministicky srovnávat. Podproces
  ale za stdiem spouští doslova `handleLine` (exportované z `@checkers/engine`, bere `rng`).
  Test tedy postaví bestmove request, prožene ho `handleLine` se seedovaným `rng`, a porovná
  s výstupem orchestrátoru volaného se STEJNÝM seedem. Obojí reálný kód, tytéž primitivy
  `searchTimed`+`chooseMove`.
- **Orchestrátor replikuje i knižní fallback** (book lookup → re-validace legality přes
  rules → při nelegálním fallback na search), přesně jako `app.ts`. Jinak by se offline a
  online lišily na knižních úrovních (Profesionál/Mistrovství/Výuka).
- **Strop `maxDepth 12` se v této fázi NIKDE neaplikuje.** Orchestrátor ho bere jako
  VOLITELNÝ parametr; server nepředává nic (chová se bit po bitu jako dnes). Aktivace stropu
  je až v offline fázi. (Non-goal ve vizi: neaplikovat strop 12 na server.)

## Watch out for
- **Test musí přibít hloubku I hodiny, jinak bliká.** S reálnými hodinami + `timeMs` můžou
  obě strany na zatíženém CI dojít do JINÉ hloubky → různý tah → náhodný pád (a přesně to,
  co má test chytat, by ho shazovalo). Test proto injektuje pevný `now` A pevný `maxDepth`
  (a stejný seed), ať obě strany prohledají identicky. Nutná podmínka, ne kosmetika.
- **`chooseMove` bez `rankedMoves` při `carelessness > 0` vyhodí `RangeError`** — orchestrátor
  musí zapnout `rankRoot: strength.carelessness > 0` v `searchTimed`, stejně jako `handleLine`
  (handler.ts). Jinak Začátečník/Střední spadnou.
- **`Strength.carelessness` je optional** v engine-client (`handleLine` bere absenci jako 0).
  Orchestrátor musí držet stejnou konvenci (chybí → 0), ať sedí na server.
- **Chování serveru se NESMÍ změnit** — regrese hlídají stávající serverové testy
  (`opening-book*.test.ts`, `levels-book.test.ts`, dto/app testy). Po přesunu book+levels
  musí zůstat zelené beze změny očekávání.
- **Směr závislostí:** `@checkers/ai` závisí jen na `@checkers/rules` a `@checkers/engine`
  (čisté exporty, žádné `node:`). Nesmí vzniknout zpětná závislost na `@checkers/server`.
- **Orchestrátor má v této fázi jediného volajícího — kontraktní test** (server dál jede přes
  podproces). Vědomé; ospravedlnění = test je risk-gate pro příští fázi (LocalClient).
- **Mimo řez:** změna webu, Web Worker, offline build, dedup webové kopie `GAME_LEVELS`
  v `server-client.ts` (ta zůstává, řeší se až s napojením webu).

## Run report
---
phase: 86
verdict: done
steps:
  - title: "Založit balíček @checkers/ai (skeleton)"
    status: done
  - title: "Rozšířit veřejné API @checkers/engine"
    status: done
  - title: "Přesunout opening book do @checkers/ai"
    status: done
  - title: "Přesunout mapu úrovní do @checkers/ai"
    status: done
  - title: "Orchestrátor výběru tahu v @checkers/ai"
    status: done
  - title: "Kontraktní test: orchestrátor == handleLine"
    status: done
---

# Fáze 86 — report z auto session

## Co se povedlo

Balíček `@checkers/ai` vznikl a je jediným zdrojem knihy zahájení, mapy úroveň→síla a
orchestrátoru výběru tahu. Server na něj napojen **beze změny chování** — potvrzeno
regresí: server 292 testů, engine 250, ai 54, vše zelené; celý `pnpm -r typecheck` i
`pnpm lint` čisté.

Konkrétně:
- **Skeleton** `packages/ai` (package.json, tsconfig, index). Deps jen `@checkers/rules`
  + `@checkers/engine`, žádné `node:` v `src/`.
- **Engine API**: typ `Strength` přesunut ze `server/engine-client.ts` do
  `engine/src/protocol.ts` (tvar páček protokolu = jeden zdroj); z indexu enginu nově
  exportováno `chooseMove`, `RankedMove`, `Strength`. `engine-client.ts` i `server/index.ts`
  `Strength` re-exportují → veřejné API serveru beze změny.
- **Přesun** `opening-book.ts` (+ jeho unit test) a `levels.ts` do `@checkers/ai` přes
  `git mv` (historie zachována). Server importuje z `@checkers/ai`; `server/index.ts` drží
  pass-through re-exporty, takže serverové testy čtou přes `../src/index.js` beze změny
  očekávání. `opening-book-integration.test.ts` a `levels*.test.ts` zůstaly na serveru
  a jedou přes pass-through.
- **Orchestrátor** `computeAiMove(position, {strength, timeMs, maxDepth?, book?, now?}, rng)`
  replikuje serverovou cestu bit po bitu: knižní větev (lookup → re-validace legality přes
  rules → legální tah bez hledání, jinak fallback) přesně jako `app.ts` `runEngineMove`,
  hledací větev (`searchTimed` + `chooseMove`, `rankRoot = carelessness>0`, chybějící
  carelessness → 0) přesně jako `handler.ts` `handleBestmove`. Offline strop `maxDepth` je
  volitelný a server ho nepředává (chová se jako dnes); `tighterDepth` ho slučuje s
  úrovňovým stropem jako přísnější z obou (Začátečník se stropem 1 se offline stropem 12
  nezesílí).
- **Kontraktní test** porovnává `computeAiMove` proti reálnému `handleLine` (to, co běží
  v podprocesu enginu) se stejným seedem, pevným `now` a pevnou hloubkou; knižní větev
  proti tahu odvozenému z `rules` (co server aplikuje přes `findLegalMove`). Napříč
  knižními i mimoknižními pozicemi, všemi úrovněmi a víc seedy. `searchCases > 0` garantuje,
  že se hledací větev opravdu projela.

## Zuby (ověřeno mutacemi)

- Změna síly v orchestrátoru (carelessness natvrdo 0) → kontraktní test **padne** (tah 13 vs 15).
- Vynechání knihy v orchestrátoru → kontraktní test **padne**.
- Obě mutace po obnově zase zelené.

## Adversarial self-review

Před reportem proběhl nezávislý sub-agent (čerstvý kontext) — bez blokující vady. Z jeho
neblokujících nálezů jsem zapracoval:
- knižní větev kontraktního testu už neporovnává `lookupBookMove` sám se sebou, ale proti
  tahu nezávisle odvozenému z `rules` (reálné zuby na shodu objektu);
- kontraktní test testuje **produkční** hloubky úrovní (beginner 1, intermediate 3), pevnou
  hloubku přebíjí jen u úrovní bez stropu (pro/champ/edu), jinak by hledaly do MAX_SEARCH_DEPTH;
- doplněn test mezní cesty: pozice bez legálního tahu → `computeAiMove` vyhodí (nemaskuje);
- `ai/tsconfig.json` má `types: []` — cíl „žádné `node:`" tak vynucuje kompilátor, ne jen
  konvence (u balíčku, který má být základ prohlížečového offline klienta, dává smysl).

## Poznámky / vědomé kompromisy

- **`isLegalMove` v orchestrátoru je textová kopie kontraktu `findLegalMove` (server/dto.ts).**
  `findLegalMove` nejde importovat (směr závislostí ai↛server) a jeho přesun do `rules` je
  mimo řez fáze. Obě strany porovnávají `from`+`path` prvek po prvku nad `legalMoves` z rules,
  takže se nemůžou rozejít bez současné změny obou; kontraktní test navíc knižní tah křížově
  ověřuje proti rules.
- **`maxDepth`/`tighterDepth` má dnes jediného volajícího (unit test).** Server strop
  nepředává; parametr je vědomě součástí kontraktu (cíl fáze mluví o „volitelném maxDepth")
  jako risk-gate pro příští offline fázi. Je otestovaný, ne mrtvý.
- **`ComputeAiMoveOptions.strength` je povinné**; offline volající si `STRENGTH_BY_LEVEL[level]`
  (typ `Strength | undefined`) sám zmapuje na `{}` pro Profesionála. Vědomé — explicitní kontrakt.

## Rozhodnutí k záznamu (volitelně)

Žádný zásadní rozcestník nad rámec toho, co už drží `.mini/discuss/phase-086.md` (umístění
`Strength`, kontrakt proti `handleLine`). Drobná volba `types: []` u ai je zdůvodněná výše;
ADR bych nevytvářel, pokud na tom netrváš.

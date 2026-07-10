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

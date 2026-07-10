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

---
phase: 34
verdict: done
steps:
  - title: "Protokol: pole maxDepth a carelessness v BestmoveRequest"
    status: done
  - title: "Search umí skóre všech kořenových tahů (režim bez ořezu)"
    status: done
  - title: "Handler: validace parametrů + průchod hloubky do searche"
    status: done
  - title: "Nepozornost: výběr horšího tahu (sdílená funkce)"
    status: done
  - title: "Self-play harness: síla per-strana"
    status: done
  - title: "Self-play test slabý měřitelně prohrává + CHANGELOG"
    status: done
---

# Phase 34 — report z auto session

## Co je hotové

Do enginu přibyly dvě páky síly, obě jako VOLITELNÁ, zpětně kompatibilní pole
`bestmove` (chybí → Profesionál, dnešní chování). Verze protokolu se NEmění (v3),
protože server kontroluje shodu verze (`engine-client.ts:177`) a bump by si
vynutil úpravu serveru mimo rozsah fáze.

- **`maxDepth`** (kladné celé): strop iterativního prohlubování (plumbing už byl
  v `searchTimed`, jen se pustil ven přes protokol a handler).
- **`carelessness`** (0..1): pravděpodobnost, že engine místo nejlepšího tahu
  zahraje „o úroveň horší" – nejlepší tah z DRUHÉ nejvyšší úrovně skóre (varianta
  B z diskuze). Ne náhodné zahození, ale ohraničená chyba.
- **Search ranked režim** (`rankRoot`): na požádání nepruuje kořen (plné okno na
  každý tah) a vrací `rankedMoves` = PŘESNÁ skóre všech kořenových tahů, seřazená
  sestupně. Mimo ranked režim je chování bit-identické s dřívějškem (ověřeno
  diffem i tím, že všech 222 původních testů zůstalo zelených).
- **`chooseMove`** je jediná sdílená funkce pro výběr tahu; volá ji handler
  enginu i self-play harness (jeden kontrakt, ne dvě kopie).
- **`runStrengthMatch`** v self-play harnessu srovnává SÍLU per-strana (nová
  funkce vedle `runMatch`, který srovnává evaluace – původní harness zůstal
  nedotčený, aby se nerozbila brána M3/tt-gate).

Rozsah držel na enginu: server ani UI se nedotýkají (příště).

## Ověření (mechanicky, sám)

- `pnpm typecheck` celý workspace čistý (server staví `BestmoveRequest` bez nových
  polí → nic se nerozbilo).
- `pnpm --filter @checkers/engine test`: 247 testů zelených (245 + 2 přidané zuby
  po self-review). `pnpm lint` čistý.
- Self-play (seedovaný, deterministický): slabý (hloubka 1 + carelessness 0,5)
  prohrává s Profesionálem (hloubka 4) 12:0, scoreRate 0. Kontrola stejné síly →
  scoreRate 0,54 (≈ 0,5) = zuby.

## Rozhodnutí (varianta B) → zvaž `/mini:decision`

Klíčové rozhodnutí „jak vybrat horší tah, když je engine nepozorný" (nejlepší
z druhé úrovně vs. náhoda mezi všemi horšími vs. vážený softmax) padlo už v
diskuzi a plánu (varianta B, druhá úroveň). Je zaznamenané v
`.mini/discuss/phase-034.md`; jestli chceš tvrdší ADR, spusť před `done`
`/mini:decision`. Jinak není žádný nový nezaznamenaný křižovatkový moment.

## Nezávislý self-review (čerstvý kontext) – co našel a jak jsem reagoval

Sub-agent NEnašel chybu korektnosti (ověřil pořadí losů rng, přesnost ranked
skóre i s TT, kontrakt `chooseMove`, bit-identitu mimo ranked, exactOptional).
Našel dvě reálné slabiny v ZUBECH na integrační úrovni – obě jsem opravil:

1. Self-play test „scoreRate < 0,5" mísil obě páky (prošel by, i kdyby fungovala
   jen jedna). → Přidán test, který izoluje NEPOZORNOST: při STEJNÉ hloubce (4)
   na obou stranách prohrává nepozorný (carelessness 0,8) pozornému. Hloubka má
   svůj zub jinde (`strength.test.ts`, `search-timed.test.ts`).
2. Spojka handler→search/chooseMove neměla přímý zub. → Přidán integrační test:
   přes celý `handleLine` dá `carelessness: 1` na pozici se dvěma úrovněmi skóre
   jiný tah (10×19) než Profesionál (10×17).

## Vědomě neřešené (drobnost z reviewu)

`chooseMove` s `carelessness = NaN`/záporná tiše spadne na profesionální hru
(`NaN > 0` je false), místo aby házela jako u chybějícího `rankedMoves`. V
produkci je to NEDOSAŽITELNÉ – oba vstupní body validují: handler přes
`validateStrength` (NaN i mimo rozsah → `invalid_message`, testováno), self-play
má `carelessness` typované jako `number` a drží si ho interně. Přidávat guard pro
nedosažitelný vstup jsem nechal být (spekulativní obrana). Kdyby engine v dalších
fázích dostal nový, méně důvěryhodný vstupní bod, kontrakt `chooseMove` by se měl
zpřísnit.

## Na co dát pozor v navazujících fázích

- Napojení na server: přidat volbu úrovně do vytvoření hry (POST /games) a mapovat
  ji na `{ maxDepth, carelessness }`. Pozor: dnešní `EngineClient` posílá jen
  `timeMs`; bude potřeba páky protáhnout až sem.
- Kalibrace konkrétních úrovní (jaká hloubka + carelessness = Začátečník vs
  Pokročilý) je otázka reálného hraní proti člověku, ne testu – tahle fáze dokázala
  jen MONOTÓNNÍ oslabení, ne cílové % výher.

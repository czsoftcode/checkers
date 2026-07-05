# Phase 34 — Engine: strop hloubky a nepozornost

**Goal:** Do bestmove protokolu přidat dvojici parametrů síly – strop hloubky (maxDepth, plumbing už existuje v searchTimed) a míru nepozornosti (pravděpodobnost, že engine přes rng zvolí horší než nejlepší tah) – a self-play testem doložit, že s nižší hloubkou i vyšší nepozorností engine měřitelně prohrává s profesionálním nastavením. Rozsah: jen engine + protokol + testy, bez serveru a UI (další fáze). Náhoda jde přes stávající rng, aby testy zůstaly deterministické.

## Steps
- [done] Protokol: pole maxDepth a carelessness v BestmoveRequest
- [done] Search umí skóre všech kořenových tahů (režim bez ořezu)
- [done] Handler: validace parametrů + průchod hloubky do searche
- [done] Nepozornost: výběr horšího tahu (sdílená funkce)
- [done] Self-play harness: síla per-strana
- [done] Self-play test slabý měřitelně prohrává + CHANGELOG

## Auto-commit
- Phase 34: Engine: strop hloubky a nepozornost

## Discussion
# Phase 34 — Engine: strop hloubky a nepozornost

## Intent
Do enginu přidat dvě páky síly, aby šly později postavit slabší úrovně (Začátečník, Pokročilý) vedle stávajícího Profesionála:
- **strop hloubky** (`maxDepth`) – plumbing už existuje v `searchTimed` (`search.ts:377`), stačí ho pustit ven přes protokol,
- **nepozornost** (`carelessness`, 0..1) – pravděpodobnost, že engine přes `rng` zvolí horší než nejlepší tah.

Cíl kalibrace (viz project.md, i): Profesionál musí silnému hráči vzdorovat; slabší úrovně mají naopak dát začátečníkovi reálnou šanci na výhru. Samotná hloubka nestačí, protože **braní je povinné** (`moves.ts:170`) → i mělký engine sebere každý darovaný kámen; proto je nutná i „nepozornost“, aby engine občas netrestal.

Rozsah TÉTO fáze: jen `packages/engine` (protokol + handler + search + self-play harness) + testy. **Bez serveru a bez UI** – mapování úrovní (Začátečník/Pokročilý) a přepínač přijdou v dalších fázích.

## Key decisions
- **Mechanismus nepozornosti = varianta B (skóre-vědomý výběr horšího tahu).** Uživatel vybral B proti levnějším A (náhodný legální tah – vypadá nefér/rozbitě) a C (občas mělká hloubka – moc slabá páka). Důvod: sedí na záměr „hraje jako slabší člověk, chybu občas přehlédne“, ne náhodné zahození dámy.
- **Důsledek pro search:** dnes `searchRoot` vrací jen `bestMoves` + jedno `score` a alfa-beta **ořezává horší tahy** (`search.ts:203`, root okno `best - 1`) → skóre horších tahů se nikdy nespočítá. Pro B je nutné umět skóre všech kořenových tahů: přidat režim/funkci, která kořen NEpruuje (plné okno na každý kořenový tah) a vrátí seřazený seznam `(tah, skóre)`. To rozšiřuje kontrakt searche – je to jádro funkce, ne vrstva do budoucna.
- **Tvar protokolu:** do `BestmoveRequest` přidat volitelné `maxDepth?: number` (celé ≥1) a `carelessness?: number` (0..1). Chybí-li → Profesionál (`maxDepth = MAX_SEARCH_DEPTH`, `carelessness = 0`) → **dnešní chování beze změny, starý server běží dál**. Špatný typ/rozsah → chyba `invalid_message` (patří k tvaru zprávy, kontrolovat před parsováním pozice, jako `timeMs`).
- **Kde logika bydlí:** výběr tahu zůstává v `handler.ts` (`handleBestmove`, `handler.ts:115` – už má `rng`). Search zůstává čistý (jen umí vrátit skóre všech tahů); nepozornost = výběr v handleru. Self-play harness používá `searchRoot` přímo, takže tam se nepozornost musí zapojit zvlášť.
- **Jedno číslo, ne tři páky:** `carelessness` je jediná pravděpodobnost 0..1. Případné „okno/teplota“ (jak moc horší tah) je VNITŘNÍ konstanta, NE další parametr protokolu. Mentální model zůstává „dvojice: hloubka + nepozornost“.

## Watch out for
- **Pořadí losů z `rng` (zuby stávajících testů).** Dnes `handleBestmove` losuje `rng()` jednou na tie-break mezi `bestMoves` (`handler.ts:143`). Přidání losu pro nepozornost NESMÍ posunout losy v profesionální cestě, jinak spadnou existující testy handleru s nastrčeným `rng`. → nepozornostní los provádět jen když `carelessness > 0`; jinak zachovat dnešní jediný tie-break los identicky.
- **Otevřený bod pro `plan`: jak přesně vybrat horší tah, když je engine nepozorný** – vždy druhý nejlepší (mírné, možná moc slabý efekt v dámě), nebo náhodně vážené mezi horšími podle skóre (silnější efekt). Nemění tvar protokolu (pořád jen `carelessness`). Rozhodnout v plánu; je to přímý ovladač toho, jestli začátečník reálně vyhraje.
- **Self-play harness neumí „slabý vs silný“.** `runMatch` (`selfplay.ts:193`) porovnává dvě EVALUACE při STEJNÉ hloubce pro obě strany (`MatchOptions.depth`, `selfplay.ts:143`) a swapuje barvy kvůli odečtení výhody tahu. Naše fáze potřebuje různou SÍLU per-strana (hloubka + nepozornost). → rozšířit harness o sílu per-strana, nebo napsat malý zápasový test jen pro fázi. Zachovat párování barev (odečet výhody tahu) a seed přes `mulberry32` (determinismus).
- **Test se zuby (deterministický, ne flaky):**
  - jednotkový: v konkrétní taktické pozici (kombinace/„nastřel“) depth-1 vybere jiný/horší tah než depth-6 – dokazuje, že `maxDepth` reálně mění výběr;
  - jednotkový: se seedovaným `rng` a `carelessness=1` engine nevybere tah z `bestMoves` (nepozornost reálně odklání);
  - zápasový: slabá konfigurace přes N seedovaných zahájení má `scoreRate < 0,5` proti profesionálovi. Ověřit zuby: když se `maxDepth`/`carelessness` v kódu dočasně začnou ignorovat, testy padnou (weak == strong → scoreRate ≈ 0,5).
- **Determinismus s nepozorností:** nepozornost losuje přes `rng`/`mulberry32`, takže test zůstává deterministický (fixní seed → fixní výsledek). „Měřitelně slabší“ = deterministický výsledek zápasu, ne statistika přes náhodu.
- **maxDepth vs quiescence:** i s `maxDepth=1` běží quiescence na povinných braních (`search.ts:279`) → engine i tak dořeší vynucené výměny (nezahodí kámen do prostého braní). To je záměr; nepozornost je ta část, co pouští chyby. Nemíchat: hloubka = mělkost plánu, nepozornost = občasná chyba.

## Run report
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

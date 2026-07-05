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

---
phase: 14
verdict: done
steps:
  - title: "Evaluace v1 jako čistá funkce"
    status: done
  - title: "Negamax s alfa-beta na pevnou hloubku"
    status: done
  - title: "Zapojení do handleru bestmove"
    status: done
  - title: "Brána: série partií proti random hráči"
    status: done
  - title: "Integrační test podprocesu a poznámka k limitům"
    status: done
---

# Phase 14 — report z auto session

## Co vzniklo

- **`packages/engine/src/evaluate.ts`** – evaluace v1 jako čistá funkce z pohledu strany na tahu: muž 100, dáma 130, +8 za muže na vlastní zadní řadě, +1 za každou řadu postupu. Vrací vždy CELÉ číslo (na tom stojí sběr remízových tahů v searchi) a nikdy -0. Díra v desce (undefined) hází RangeError místo tichého přeskočení.
- **`packages/engine/src/search.ts`** – negamax s alfa-beta (fail-soft), pevná hloubka `SEARCH_DEPTH = 6`. Terminál: bez tahu = prohra strany na tahu, skóre `WIN_SCORE − ply` → engine preferuje rychlejší výhru a pozdější prohru. Kořen (`searchRoot`) vrací VŠECHNY stejně dobré tahy – další tahy se hledají s alfou `best − 1`, takže rovnost je přesná i s ořezáváním (stojí na celočíselnosti skóre).
- **`handler.ts`** – bestmove volá search; `rng` degradoval na tie-break mezi stejně dobrými tahy (v testech seedovatelný). Chybové větve protokolu beze změny.
- **`protocol.ts`** – doc poznámka: v1 nenese časový limit ani remízový stav (čítač, opakování) – vědomé odložení na fázi časové kontroly.

## Brána fáze – splněna

- **Legalita:** každý tah enginu v bráně se ověřuje nezávislým voláním `legalMoves` v testu; navíc vlastnostní test přibíjí `searchRoot` na shodu s čistým negamaxem BEZ ořezávání (nezávislé orákulum v testu, ne kód testující sám sebe) – stejné skóre i stejná množina nejlepších tahů na seedovaných pozicích.
- **Vs random:** 12 seedovaných partií (6 za černé, 6 za bílé) na hloubce 6 (= to, co reálně běží v handleru): 12 výher, 0 remíz, 0 proher. Běh je deterministický – kdyby po změně searche prahy spadly, je to signál chyby (typicky znaménko), ne důvod je povolit.
- Taktické testy s ručně přepočítanou geometrií: jediná výhra v 1 (zablokování rohu, skóre přesně `WIN_SCORE − 1`), volba braní bez zpětného braní (vidět až 2 půltahy dopředu), dvojice rovnocenných braní jako podklad tie-breaku. Tatáž „výhra v 1" pozice jistí handler i skutečný podproces – engine ji vrací při každém seedu (náhoda by uhnula).

## Kalibrace hloubky (měřeno)

Hloubka 6: výchozí pozice 39 ms, midgame 6 ms, nejhorší tah v partii 99 ms, celá partie ~0,4 s. Hloubka 8 by byla ~200 ms na výchozí pozici – bez časové kontroly (fáze 15) jsem zůstal u 6, protože nejhorší případ v dámových koncovkách není shora omezený.

## Nezávislý self-review (sub-agent, čerstvý kontext)

Kritické/střední: žádné. Mutační zkoušky potvrdily, že testy mají zuby (prohozené znaménko, rozbité okno, vypuštěný ply i evaluace bez perspektivy – vše chytí konkrétní test). Hrubá síla ověřila okno `best − 1` na 800 případech bez neshody. Dva nálezy nízké závažnosti jsem opravil (-0 ve skóre `searchRoot`, křehké `toBe(-0)` v testu symetrie); třetí (dvojí výpočet `legalMoves` v handleru – jednou pro `no_legal_moves`, jednou v searchi) nechávám: proti ceně hloubky 6 je to šum a oprava by rozšiřovala API searche.

## Na co si dát pozor dál

- **Horizont efekt je reálný:** bez quiescence (fáze 15) engine na hranici hloubky nevidí vynucenou ztrátu o půltah dál. Proti random hráči to nevadí, proti člověku bude dělat viditelné taktické chyby.
- **Doba tahu není shora omezená:** pevná hloubka bez timeoutu znamená, že patologická pozice (hodně dam, otevřená deska) může trvat násobně déle než naměřených 99 ms. Server (M4) na to nesmí spoléhat dřív, než přijde časová kontrola.
- **Engine remízy nevidí:** search hodnotí jen pozici; o čítači půltahů a opakování neví. Ve vyhrané koncovce se tak umí točit v kruhu, dokud remízu nezahlásí server. Řeší až protokolové rozšíření (fáze 15+).
- Trik s oknem `best − 1` stojí na celočíselném skóre – kdo někdy přidá do evaluace desetinné váhy, rozbije sběr rovnocenných tahů (vlastnostní test to chytí).

Ověřeno mechanicky: `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` (rules 100 %, cli 24, engine 81 testů) – vše zelené. Nic pro lidské oko (UI žádné), pole `verify` proto vynechávám.

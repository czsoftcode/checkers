---
phase: 42
verdict: done
steps:
  - title: "selection.ts: dohledání celého řetězce k endpointu"
    status: done
  - title: "board-view: tap přepsán na Pointer Events"
    status: done
  - title: "board-view: drag mechanika, návrat, CSS"
    status: done
  - title: "controller: drop resolver + odeslání bez re-animace"
    status: done
  - title: "Sjednocení rozpracovaného braní (tap i drag)"
    status: done
  - title: "Testy a ruční vizuální ověření"
    status: done
verify:
  - title: "Uchopení myší + kurzor (grab/grabbing) na desktopu"
    detail: "Po feedbacku k myši: kámen se teď UCHOPÍ hned při stisku (pointerdown) – zvedne se, vybere a zvýrazní cíle, bez čekání na pohyb (práh jsem zrušil). Kurzor je nad vlastním kamenem `grab` (otevřená dlaň, přes CSS `:has(.piece.black)`) a po dobu držení `grabbing` (pěst, třída `.board.grabbing`). jsdom neumí layout ani kurzor, takže tohle ověř v PROHLÍŽEČI: snadné uchopení, správné kurzory, plynulé sledování myší (WAAPI), návrat a zmenšení po neúspěšném puštění. Pozn.: klik na vlastní kámen ho teď VYBERE (neumí ho odznačit dalším klikem – zrušit výběr jde klikem jinam)."
  - title: "Chování na mobilu (dotyk)"
    detail: "touch-action: none je na hracích polích, aby tažení nescrollovalo stránku. Ověř na reálném dotyku: tažení kamene neposouvá stránku, ťuknutí pořád vybírá, a scroll jde z prázdné plochy mimo desku. Autor to chtěl vyzkoušet v reálu."
  - title: "Braní: kámen zůstává na dopadu (i sebraný zmizí) – i pro tap"
    detail: "KLÍČOVÉ k posouzení v prohlížeči. Při vícenásobném braní zůstane kámen po puštění na poli meziskoku a čeká na další skok (sebraný kámen zmizí). Platí to i pro KLIKÁNÍ (tap) – kvůli konzistenci se rozpracované braní i u tapu zobrazuje s kamenem na posledním dopadu (dřív kámen u tapu stál na výchozím poli a celý řetěz se animoval až na konci; tuhle plynulou animaci tapového víceskoku jsem tím ZRUŠIL – místo ní kámen 'doskáče' po dopadech). Ověř, že to vypadá dobře pro obě ovládání, a že souvislé tažení rovnou na koncové pole taky funguje. Enginový (bílý) tah se animuje jako dřív."
  - title: "Otočená deska + hit-test"
    detail: "Deska je otočená o 180° (člověk dole). Hit-test bere pole podle prvku pod bodem puštění (elementFromPoint), ne z přepočtu souřadnic, takže by měl sedět i po otočení – ověř, že tažení míří na správné pole v obou půlkách desky."
---

# Fáze 42 — report z auto session

## Co je hotové
Drag & drop kamenů funguje vedle stávajícího ťukání (tap). Vše automaticky ověřitelné je zelené:
`pnpm --filter @checkers/web test` = 174 passed, `tsc --noEmit` = 0, `pnpm -w lint` = 0,
`pnpm --filter @checkers/web build` OK, celý repozitář (`pnpm -w test`) = cli/web/engine/server zelené.

- **selection.ts**: `resolveChainTo` (celý legální řetěz braní ke koncovému poli; null i při nejednoznačnosti), `capturedOnHop`, `capturesForPrefix` (sebrané dosavadní předpony – pro optimistické zobrazení). Unit testy včetně dvojznačnosti pokryté reálnou kruhovou pozicí (král 2, bílí 6/7/14/15) nalezenou brute-forcem přes `legalMoves`.
- **board-view.ts**: Pointer Events pro tažení; zvednutí (třída `dragging` + scale/z-index/stín, posun přes WAAPI kvůli CSP), hit-test přes `elementFromPoint`. `hop` i `commit` usadí kámen na dopad. Nové metody `setHighlights`/`settle` a callbacky `DragCallbacks`/`DropOutcome`.
- **controller.ts**: `effectivePosition` (optimistické zobrazení kamene na posledním dopadu + schování sebraných), `currentRenderState`/`renderStatic`, `submitMove(from,path,animate)`, `canDrag`/`onDragStart`/`onDrop` (drop resolver), příznaky `settleNext` (usadit bez re-animace/zvuku rozjezdu) a `dragging` (kámen „v ruce" → přeskoč polling).
- **CSS**: `.piece.dragging`, `touch-action: none` na hracích polích.
- **Testy** `controller-drag.test.ts`: prostý tah, souvislé braní na koncové pole, hop po hopu (kámen zůstane na dopadu), koexistence tap+drag, nelegální/mimo → návrat, potlačení `click` po tažení, jen `land` (ne `move`), poll během sekvence, a chybová cesta dragu (409 → návrat + obnova sebraných).

## Vývoj chování během fáze (důležité)
Fázi jsem dodělal ve DVOU kolech kvůli zpětné vazbě uživatele:
1. **První verze:** kámen se u meziskoku VRACEL na výchozí pole (kvůli konzistenci a nižšímu riziku). Uživatel to odmítl s tím, že kámen musí u meziskoku ZŮSTAT na dopadu a čekat na další skok.
2. **Přepracování (finální):** zavedl jsem „optimistické zobrazení" – během rozpracovaného braní se pohyblivý kámen zobrazuje na posledním dopadu a dosud sebrané kameny se schovají. Odvozuje se to čistě z výběru (`effectivePosition` v controlleru), takže poll ani další tah stav „nevzkřísí". Kvůli konzistenci to platí i pro KLIKÁNÍ (tap) – dřív u tapu kámen stál na výchozím poli a celý řetěz se animoval na konci; **tuhle plynulou animaci tapového víceskoku jsem zrušil**, kámen teď u tapu „doskáče" po dopadech stejně jako u dragu. Enginový (bílý) tah se animuje beze změny.
3. **Ovládání myší (feedback k desktopu):** dřív se kámen zvedal až po překročení prahu pohybu (6 px), takže se „špatně uchopoval" a kurzor zůstával ukazováček. Teď se kámen UCHOPÍ hned při stisku (pointerdown): zvedne se, vybere, zvýrazní cíle a kurzor je `grab`/`grabbing` (dlaň/pěst). Práh jsem odstranil (uchopení je okamžité). Klik na vlastní kámen ho vybere; klik po uchopení se spolkne (`suppressNextClick`), ať se výběr neudělá podruhé. Drobný důsledek: vlastní kámen už nejde odznačit dalším klikem na něj (jen klikem jinam).
4. **Bugfix „kámen odletí a nejde táhnout":** stisk myši spouštěl NATIVNÍ drag prohlížeče / výběr textu (koruna dámy ♛), což vystřelilo `pointercancel` – uchopení se přerušilo a kámen „přiletěl z levého horního rohu" (animace návratu ze souřadnic 0,0 z `pointercancel`). Fix: `event.preventDefault()` na uchopení + `user-select: none`/`-webkit-user-select` na desce (potlačí nativní drag/výběr) a animace návratu se počítá z POSLEDNÍHO známého posunu tažení, ne ze souřadnic `pointercancel`/`pointerup` (ty bývají 0,0). Přidán test, že `pointercancel` uprostřed tažení uklidí stav a další uchopení zase funguje.

## Odchylka od plánu (vědomá)
**Ťukání (tap) zůstalo na `click` listeneru** – nepřepsal jsem ho celé na Pointer Events. Přepis by znamenal přepsat desítky stávajících `click` testů bez zisku; tap přes `click` má správnou sémantiku. Tažení jede přes pointer eventy vedle; jednorázový `suppressNextClick` (shozený každým `pointerdown`) zabrání, aby se tažení počítalo i jako tap.

## Self-review (dvě nezávislá kola)
Po každé verzi jsem pustil nezávislý adversariální review (čerstvý kontext, ať nesdílí můj blind spot).
- **1. kolo (první verze):** našlo REÁLNÝ bug – meziskok mazal sebraný kámen z DOM, ale lokální `position` se u hopu neměnila → poll/tap ho „vzkřísil" a přehrál dvojitou animaci. Ten problém finální přepracování odstranilo systémově (optimistické zobrazení je konzistentní pro všechna překreslení). Přidán test s reálným pollingem během sekvence.
- **2. kolo (finální přepis):** v přepracované logice **NENAŠLO reálnou chybu** – protrasovalo `effectivePosition`, reset (vrátí kámen i všechny sebrané ze serverové pravdy), matici settle-vs-animate (AI animuje, prostý tah animuje, víceskok/drag se usadí), míchání tap+drag i DOM identitu elementu. Ukázalo dvě díry v testech, které jsem DOPLNIL: (a) chybová cesta DRAGU (409) – jiná výchozí DOM situace při selhání než u tapu, nový test ověří návrat kamene z cíle na výchozí pole a obnovu sebraných; (b) přímý unit test `capturesForPrefix` (větvení + prázdná/nesmyslná předpona).

Drobnosti obou kol, které jsem NEřešil (nízké riziko / předchází fázi 42): za běhu animace enginova tahu je `busy=false`, takže jde sáhnout na kámen ještě během animace (dědí se z tapu, `settle`/server to ošetří); chybová cesta dělá `render()`+`renderStatic()` (idempotentní, mírně marnotratné).

## Rozhodnutí k zaznamenání
Doporučuji před `/mini:done` spustit **`/mini:decision`** – padlo reálné rozhodnutí se zamítnutou alternativou: finální „optimistické zobrazení kamene na posledním dopadu (kámen zůstane na dopadu i u tapu, ZA CENU zrušení plynulé animace tapového víceskoku)" vs. zamítnuté „kámen se u meziskoku vrací na výchozí pole (zachovalo by tapovou animaci, ale kámen by pod prstem nezůstal)". Uživatel explicitně chtěl to první.

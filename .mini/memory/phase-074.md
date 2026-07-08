# Phase 74 — Tažení kamene v PvP

**Goal:** PvP deska dostane tažení kamene myší (drag & drop) jako hra s počítačem: uchopení vlastního kamene, tažení na cílové pole i přes vícenásobný skok, po dokončení se tah pošle serveru (autorita). Při odmítnutí serverem se kámen vrátí na poslední potvrzené pole (deska se celá dorovná, ne jen zvýraznění – dnešní showError to neumí), stejně tak při ztrátě spojení. Drag je jen myší, dotyk/mobil zůstává na ťuknutí (jako u AI). Znovupoužít sdílené pomocníky ze selection.ts (resolveMove, resolveChainTo, capturedOnHop, nextTargets) + drobný lastHopOf. Vědomě mimo řez: vzdání/remíza (todo 40), odveta, sjednocení s AI nad rámec drag callbacků.

## Steps
- [done] Drag callbacky v pvp-controlleru
- [done] Optimistické usazení a návrat kamene
- [done] Testy tažení v PvP
- [done] Ověření + red-team self-review

## Auto-commit
- Phase 74: Tažení kamene v PvP

## Run report
---
phase: 74
verdict: done
steps:
  - title: "Drag callbacky v pvp-controlleru"
    status: done
  - title: "Optimistické usazení a návrat kamene"
    status: done
  - title: "Testy tažení v PvP"
    status: done
  - title: "Ověření + red-team self-review"
    status: done
verify:
  - title: "Skutečné tažení kamene myší v prohlížeči (plynulost, kámen sleduje kurzor, dopad)"
    detail: "jsdom nemá WAAPI ani layout – testy ověřují jen LOGIKU dropu (co se odešle, co se usadí/vrátí). Reálné gesto a plynulost ověř v běžícím klientovi."
  - title: "Po potvrzení TAŽENÉHO tahu se pohyb NEpřehraje podruhé jako sklouznutí"
    detail: "To je smysl settleNext (settle místo update). V jsdom settle i update skončí stejným okamžitým překreslením, takže tuhle větev test nerozliší (známá díra – red-team Nález 2). Ověř okem: po puštění kamene má zůstat na místě, ne odskočit a přiletět animací."
  - title: "Vícenásobný skok TAŽENÍM na koncové pole a že mezidopad se vrátí"
    detail: "Logika je testovaná; ověř v reálu, že táhnout dvojskok rovnou na koncové pole funguje a že puštění na mezipole kámen vrátí (doskákat hop-po-hopu jde jen klikáním – vědomé rozhodnutí, viz níže). PO ZPĚTNÉ VAZBĚ z testování: při tažení se teď zeleně zvýrazní KONCOVÁ pole (kam se dá pustit), ne jen první dopad – ověř, že je to čitelné."
  - title: "Rychlé odmítnutí TAŽENÉHO braní obnoví sebraný kámen (fade-revive)"
    detail: "Opraveno (Nález 1) a pokryto testem s fake WAAPI. Reálné chování v prohlížeči (odmítnout braní do ~200 ms) ať potvrdí oko – sebraný kámen se má vrátit, ne zmizet."
---

# Fáze 74 — report z auto session

## Co je hotové
PvP deska (`pvp-controller.ts`) dostala tažení kamene myší (drag & drop) přes
`DragCallbacks` (`canDrag`/`onDragStart`/`onDrop`) zapojené do `createBoardView`.
Znovupoužity sdílené pomocníky ze `selection.ts` (`nextTargets`/`resolveMove`/
`resolveChainTo`/`capturedOnHop`). Dotyk/mobil zůstává na ťuknutí (drag jen myší,
řeší board-view). 11 nových testů v `pvp-controller.test.ts` (pointer eventy + mock
`elementFromPoint`).

Ověřeno mechanicky: typecheck (celé repo), lint, `pnpm --filter @checkers/web test`
(349 testů zelených), produkční build.

## Vědomé rozhodnutí (→ /mini:decision PŘED /mini:done)
PvP tažení se ZÁMĚRNĚ chová jinak než hra proti AI: **řeší celý tah v JEDNOM gestu**
(prostý tah / braní / vícenásobný skok rovnou na KONCOVÉ pole); mezidopad se vrátí,
doskákat hop-po-hopu jde jen klikáním. Zavrhnut byl model AI (tažení s meziskoky
`hop`) i míchání tažení s rozklikanou sekvencí. Důvod: PvP je push-based a klik je
NEoptimistický (kámen se nehne, dokud server nepotvrdí), kdežto tažení kámen fyzicky
přesune. AI to srovnává pollingem každých 250 ms, PvP ne – takže optimistický „drift"
(kámen visící v mezitahu se zmizelými sebranými kameny) by neměl jak se sám opravit.
Model „celý tah v jednom gestu" drift úplně vylučuje (kámen se buď dokončí, nebo vrátí).
Doporučuju zaznamenat přes `/mini:decision` (proč se PvP drag liší od AI).

## Návrat / usazení (chybová cesta)
- `settleNext`: po dokončení tažení se tah pošle, vstup zamkne a příští `applyState`
  stav USADÍ (`view.settle`) místo animace (kámen už je rukou na cíli). Reset na všech
  cestách (applyState/showError/setConnectionLost).
- `showError` i `setConnectionLost` teď vrací kámen na potvrzenou pozici přes
  `view.settle(renderState())` (dřív `setHighlights`, který pozice kamenů neřešil).

## Na co jsem narazil (red-team, čerstvý kontext)
Nezávislý sub-agent potvrdil, že jádro (settleNext, zámky, návrat, commit při
`sent===false`) drží, a našel jeden REÁLNÝ browser-only bug:
- **Nález 1 (opraveno):** při rychlém odmítnutí/odpojení taženého BRANÍ (do ~200 ms)
  `view.settle` znovupoužil mizející element sebraného kamene (className seděl), fade
  s `fill:forwards` + `.finished.then(remove)` pak kámen odstranil → sebraný kámen z
  desky ZMIZEL místo obnovení. Oprava v `board-view.ts`: běžící fade sebraných se drží
  v mapě `capturingFades`; `applyPieces` při obsazení pole zavolá `reviveCaptured`
  (zruší fade tak, aby `.finished` handler element neodstranil). Pokryto testem s fake
  WAAPI (`board-view-animation.test.ts`) – bez fixu test spadne.
- **Nález 2 (díra v pokrytí, ne bug):** rozdíl settle vs update (celé `settleNext`)
  nejde v jsdom otestovat (settle i update tam skončí stejně) – přesunuto do `verify`
  pro lidské oko.

## Oprava po zpětné vazbě z testování (highlight cílů při tažení)
Při reálném testu se ukázalo, že u vícenásobného skoku se při tažení zeleně zvýraznil
jen PRVNÍ dopad, ne koncové pole, kam se má kámen pustit → nebylo poznat, kam táhnout.
Přidán helper `endpointsFor` (selection.ts) = koncová pole všech tahů z pole; `renderState`
při TAŽENÍ (`dragging`) zvýrazní koncová pole, při KLIKÁNÍ dál bezprostřední dopady
(hop-po-hopu beze změny). Po vrácení kamene (`onDrop` → `bounce`) se zvýraznění srovná
zpět do klik režimu. Pokryto testy (pvp-controller: highlight při tažení vs. klikání;
selection: `endpointsFor`).

## Poznámka
Kromě `pvp-controller.ts` jsem sáhl i do `board-view.ts` (fade-revive) – to je oprava
kontraktu `settle` odhalená touhle fází (dřív ji nikdo nevolal těsně po taženém braní).
Změna se dotkla i `selection.ts` (nový sdílený `endpointsFor`).

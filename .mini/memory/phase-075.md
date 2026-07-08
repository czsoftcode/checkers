# Phase 75 — Skok po krocích tažením v PvP

**Goal:** Hop-po-hopu vícenásobný skok TAŽENÍM myší na PvP desce (parita s hrou proti AI): kámen jde pustit i na mezidopad, zůstane na dopadu a čeká na další skok. Deska se ZAMKNE do dokončení skoku (žádná úniková cesta → žádný optimistický drift, který PvP bez pollingu neumí sám srovnat); jediné vědomé ZRUŠENÍ skoku srovná desku zpět na potvrzenou pozici (view.settle). Rozdělaný skok se ukazuje opticky (kámen na mezidopadu, sebrané pryč) shodně u tažení i klikání. Ztráta spojení lock přebije a srovná zpět. Vizuálně dát najevo 'dokonči skok', ať to nevypadá zamrzle. Vědomě mimo řez: vzdání/remíza (todo 40), reconnection (todo 42).

## Steps
- [done] Optimistický render rozdělaného skoku v renderState
- [done] Hop-po-hopu tažení + míchání s klikáním
- [done] Tvrdý zámek do dokončení skoku
- [done] Přepsat kontrakt/komentáře + zvýraznění dokonči skok
- [done] Testy: obrácené případy + nové
- [done] Ověření + nezávislý adversarial self-review

## Auto-commit
- Phase 75: Skok po krocích tažením v PvP

## Discussion
# Phase 75 — Skok po krocích tažením v PvP

## Intent
Vícenásobný skok TAŽENÍM na PvP desce má fungovat hop-po-hopu (parita se hrou proti
AI): kámen jde pustit i na mezidopad, tam ZŮSTANE a čeká na další skok. Rozdělaný skok
se ukazuje OPTICKY (kámen na mezidopadu, sebrané kameny zmizí) shodně u tažení i
klikání. Dnes PvP umí tažení jen „celý řetěz najednou" (drop na koncové pole; mezidopad
= návrat) a klikání kámen během skládání NEhýbe.

Technicky jde hlavně o přenesení HOTOVÉHO vzoru z `controller.ts` (hra proti AI) do
`pvp-controller.ts`:
- `effectivePosition(selection)` / `capturesForPrefix` — optická pozice s kamenem na
  posledním dopadu a schovanými sebranými (v `renderState`),
- `onDrop` s návratem `{ kind: 'hop', landing, captured }` pro mezidopad (kámen zůstane),
- `canDrag` / `onDragStart`, které během sekvence dovolí zvednout kámen na posledním
  dopadu (`lastHopOf`) a pokračovat.
`board-view` už `kind:'hop'` i `settle` umí, měnit ho není třeba.

KLÍČOVÝ ROZDÍL proti AI hře: AI controller má pojistku (polling → resync), PvP polling
NEMÁ (jen server push). Proto se místo pollingu použije ZÁMEK: jakmile začne
vícenásobný skok, deska se zamkne do jeho dokončení (žádná úniková cesta → nevznikne
optická „rozdělaná" pozice, kterou by PvP bez pollingu neuměl srovnat).

Mimo řez (vědomě): vzdání/remíza (todo 40), reconnection (todo 42).

## Key decisions
- **Tvrdý zámek, BEZ vědomého zrušení skoku (varianta „hard lock").** Jakmile hráč
  potvrdí první meziskok, MUSÍ řetěz dokončit; jediný únik je ztráta spojení
  (`setConnectionLost` přebije zámek a srovná desku zpět) a odmítnutí serverem
  (`showError` → settle). Tlačítko/gesto „zrušit skok" se teď NEDĚLÁ.
  - Zdůvodnění: do řetězu nejde spadnout omylem — meziskok se potvrdí, JEN když kámen
    pustíš přesně na zvýrazněný povinný dopad (jinam → kámen se vrátí, nic se nezahájí);
    klik mimo cíl nic nezahájí. Rozdělaný (nedokončený) skok navíc podle pravidel NENÍ
    platný tah, takže se na server nikdy neposílá.
  - Cena (přijatá): když si hráč VĚDOMĚ vybere špatnou větev/kámen (větvení v americké
    dámě občas nastane, hlavně s dámou), je nucen dohrát tah, který nechtěl. Když to
    při hraní bude vadit → přidat „zrušení skoku" jako pozdější todo.
- **Míchání tažení a klikání v JEDNOM skoku POVOLENO (parita s AI).** Ruší se dnešní
  tvrdé oddělení v PvP (`canDrag` dnes vrací false při `selection.path.length > 0`).
  Kámen na mezidopadu jde vzít znovu do ruky NEBO doklikat; obojí ukazuje stejnou
  optickou pozici.
- **Výzva „dokonči skok" = ZVÝRAZNĚNÍ NA DESCE** (povinné další dopady), bez textu ve
  stavovém řádku. Ať to nevypadá zamrzle.
- **Pravidla (americká dáma):** braní povinné, započatý skok se musí dokončit, ALE bez
  pravidla „ber nejdelší" — výběr kamene i směru na mezidopadu je svobodný. Rozdělaný
  skok se na server neposílá; celý tah (výchozí pole + celá cesta) se pošle až po
  dokončení, pak `pendingMove` + `settleNext` (jako dnes u drag-commit).

## Watch out for
- **Obrácení dosavadního invariantu.** Celý komentář v `pvp-controller.ts` dnes staví
  na „deska se NEhýbe optimisticky". Po fázi se BUDE hýbat opticky během skládání
  skoku. Plán MUSÍ ten komentář přepsat, ať v kódu nezůstane protichůdné odůvodnění.
  (Je to obhajitelné: dokud se skok neodešle, server nic neví, optika je čistě lokální
  a plně vratná přes `view.settle`.)
- **`applyState` uprostřed rozdělaného skoku.** Během mého tahu by neměl dorazit nový
  autoritativní stav, ale kdyby (stale/duplicitní push) dorazil, `applyState` dnes
  resetuje `selection=null` a překreslí potvrzenou pozici → smaže optický rozdělaný
  skok. To je z hlediska autority správné, ale ať se to při testu nepřehlédne.
- **Myší ťuk vs. dotyk.** Ťuknutí myší na kámen jde přes drag cestu (`onDragStart` +
  `onDrop` bez pohybu), následný `click` je potlačený; dotyk jde přes `click`. Při
  úpravě `canDrag`/`onDrop`/`handleClick` pro sekvenci ověřit, že se zvednutí kamene na
  mezidopadu chová stejně na myši i na dotyku (aby šlo pokračovat oběma způsoby).
- **Import.** `pvp-controller` dnes NEimportuje `capturesForPrefix` (potřeba pro
  `effectivePosition`) — přidat ze `./selection.js`.
- **`renderState` cíle.** Dnes při tažení svítí `endpointsFor` (koncová pole celého
  tahu), při klikání `nextTargets`. Pro hop-po-hopu tažení musí i drag zvýrazňovat
  BEZPROSTŘEDNÍ další dopady (`nextTargets`), ne koncová pole — jinak by hráč nevěděl,
  kam smí pustit další skok. Sladit s tím, že se míchá drag+klik.
- **Adversarial (dle CLAUDE.md):** fáze sahá na chybové/vstupní cesty controlleru →
  před reportem pustit nezávislého sub-agenta. Unhappy path: drop mimo desku, drop na
  nelegální pole, ztráta spojení uprostřed skoku, odmítnutí serverem uprostřed skoku,
  push stavu uprostřed skoku, přechod man→king na konci řetězu (proměnu potvrdí server).

## Run report
---
phase: 75
verdict: done
steps:
  - title: "Optimistický render rozdělaného skoku v renderState"
    status: done
  - title: "Hop-po-hopu tažení + míchání s klikáním"
    status: done
  - title: "Tvrdý zámek do dokončení skoku"
    status: done
  - title: "Přepsat kontrakt/komentáře + zvýraznění dokonči skok"
    status: done
  - title: "Testy: obrácené případy + nové"
    status: done
  - title: "Ověření + nezávislý adversarial self-review"
    status: done
verify:
  - title: "Optika a plynulost rozdělaného skoku v reálném prohlížeči (myš)"
    detail: "Testy běží v jsdom (bez WAAPI/layoutu). Ověř okem: hop-po-hopu tažení i klikání – kámen zůstane na mezidopadu, sebrané zmizí, zvýrazní se povinný další dopad; míchání tažení+klik v jednom skoku; po dokončení se kámen jen usadí (žádné druhé sklouznutí)."
  - title: "Vizuální výzva 'dokonči skok' čitelná dost, ať to nevypadá zamrzle"
    detail: "Rozhodli jsme se NEpřidávat text do stavu, jen zvýraznit povinné další dopady (třída .target) + kámen na dopadu (.selected) + trasa (.path). Posuď, jestli to hráči dost jasně říká 'skoč dál', nebo to chce víc (např. pulz cíle) – to by byla další fáze."
  - title: "Klikací víceskok: poslední dopad se ukáže až po serveru (parita s AI)"
    detail: "Při DOKONČENÍ víceskoku klikáním kámen zůstane opticky na předposledním dopadu a na koncové pole 'doskočí' až s potvrzeným stavem ze serveru. Shodné s hrou proti AI (záměr), ale v PvP s vyšší latencí to může být víc vidět. Posuď, jestli vadí."
---

# Phase 75 — report z auto session

## Co se udělalo
Vícenásobný skok na PvP desce teď jde skládat HOP-PO-HOPU tažením i klikáním (parita s hrou proti AI). Kámen jde pustit/ťuknout i na mezidopad, tam ZŮSTANE a čeká na další skok; rozdělaný skok se ukazuje opticky shodně u obou způsobů (`effectivePosition`: kámen na dopadu, sebrané schované). Tažení a klikání jde v jednom skoku míchat.

Jádro je přenesení hotového vzoru z `controller.ts` (hra proti AI) do `pvp-controller.ts`: `lastHopOf`, `effectivePosition` (+ import `capturesForPrefix`), `onDrop` s `{ kind: 'hop' }`, pokračování tažení z posledního dopadu (`canDrag`/`onDragStart`), klikací hop přes `view.settle` a `settleNext` pro víceskok. `board-view` se neměnil (`hop`/`settle` už uměl).

Klíčový PvP rozdíl proti AI: žádný polling. Proto místo pollingu TVRDÝ ZÁMEK – jakmile hráč potvrdí první meziskok (`selection.path.length > 0`), deska je zamčená do dokončení: klik mimo povinný dopad se ignoruje (žádné zrušení), přetáhnout jde jen kámen na posledním dopadu. Únik ze zámku: dokončení, odmítnutí serverem (`showError`), nebo ztráta spojení (`setConnectionLost`) – oba srovnají desku zpět přes `view.settle` (vrátí i optimisticky sebrané kameny).

Přepsal jsem hlavičkový doc-komentář `pvp-controller.ts`: dřív stavěl na „deska se NEhýbe optimisticky", teď se během skládání skoku opticky hýbe (zdůvodnění: dokud se skok neodešle, server o něm neví → optika je lokální a plně vratná přes settle).

## Ověření
- `pnpm -r typecheck` zelené, `pnpm lint` (eslint) zelené.
- Testy: web 363 (z toho pvp-controller 33 – přidal jsem 10 nových + upravil 2 obrácené), rules/engine/cli/server beze změny a zelené.
- Dva testy obrátily chování (dřív padaly happy-path předpoklady): „dopad na MEZIpole" (dřív návrat → teď hop, kámen zůstane) a „při tažení svítí KONCOVÉ pole" (dřív endpoints → teď bezprostřední dopad).
- Nové testy s zuby na unhappy path: ztráta spojení / showError uprostřed skoku (obnova sebraných), neúspěšné odeslání dokončeného víceskoku, tvrdý zámek (stray klik nic nezruší a skok jde dokončit), míchání gest obou směrů.

## Adversarial (nezávislý sub-agent, čerstvý kontext)
Prošel scénáře: drop mimo/nelegál uprostřed skoku, loss/showError uprostřed, `applyState` uprostřed skoku, proměna man→king na konci řetězu, `sendMove=false` po optických hopech, míchání gest. Verdikt: žádný tvrdý dosažitelný stav-korupční nález; invariant drží. Ověřil i, že proměna vždy ukončuje tah (generátor pravidel), takže `effectivePosition` nikdy nezobrazí muže „za proměnou".

Jeden bod z review jsem ROVNOU OPRAVIL: `sendMove` se volalo bez `try/catch`, a `socket.send` může ve vzácném závodě stavu spojení vyhodit – výjimka by propadla z `onDrop`, deska by nespustila `finishDrag` (tažený kámen zůstane zvednutý, vstup odemčený, bez hlášky). Přidal jsem `trySend` s úzkým catch jen kolem `sendMove` (nemaskuje logiku controlleru), který výjimku bere jako „neodesláno" a jede stejnou vratnou cestou jako `false` + regresní test.

## Mimo řez (vědomě)
Vzdání/remíza (todo 40), reconnection (todo 42). „Vědomé zrušení skoku" jsme se rozhodli NEdělat (tvrdý zámek) – kdyby při hraní vadilo (uvíznutí ve vědomě špatně zvolené větvi), je to kandidát na pozdější todo.

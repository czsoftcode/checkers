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

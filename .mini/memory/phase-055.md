# Phase 55 — Obrázkové kameny a deska (webp)

**Goal:** Nahradit CSS kameny a barevná pole desky obrázky webp (černý/červený kámen + dáma, dřevěná deska game_board.webp) s fallbackem na dosavadní CSS, zvětšit kameny na 0.8 pole a přidat stín pod kameny (výraznější při tažení).

## Auto-commit
- Phase 55: Obrázkové kameny a deska (webp)

## Run report
---
phase: 55
verdict: done
steps:
  []  # fáze nemá kroky
verify:
  - title: "Vizuál desky a kamenů v reálném prohlížeči"
    detail: "Obrázkové kameny (černý/červený, man i dáma) na dřevěné desce, velikost 0.8 pole, statický stín vpravo dole a větší stín při tažení. Ověřeno jen izolovaně přes render (sharp): lícování mřížky obrázku s DOM, parita polí (kameny padnou na tmavá pole), centrování, přibližný dojem stínu. Reálnou appku jsem nespustil – tvůj Chrome běží na tvém stroji, můj testovací server v sandboxu, localhost se nepotkají. Doporučuji /mini:verify: pnpm dev (web) + server, mrknout na kontrast žlutého výběru / zeleného cíle / modré nápovědy na hnědém dřevě, čitelnost černého kamene na tmavém poli, a stín při tažení myší."
  - title: "Cross-layer vazba --piece-scale (CSS) × DRAG_LIFT_SCALE (JS)"
    detail: "0.8 × 1.1875 = 0.95 (zvednutý kámen se ještě vejde do pole). Vazba nejde svázat sdílenou konstantou (CSS proměnná není v JS bez čtení computed stylu), drží ji jen komentář na obou místech. Při budoucí změně --piece-scale je nutné přepočítat DRAG_LIFT_SCALE ručně, jinak zvednutý kámen přeteče do sousedních polí (jen vizuální regrese, nic to nezachytí)."
---

# Phase 55 — report z auto session

## Co je hotové
Nahrazení CSS vzhledu obrázky webp, s fallbackem na dosavadní CSS:

- **Kameny (webp):** `piece-images.ts` importuje 4 webp (černý/červený man + dáma), `enablePieceImages` po ověření načtení VŠECH přidá třídu `pieces-img` na `.board`. CSS pod `.board.pieces-img` použije obrázky, zruší lem a skryje CSS korunku dámy (webp dáma má korunku v obrázku). Fallback (bez třídy): dnešní gradient, „bílý" kámen přebarven na červenou, ať se s webp vizuálně nerozjede.
- **Deska (webp):** `board-image.ts` + `game_board.webp` (zmenšeno 2048→1536). `enableBoardImage` po ověření přidá `board-img`; CSS roztáhne obrázek přes desku a zprůhlední pole. Zvýraznění (výběr/cíl/nápověda) jedou přes overlay a fungují beze změny; cesta skoku (`.path`) si drží poloprůhledné podbarvení vyšší specificitou.
- **Sdílené ověření:** `image-preload.ts` (`preloadImages`) – buď se načtou všechny, nebo fallback. Žádný částečný stav uvnitř jedné vrstvy.
- **Velikost:** proměnná `--piece-scale: 0.8` (deska i indikátor na tahu z jednoho místa).
- **Stín:** `filter: drop-shadow` na `.piece` (vpravo dolů, škáluje s `--square`), větší na `.piece.dragging`. `DRAG_LIFT_SCALE` 1.18→1.1875.

## Ověřeno mechanicky
- Typecheck (celé repo), lint, **244 web testů + engine 250 + server 146** zelené, build prošel.
- **Kontrakt CSS `url()` ↔ JS `?url`:** build potvrdil, že všech 5 obrázků má v CSS i JS identickou hashovanou cestu – detekce ověřuje přesně to, co CSS načte.
- **Geometrie:** render přes sharp potvrdil lícování mřížky obrázku s DOM a paritu (kameny na tmavých polích).
- **Testy mají zuby:** ověřeno dočasným rozbitím (`.every`→`.some` v preloadu, špatná třída v enable) – testy spadly, revert je vrátil.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Sub-agent nenašel žádný funkční bug ani porušení CSP. Potvrdil správnost kontraktů (hash shoda, korunka se nekreslí dvakrát, zvýraznění cesty přežije, stín se nezdvojuje). Nálezy a jak jsem s nimi naložil:

- **Nález 1 (STŘEDNÍ, opraveno):** komentář tvrdil, že guard `typeof Image !== 'function'` chrání fallback v jsdom – nepravda, v jsdom `Image` existuje a promise jen visí (nikdy nenačte). Opravil jsem komentáře na realitu a přepsal `enablePieceImages`/`enableBoardImage` na injektovatelnou `createImage` factory (default `null` bez `Image` → čistý Node se korektně vzdá, jsdom drží fallback „nikdy nenačte").
- **Nález 2 (STŘEDNÍ, opraveno):** přepínač vzhledu (enable → přidání SPRÁVNÉ třídy) nebyl pod testem. Přidán `test/enable-images.test.ts` (7 testů se zuby, včetně kontroly proti prohození tříd mezi moduly).
- **Nález 3 (NÍZKÁ, dokumentováno):** cross-layer scale bez testu – viz `verify` výše. Přidán obousměrný křížový odkaz v komentáři (CSS ↔ board-view.ts). Testovat literál proti literálu nemá zuby, proto ponecháno jako známý trade-off.
- **Nález 4 (kosmetika, opraveno):** zastaralý název `preloadPieceImages` v komentáři testu.

## Design trade-off (ne bug)
Deska a kameny se načítají nezávisle → teoreticky může nastat „webp deska + CSS kameny" (nebo naopak). Je to vědomé; každá vrstva je sama konzistentní a fallback kamene je přebarven na červenou, aby mix nebyl křiklavý. Riziko je čistě estetické.

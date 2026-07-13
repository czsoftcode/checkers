# Phase 117 — Italská: otočená deska a assety

**Goal:** Ve webovém renderu použít right_game_board.webp a red/white(_queen).webp JEN pro italskou variantu; ostatní varianty (american/pool/russian/czech) vizuálně NETKNUTÉ (svoje pozadí + black/white kameny). Otočení italské desky (černé pole vpravo dole, FID pravidlo 1) řešit POUZE vizuální rotací renderu v board-view.ts (a výběr assetů podle varianty v board-image.ts/piece-images.ts), BEZ jakéhokoli zásahu do parity polí, číslování nebo Zobristu v board.ts - hra zůstává na stejném souřadném systému jako americká (izomorfní zrcadlově otočené desce). KLÍČOVÉ k vyřešení v discuss/plan: jak se FIXNÍ italské otočení skládá se STÁVAJÍCÍM otočením podle barvy hráče (humanColor==='black' obrací pořadí append v board-view.ts ř.155-162) - ať se orientace nezkombinují špatně. Brána: italská se vykreslí otočená s red/white kameny a right_game_board pozadím; ostatní varianty vizuálně beze změny; klik na pole i zvýraznění legálních tahů fungují správně v otočené orientaci (data-square/parita/validace netknuté); celá suita zelená; tsc čistý; perft ostatních variant beze změny (do rules/src se nesahá).

## Steps
- [done] Protáhnout variantu do renderu + výběr URL
- [done] CSS pravidla pro italskou (CSP-safe)
- [done] Testy: výběr assetů podle varianty
- [done] Tvrdé vizuální ověření + brána

## Auto-commit
- Phase 117: Italská: otočená deska a assety

## Discussion
# Phase 117 — Italská: otočená deska a assety

## Intent
Vizuál italské varianty JEN pro italskou: deska `right_game_board.webp` + kameny `red.webp`/`red_queen.webp` (červená nahrazuje vnitřní „black") a `white.webp`/`white_queen.webp` (sdílené). Ostatní varianty (american/pool/russian/czech) vizuálně NETKNUTÉ. Bez zásahu do rules/src (parita, číslování, Zobrist, perft).

## Key decisions
- **ŽÁDNÁ rotace gridu — jen výběr assetů podle varianty.** Kontrola obrázků: `game_board.webp` (americká) i `right_game_board.webp` (italská) mají STEJNÉ rozložení hracích (tmavých) polí — tmavé pole vlevo nahoře i vpravo dole. Rozdíl je jen styl/kresba dřeva. Uživatel potvrdil, že italská má tmavé vpravo dole; klíčové je, že to má i americká (stejná parita), takže tmavá pole obrázku lícují s `.dark` buňkami gridu → stačí PROHODIT obrázek, pieces sedí bez rotace.
- **Tuhý CSS transform paritu NEOPRAVÍ.** Rotace/zrcadlení `.board` otočí pozadí (background-image) i kameny SPOLEČNĚ → jejich vzájemné zarovnání je invariantní. Takže: buď je obrázek stejné parity (plain swap funguje), NEBO by se musela zrcadlit sama grafika assetu. Paritu enginu (isDarkSquare/board.ts) NESAHAT (non-goal). Tím padá celá obava „skládání fixní rotace × otočení podle barvy hráče" — není co skládat, `reversed` (humanColor) zůstává beze změny a je ortogonální.
- **Mapování barev (potvrzeno):** vnitřní „black" → `red.webp`/`red_queen.webp`; „white" → `white.webp`/`white_queen.webp`. red.webp = červený kámen, red_queen.webp = červený se zlatou korunou.
- **Implementační tvar:** protáhnout variantu do renderu. Dnes `board-image.ts`/`piece-images.ts` mají natvrdo jeden set URL + po `preloadImages` přidají třídu (`board-img`/`pieces-img`). Pro italskou: `createBoardView` (board-view.ts, volá se z controller.ts a pvp-controller.ts — obě znají variantu) dostane variantu; `enableBoardImage`/`enablePieceImages` pro italskou přednačtou ITALSKÉ URL (jinak dnešní); `styles.css` variantně-scoped pravidla (`.board.variant-italian.board-img { background-image: url(right_game_board) }`, obdobně kameny) přes `url()` — CSP: ŽÁDNÝ inline styl.

## Watch out for
- **TVRDÉ VIZUÁLNÍ OVĚŘENÍ v do (brána):** po prohození reálně zkontrolovat (spustit web / screenshot), že red/white kameny SEDÍ NA TMAVÉM dřevě a tmavé pole je vpravo dole. Kdyby kameny seděly na SVĚTLÉM dřevě → obrázek je opačné parity → NAHLÁSIT a ZRCADLIT ASSET (paritu enginu nesahat), ne potichu. Toto je jádro fáze, ne jen „prohodit import".
- **CSP:** assety jen přes `styles.css url()` (Vite hash), nikdy inline styl/script (globální pravidlo uživatele). Stejný vzor jako dnešní `board-img`/`pieces-img`.
- **Preload gating (all-or-nothing):** `enablePieceImages` pro italskou musí přednačíst ITALSKÉ URL (red+white+queeny), aby fallback (buď všechny, nebo CSS) platil i pro italský set. Nezapomenout na board image (right_game_board) v enableBoardImage.
- **jsdom (testy):** Image se v jsdom nenačte (onload/onerror nevystřelí) → třída se nepřidá; stávající board-view/piece-images testy na tom stojí (fallback). Nové testy dělat stejně (injektovat createImage nebo ověřovat zapojení tříd/URL, NE reálné načtení). Ověřit, že pro italskou se do preloadu předávají správné URL.
- **Regrese ostatních variant:** american/pool/russian/czech dál používají `game_board.webp` + black/white. Test/ověření, že se jim vizuál nezměnil.
- **Rules/src netknuté:** perft beze změny (do rules se nesahá vůbec — čistě web render).

## Run report
---
phase: 117
verdict: done
steps:
  - title: "Protáhnout variantu do renderu + výběr URL"
    status: done
  - title: "CSS pravidla pro italskou (CSP-safe)"
    status: done
  - title: "Testy: výběr assetů podle varianty"
    status: done
  - title: "Tvrdé vizuální ověření + brána"
    status: done
---

# Fáze 117 — report z auto session

## Co je hotové
Italská varianta ve webovém renderu dostane vlastní assety (deska
`right_game_board.webp`, kameny `red.webp`/`red_queen.webp` místo vnitřních
„black"; „white" sdílené). Ostatní varianty jsou vizuálně netknuté. Do
`packages/rules/src` se nesáhlo – parita polí, číslování, Zobrist i perft beze změny.

**OPRAVA po prvním reportu (uživatel nahlásil špatně umístěné kameny):** discuss
tvrdil, že oba obrázky mají STEJNOU paritu a stačí prohodit asset bez rotace. To bylo
CHYBNĚ. Pixelové měření: `game_board` má tmavá pole na LICHÉ paritě (roh (0,0) světlý,
jas 152), `right_game_board` na SUDÉ (roh tmavý, jas 94) – OPAČNÁ parita. Engine klade
hrací pole na lichou paritu, takže u italského obrázku padla na SVĚTLÉ dřevo → kameny
stály na světlých polích. To je přesně vlast FID („casella in basso a destra nera" +
kameny na „caselle scure").

**Řešení = vizuální rotace renderu (původní záměr projektu):** pro italskou ZRCADLÍM
pořadí SLOUPCŮ v board-view (`colSeq = [...rowSeq].reverse()`). Tím se hrací pole enginu
posunou na sudou vizuální paritu = tmavé dřevo, a roh vpravo dole vyjde tmavý a obsazený
(FID/damiera). Řádky (orientace podle barvy hráče) beze změny. Čistě vizuální posun
pořadí appendu – `data-square`, parita, číslování, klik i validace se dál počítají
z reálných (row,col), engine/Zobrist/perft netknuté. Obrázek desky se NEMĚNÍ (je
správný). Asset-swap + red/white kameny z první verze zůstávají.

### Implementace
- `board-image.ts` / `piece-images.ts`: `enableBoardImage(root, variant, createImage?)`
  a `enablePieceImages(...)` vybírají URL podle varianty (`boardUrlFor`/`pieceUrlsFor`).
  Nové exporty `italianBoardImageUrl`, `italianPieceImageUrls`.
- `board-view.ts`: `createBoardView(..., variant='american')` + nová metoda
  `setVariant(variant)` na `BoardView`. Pro italskou synchronně přidá třídu
  `variant-italian`; assety přednačte podle varianty. Idempotentní.
- `controller.ts` (AIvP): předá `game.variant` do konstruktoru – variantu zná hned.
- `pvp-controller.ts` (PvP): variantu zná AŽ z autoritativního stavu, proto ji deska
  dostává přes `view.setVariant(dto.variant)` v `applyState` (idempotentní no-op po
  prvním stavu).
- `styles.css`: variantně-scoped pravidla `.board.variant-italian.board-img` (pozadí
  right_game_board), `.piece.black` → red.webp, `.piece.black.king` → red_queen.webp.
  Vše přes `url()` (Vite hash) – žádný inline styl (CSP).

## Ověření (mechanické, po opravě)
- **Parita (jádro rizika) – PIXELOVĚ end-to-end:** zrekonstruoval jsem italské vizuální
  mapování a změřil jas dřeva pod všemi 24 počátečními kameny: průměr 71, nejsvětlejší
  pole 98 (< 128) → VŠECHNY kameny na TMAVÉM dřevě. Roh vpravo dole jas 62 (tmavý) a je
  hrací (obsazený) → FID splněno. (V PRVNÍ verzi jsem tohle NEZměřil a spolehl se na
  chybné oko → kameny skončily na světlých polích. Teď měřeno na reálném obrázku.)
- **Testy zuby:** nové jsdom testy ověřují, že každé hrací pole italské leží na sudé
  vizuální paritě a roh vpravo dole je hrací; americká zůstává na liché paritě (regrese).
  Kdyby se zrcadlení sloupců ztratilo, testy padnou. `red.webp` je červený kámen.
- **Build:** `vite build` prošel; `right_game_board`, `red`, `red_queen` se zabalily a
  built CSS `.variant-italian` pravidla míří na správné hashované cesty. Žádný inline styl.
- **Suita:** celá `pnpm test` zelená (rules/engine/cli/ai/server/web), 639 web testů,
  268 engine testů (perft). `tsc` čistý, `eslint` čistý.
- **Interakce v otočené orientaci:** klik i zvýraznění jedou přes čísla polí 1–32 a
  `isDarkSquare`/`coordsToSquare`/validaci, které jsem nezměnil → logicky netknuté a
  kryté stávajícími testy (které dál procházejí). Živé kliknutí v prohlížeči jsem ale
  neodklikal (viz `verify`).

## Nezávislý adversariální self-review
Pustil jsem nezávislého sub-agenta (čerstvý kontext) – cross-module kontrakt, regrese,
async PvP, CSP. **Žádný korektnostní bug ani regrese ostatních variant.** Nálezy:
1. (nízká–střední) PvP: deska se tvoří bez znalosti varianty → konstruktor přednačte
   AMERICKÉ assety a teprve první stav přepne na italskou. U PvP italské = zbytečný
   preload + možný záblesk (americká/prázdná → italská) na pomalé lince. **Vědomě
   ponecháno:** týká se jen PvP italské (sekundární cesta, vyžaduje italskou místnost
   na serveru), NENÍ to regrese, brána (AIvP) je čistá, a odklad načtení pro PvP by
   zavlekl vlastní regresi (bezbarvá deska u VŠECH PvP variant před prvním stavem).
2. (nízká) Žádný test nepočítá počet preloadů → odstranění idempotenčního guardu (perf)
   test nechytne. Guard je triviální (`if next===applied return`), jeho viditelný efekt
   (přepínání třídy) testy hlídají. Ponecháno.
3. (velmi nízká) Testy výběru URL – doplnil jsem NEZÁVISLÉ string-checky (`game_board`
   vs `right_game_board`, `red.webp`/`red_queen.webp`), aby chytly i záměnu OBSAHU
   konstanty, ne jen záměnu za americkou. Opraveno.

## Co zbývá / na co dát pozor
- Živý vizuální gate (screenshot) jsem kvůli síťové izolaci prohlížeče neudělal – viz
  `verify`. Jádro (parita, zarovnání kamenů na tmavé dřevo, tmavé pole vpravo dole) je
  potvrzené přímým čtením obrázků, ne screenshotem z běžící appky.
- Drobný PvP záblesk (nález 1) je vědomé rozhodnutí, ne opomenutí.

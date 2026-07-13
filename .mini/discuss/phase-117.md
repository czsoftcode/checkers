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

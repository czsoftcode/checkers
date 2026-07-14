# Phase 122 — Italská: kámen na tahu červený

## Intent
Oprava reálného defektu z IT-7 (fáze 117): swap assetů řešil jen kameny NA DESCE (přes `.variant-italian` na `.board`), ale samostatné indikátory strany na tahu (mimo `.board`) zůstaly na natvrdo `black.webp` → u italské černý kámen místo červeného (viz screenshot). Opravit v OBOU režimech. Symetrické s IT-7: vnitřní „black" → red asset.

## Key decisions
- **DVA indikátory, oba stejná vada (potvrzeno čtením kódu):**
  - AIvP: `packages/web/src/app-shell.ts` — `import blackStoneUrl/whiteStoneUrl` (ř.28-29), prvek `.turn-indicator .piece` (ř.325-327), `preloadImages([blackStoneUrl, whiteStoneUrl])` → třída `.turn-indicator--img` (ř.336), `turnPiece.classList.toggle('black'/'white', ...)` (ř.621-622). CSS: `.turn-indicator--img .piece.black { url(black stone) }` (styles.css:539), `.piece.white` (styles.css:543).
  - PvP: `packages/web/src/game-screen.ts` — `import blackStoneUrl/whiteStoneUrl` (ř.48-49), prvek `.pvp-turn-stone` v `.pvp-turn` (ř.263), `preloadImages([blackStoneUrl, whiteStoneUrl])` (ř.299). CSS kolem `.pvp-turn` (styles.css:616-617).
- **Fix = variantně-scoped CSS (jako IT-7), potvrzeno uživatelem:** přidat variantní marker (třída `variant-italian`) na oba indikátory (AIvP z app-shell, PvP z game-screen — obě znají variantu hry) a CSS `.turn-indicator--img.variant-italian .piece.black { url(red stone) }` + obdoba pro `.pvp-turn-stone`. Přes `url()` v styles.css, ŽÁDNÝ inline styl (CSP). Vnitřní „black" → `red.webp` (stejné mapování jako kameny na desce z IT-7); „white" zůstává white.webp. Ostatní varianty (american/pool/russian/czech) indikátor NETKNUTÝ (black).
- **Per-varianta preload:** pro italskou přednačíst `red.webp` (místo black) do `preloadImages` gate `--img` (all-or-nothing fallback musí platit i pro červený set) — konzistentní s IT-7. Jediná drobná plumbing práce (preload set podle varianty).

## Watch out for
- **Ověřit, že nejsou DALŠÍ místa s natvrdo black.webp mimo desku** než tyto dva indikátory (grep zatím: app-shell + game-screen indikátory + piece-images board z IT-7). Objeví-li se třetí, opravit stejně (potvrzeno uživatelem).
- **Kde se bere varianta při renderu indikátoru:** AIvP app-shell zná variantu (zakládá LocalClient s ní); PvP game-screen zná variantu partie. Protáhnout ji na indikátorový prvek jako třídu.
- **CSP:** assety jen přes styles.css `url()` (Vite hash), nikdy inline. Stejný vzor jako `.turn-indicator--img .piece.black` dnes.
- **jsdom (testy):** Image se nenačte → `--img` se nepřidá (fallback); nové testy dělat vzorem stávajících (injektovat createStoneImage / ověřit zapojení třídy+URL, ne reálné načtení). Test: pro italskou jde do preloadu red a indikátor dostane variant-italian třídu; pro ostatní black bez ní.
- **Živá kontrola v prohlížeči (součást brány):** italský indikátor strany na tahu je ČERVENÝ v AIvP i PvP (screenshot); ostatní varianty beze změny.
- **Regrese:** do rules/src se NESAHÁ (perft nedotčen); ostatní varianty vizuálně netknuté; celá suita zelená; tsc čistý.

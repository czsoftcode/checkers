# Phase 26 — Náhodné pozadí hry z obrázků

## Intent
Pozadí **CELÉ STRÁNKY** (za deskou i za panelem), ne pozadí hrací desky. Při každé
nové partii web klient náhodně vybere jeden z obrázků `background_<NN>.webp` z
`packages/web/src/assets/` a zobrazí ho jako pozadí stránky. Počet obrázků se
zjišťuje automaticky přes Vite `import.meta.glob` — přidání dalších `.webp` do
assets nevyžaduje změnu kódu, jen rebuild.

## Key decisions
- **Mechanismus = skrytý `<img>` element na celou obrazovku** (potvrzeno uživatelem).
  `position: fixed`, přes celý viewport, `object-fit: cover`, `z-index` POD obsahem
  (deska + panel navrchu). URL se nastaví přes `img.src = url` — `src` je atribut, ne
  styl → CSP se ho vůbec netýká. NEpoužívat `element.style` ani inline styly (konvence
  projektu, pravidlo uživatele). Umístění/velikost `<img>` řeší třída v `styles.css`.
- **Výčet souborů:** `import.meta.glob('./assets/background_*.webp', { eager: true,
  query: '?url', import: 'default' })`. Vite je v repu **8.1.3** → moderní syntaxe
  `query: '?url', import: 'default'` (NE staré `{ as: 'url' }`). Vrací objekt
  cesta→hashovaná URL (string); hodnoty = pole URL. Ověřit přesné chování proti Vite 8
  (Context7), ať to nespadne tiše na prázdném objektu.
- **Kdy losovat:** ve `startNewGame()` v `app-shell.ts` — jediný trychtýř, volá se při
  mountu (ř. 259) i na tlačítko „Nová hra" (ř. 255-256). Nastavit pozadí HNED (před
  `await client.createGame()`), ať se přehodí okamžitě, ne až po odpovědi serveru.
- **Reload = nové pozadí** — přijato. Mount volá `startNewGame` (= i nová partie na
  serveru), takže reload logicky přelosuje. Žádné úložiště, žádné držení přes reload.
- **Bez ztmavení/tint** — přijato. Obrázky jsou tmavé, panel i deska jsou nad nimi
  čitelné. Žádná overlay vrstva se nepřidává.
- **Testovatelnost:** vytáhnout ČISTOU funkci `pickBackground(urls, rng)` (injektované
  RNG, bez DOM/glob). Test se zuby: vrací prvek seznamu; PRÁZDNÝ seznam → vrací
  null/undefined, NEspadne. Napojení glob + `Math.random` + `img.src` v `app-shell` je
  tenká vrstva nad touto funkcí.

## Watch out for
- **Prázdný glob** (žádný `.webp`) → `pickBackground` vrátí null; `<img>` nenastavovat
  (nebo `src=''`), stránka zůstane na stávajícím barevném pozadí. NIKDY nespadnout.
- **Opakování obrázku** — čistý random může vylosovat stejný obrázek dvakrát po sobě.
  Přijato: uživatel chce „random", ne „vždy jiný".
- **Selhání načtení obrázku** (chybějící/poškozený webp) — s glob eager jsou soubory
  součástí buildu (hashované), takže existují; přesto `<img>` selhání nesmí rozbít
  stránku (fallback = barevné pozadí pod ním).
- **z-index / pointer-events:** `<img>` musí být pod deskou i panelem a nesmí zachytávat
  kliky (`pointer-events: none`), jinak by blokoval interakci s deskou/tlačítky.
- **CSP:** veškeré stylování `<img>` přes třídu v `styles.css`, žádné inline styly ani
  `element.style`.

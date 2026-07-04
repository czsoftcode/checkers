# Phase 26 — Náhodné pozadí hry z obrázků

**Goal:** Web klient při nové hře náhodně vybere jeden z obrázků background_<NN>.webp z packages/web/src/assets (počet zjištěn automaticky přes Vite import.meta.glob, ne natvrdo zadaný) a nastaví ho jako CSS pozadí herní plochy; přidání dalších obrázků nevyžaduje změnu kódu, jen rebuild. Losování proběhne při startu nové hry.

## Steps
- [done] Modul backgrounds.ts: glob výčet + čistá pickBackground (s testem)
- [done] Skrytý <img class=page-bg> + losování ve startNewGame
- [done] CSS .page-bg v styles.css
- [done] Ověření + nezávislý self-review

## Auto-commit
- Phase 26: Náhodné pozadí hry z obrázků

## Discussion
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

## Run report
---
phase: 26
verdict: done
steps:
  - title: "Modul backgrounds.ts: glob výčet + čistá pickBackground (s testem)"
    status: done
  - title: "Skrytý <img class=page-bg> + losování ve startNewGame"
    status: done
  - title: "CSS .page-bg v styles.css"
    status: done
  - title: "Ověření + nezávislý self-review"
    status: done
---

# Phase 26 — report z auto session

## Co se udělalo
- **`packages/web/src/backgrounds.ts`** (nový): `backgroundUrls` z
  `import.meta.glob('./assets/background_*.webp', { eager: true, query: '?url',
  import: 'default' })` (Vite 8 syntaxe ověřena buildem) + čistá
  `pickBackground(urls, rng = Math.random): string | undefined`.
- **`packages/web/test/backgrounds.test.ts`** (nový): deterministický výběr podle
  rng (0 → první, 0.5 → prostřední, 0.99 → poslední), prvek vždy ze seznamu,
  prázdný seznam → `undefined` bez výjimky, hraniční rng=1 → clamp na poslední
  prvek, jednoprvkový seznam.
- **`app-shell.ts`**: přidán skrytý `<img class="page-bg" alt="">` jako dítě `.game`;
  ve `startNewGame()` PŘED `await createGame()` se nastaví `pageBg.src =
  pickBackground(backgroundUrls) ?? ''`. URL přes atribut `src` (ne `element.style`)
  → CSP se ho netýká.
- **`styles.css`**: `.page-bg { position: fixed; inset: 0; width/height: 100%;
  object-fit: cover; z-index: -1; pointer-events: none }`.

## Ověření (mechanicky)
- `pnpm typecheck` ✓ (i s `noUncheckedIndexedAccess`), `pnpm test` ✓ 79/79,
  `pnpm build` ✓ — všech 5 `background_0X.webp` v `dist/assets/` s hashem, URL i
  `.page-bg` reálně v JS/CSS bundlu. Glob tedy vyčetl neprázdno, syntaxe Vite 8 sedí.
- Zuby: bez `Math.min` clampu by test „rng=1" spadl (`urls[3]` → undefined ≠ '/c.webp').

## Nezávislý self-review (čerstvý sub-agent) a co se změnilo
Sub-agent nenašel kritickou/vysokou chybu. Jediný validní bod: původní explicitní
guard `if (urls.length === 0) return null` byl **nadbytečný** — prázdný seznam je
matematicky vždy pokrytý indexací (`Math.min(0, -1) = -1`, `urls[-1] === undefined`),
takže žádný test mu nemohl dát zuby (dead code). Podle projektového pravidla „žádné
mrtvé vrstvy" jsem guard odstranil, typ změnil z `string | null` na `string |
undefined` a spolehl se na clamp + indexaci (s komentářem, proč prázdný seznam vrací
undefined). Volající `?? ''` funguje beze změny.

Potvrzeno bez nálezu: CSP (src, ne inline styl), `.game` nevytváří stacking context
(žádné position/transform/opacity) → z-index: -1 maluje nad `body` pozadím, ne pod
ním; `pointer-events: none` propouští kliky na desku; img je dítě `.game`, uklidí se
s ním.

## Vědomě neřešeno
- **Opakování pozadí** (čistý random může vylosovat stejný obrázek 2× po sobě) —
  uživatel v diskusi explicitně přijal „random, ne vždy jiný". Přidávat „nepřelosuj
  stejný" by byl scope creep + hrana u jednoho obrázku.
- **Prázdný glob v reálném buildu nenastane** (5 souborů v assets je součástí buildu);
  větev `?? ''` je defenzivní pro případ smazání všech obrázků, testovaná jednotkově.

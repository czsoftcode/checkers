---
phase: 76
verdict: done
steps:
  - title: "Pozadí lobby: <img class=page-bg> s intro.webp"
    status: done
  - title: "Test: lobby má img.page-bg s nastaveným src"
    status: done
  - title: "Ověření: build + typecheck + lint + testy"
    status: done
verify:
  - title: "Vzhled a čitelnost lobby nad obrázkem intro.webp v prohlížeči"
    detail: "Testy běží v jsdom (bez layoutu/obrázků). Ověř okem: intro.webp pokrývá celou plochu úvodní obrazovky Herní místnosti, karta s formulářem přezdívky i seznam přítomných zůstávají čitelné (karta má vlastní tmavé pozadí rgba(20,20,20,0.82)). Overlay jsme záměrně nepřidali – posuď, jestli je kontrast dost."
---

# Phase 76 — report z auto session

## Co se udělalo
Úvodní obrazovka Herní místnosti (lobby) dostala `intro.webp` jako celostránkové pozadí. Implementace kopíruje CSP-bezpečný mechanismus herní desky: v `lobby.ts` je `intro.webp` naimportovaný přes Vite `?url` (jako `board-image`) a do kořenového `.lobby` se jako první dítě vkládá skrytý `<img class="page-bg">` s URL nastavenou přes `src` (atribut, ne inline styl). Znovupoužila se existující třída `.page-bg` ze `styles.css` (fixed, inset:0, z-index:-1, object-fit:cover) – žádné nové CSS.

Pozadí je fixní jeden obrázek, ne losované jako u hry – logika z `backgrounds.ts` se vědomě nepřebírá. Žádný ztmavovací overlay (rozhodnutí uživatele: obrázek je dost tmavý a karta místnosti má vlastní tmavé pozadí).

## Ověření
- `pnpm --filter @checkers/web build` prošel: `intro-<hash>.webp` (135 kB) se zabundloval s hashovanou URL, žádná chyba importu.
- `pnpm -r typecheck` zelené (ambientní deklarace pro `*.webp?url` už v repu byla kvůli `board-image`/`piece-images`), `pnpm lint` (eslint) zelené.
- `pnpm --filter @checkers/web test` zelené: 364 testů (+1 nový v `lobby.test.ts` – ověří, že kořen lobby obsahuje `img.page-bg` s neprázdným `src` obsahujícím „intro"; bez přidaného `<img>` test selže).

## Poznámka
Fáze se nedotýká chybových cest, vstupních bodů procesu ani kontraktů mezi moduly – čistě UI přidání jednoho elementu. Dle CLAUDE.md jsem proto NEpouštěl nezávislého adversarial sub-agenta. Jediné, co nejde ověřit mechanicky, je vizuál/čitelnost v reálném prohlížeči (viz `verify`).

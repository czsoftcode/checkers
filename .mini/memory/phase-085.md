# Phase 85 — Favicon.ico funguje i v produkci

**Goal:** Zprovoznit favicon.ico v produkci: soubor je přesunutý do packages/web/public/ (Vite ho z public/ kopíruje do dist/ při buildu), doplnit explicitní <link rel=icon> do <head> index.html a ověřit, že vite build vyprodukuje dist/favicon.ico a produkční cesta (nginx root .../dist, try_files) vrací ikonu, ne SPA fallback index.html. Dev nesmí přestat fungovat. Mimo řez: další formáty ikon (PNG, apple-touch-icon, SVG).

## Steps
- [done] Explicitní <link rel=icon> v index.html
- [done] Build kopíruje favicon do dist
- [done] Zub proti regresi (test)
- [done] Ověření dev + produkční cesty

## Auto-commit
- Phase 85: Favicon.ico funguje i v produkci

## Run report
---
phase: 85
verdict: done
steps:
  - title: "Explicitní <link rel=icon> v index.html"
    status: done
  - title: "Build kopíruje favicon do dist"
    status: done
  - title: "Zub proti regresi (test)"
    status: done
  - title: "Ověření dev + produkční cesty"
    status: done
verify:
  - title: "Favicon na reálné produkci po deployi"
    detail: "Ověřeno mechanicky, že build i statické servírování dist/ vrací ikonu (viz níže). Reálný nginx + deploy.sh na dama.softcode.cz jsem nespouštěl. Po `scripts/deploy.sh` zkontroluj v prohlížeči, že se favicon zobrazí v záložce. POZOR na cache: prohlížeče favicony drží agresivně – pokud uvidíš starou/žádnou, dej tvrdý refresh (Ctrl+F5) nebo otevři /favicon.ico přímo. To není chyba fixu, jen chování prohlížeče."
---

# Phase 85 — report z auto session

## Kořenová příčina (potvrzená)
Favicon fungoval na dev, ne na produkci, protože `favicon.ico` ležel v **kořeni** `packages/web/` (kam `vite build` nesahá – do `dist/` kopíruje jen obsah `public/`). Dev server Vite servíruje kořen balíčku, takže `/favicon.ico` tam vrací ikonu; produkční `dist/` ji ale neobsahoval a nginx `try_files $uri … /index.html` vracel na `/favicon.ico` **SPA fallback index.html** místo ikony.

## Co je hotové
- **Soubor v `public/`** — přesun udělal uživatel; potvrzeno, že kořen už favicon nemá a `public/favicon.ico` existuje.
- **`index.html`** — doplněn explicitní `<link rel="icon" href="/favicon.ico" sizes="any" />`. Absolutní `/favicon.ico` sedí na produkční `base=/` i na dev.
- **Regresní test** (`test/favicon.test.ts`) — hlídá, že (a) `public/favicon.ico` existuje a (b) `index.html` odkazuje `/favicon.ico` přes `<link rel="icon">`. Chrání přesně před tou chybou, co se opravovala.

## Ověření (mechanicky, sám)
- `vite build --base=/` → vznikne `dist/favicon.ico`, **bajtově shodný** s `public/favicon.ico` (`cmp` OK); odkaz `<link rel="icon" href="/favicon.ico">` zůstává i v `dist/index.html`.
- Statické servírování `dist/` (`vite preview`, což odpovídá tomu, co dělá nginx nad `root .../dist`): `GET /favicon.ico` → `HTTP 200`, `Content-Type: image/x-icon`, doručený soubor je reálný ICO (MS Windows icon resource) a bajtově shodný s `public/favicon.ico`. Tedy `try_files` v produkci najde soubor dřív než `/index.html` fallback.
- `519` testů zelených (+2 nové), typecheck i lint čisté.

## Poznámky
- **Rozměr ikony je 32×33 px** (drobně nestandardní výška 33). Je to soubor od uživatele, funkčně to nevadí; jen kdyby se ikona v záložce zobrazovala mírně oříznutá, stojí za to ji přegenerovat na 32×32/16×16.
- **Vědomě mimo řez**: další formáty ikon (PNG, apple-touch-icon, SVG) – fáze řešila jen `.ico`.
- Žádný křižovatkový trade-off k zaznamenání ADR – šlo o přímočarou opravu na správné místo (`public/`) + odkaz.

# Phase 89 — Statický build pro itch

## Intent
Itch build mode = AI-only statická publikace hry proti AI (běží celá v prohlížeči, fáze 88).
Balík `dist/` jako zip s `index.html` v kořeni, nahratelný na itch.io. PvP na itch nefunguje
(server je cross-origin, mrtvý WS) → v itch módu se lobby/room WS NIKDY neotevře; „hrát
s člověkem" místo toho otevře modal s odkazem ven na živé stránky. PvP z itch přijde až #51.

Vstup appky dnes: `main.ts` volá `showLobby()`; lobby `entry` view (formulář přezdívky +
tlačítko „hrát proti počítači") se renderuje BEZ room WS — ten se otevře až odesláním
přezdívky (`join`). To gating usnadňuje: stačí v itch módu upravit `entry` view.

## Key decisions
- **Mechanismus:** `vite build --mode itch` + `import.meta.env.VITE_ITCH` (env-based build flag
  se ve webu ZAVÁDÍ POPRVÉ — dnes se `import.meta.env`/`VITE_` nikde nepoužívá). HLAVNÍ build se
  NEMĚNÍ (base `/`, Plausible zůstává, dnešní chování). Itch build: `base:'./'` + strip Plausible
  + relativní favicon, řešeno v `vite.config.ts` podle módu (např. `transformIndexHtml` plugin).
- **Produkční URL do modalu přes ENV soubor**, ne konstanta: `.env.itch` s `VITE_SITE_URL`
  (teď `dama.softcode.cz`, uživatel ji bude MĚNIT — proto env, ne hardcode). Modal ji použije
  jako odkaz ven.
- **Text modalu přes i18n** (cs/en): nové klíče v `i18n.ts` (vysvětlení „PvP je na plné verzi"
  + popis odkazu). Modal je lokalizovaný jako zbytek UI.
- **Plausible analytics se z itch buildu ODSTRANÍ.** Externí request do vlastního serveru:
  offline nefunguje, sandbox itch ho může blokovat; navíc itch má vlastní měření. Hlavní web
  ho má dál.
- **Tvar vstupu na itch:** v itch módu lobby `entry` view — „hrát proti počítači" zůstává
  funkční (LocalClient z fáze 88), přezdívku/join NAHRADIT tlačítkem „hrát s člověkem" → i18n
  modal s odkazem ven. Room WS se v itch módu nikdy neotevře (žádný `join`, žádná přezdívka).
  NE samostatná nová úvodní obrazovka — surgical úprava existující lobby.

## Watch out for
- **Favicon `/favicon.ico` je ABSOLUTNÍ** (`index.html`, fáze 85) → na itch podcestě
  (`html-classic.itch.zone/html/<id>/`) se rozbije. `base:'./'` musí link přepsat na relativní.
  POZOR: Vite u odkazů na PUBLIC dir asset (`/favicon.ico`) NEmusí base aplikovat automaticky —
  OVĚŘIT ve skutečném `dist/index.html`, že favicon cesta je relativní; případně řešit v
  `transformIndexHtml`.
- **Ověření z PODCESTY, ne z rootu.** `vite preview` servíruje z `/` — to itch nesimuluje.
  Naservírovat `dist/` z vnořeného adresáře (např. `.../html/<id>/`) a otevřít v prohlížeči
  (Chrome jako fáze 88), aby se chytly absolutní cesty. Ověřit: appka se načte, AI hratelná,
  assety (pozadí, zvuky, kameny) + favicon jdou z relativních cest, „hrát s člověkem" → modal
  s odkazem, žádný pokus o room WS (network tab).
- **Zip:** `index.html` MUSÍ být v kořeni zipu (ne ve složce) — itch entry point. Balicí skript
  do `scripts/`.
- **Hlavní build beze změny** — regrese: `pnpm --filter @checkers/web build` (bez `--mode itch`)
  musí dál produkovat dnešní dist (base `/`, Plausible přítomný, favicon absolutní). Ověřit, že
  se itch mód nepropsal do defaultního buildu.
- **Velikost:** assety ~1.7 MB (webp pozadí + mp3 + game_board) — hluboko pod limitem itch,
  jen doložit (ne řešit optimalizaci).
- **Mimo řez:** reálné zprovoznění PvP z cross-origin/CORS/WSS (#51 — nahradí modal skutečným
  připojením), odstranění serverové AI (#52), PWA/service worker (trvalý non-goal).

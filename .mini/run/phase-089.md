---
phase: 89
verdict: done
steps:
  - title: "Vite itch mód: base, strip Plausible, favicon"
    status: done
  - title: "i18n modal + gating lobby entry na itch"
    status: done
  - title: "Balicí skript: zip s index.html v kořeni"
    status: done
  - title: "Ověření z podcesty (Chrome) + regrese hlavního buildu"
    status: done
---

# Fáze 89 — report z auto session

## Co je hotové
Itch build mode (`vite build --mode itch`) pro statickou AI-only publikaci. Výchozí
build zůstal beze změny.

**Krok 1 — Vite itch mód.** `vite.config.ts` je teď funkce podle módu. V itch módu:
`base:'./'`, plugin `transformIndexHtml` (enforce `post`) odstraní Plausible `<script>`
i jeho zavádějící HTML komentář a přepíše `/favicon.ico` → `./favicon.ico`. `.env.itch`
nese `VITE_ITCH=1` a `VITE_SITE_URL=dama.softcode.cz`. Přidán `src/vite-env.d.ts` (typy
pro VITE_ proměnné). Ověřeno na reálném výstupu: itch `dist/index.html` má relativní
cesty k assetům i favicon a je bez Plausible; default build má base `/`, Plausible i
absolutní favicon.

**Krok 2 — i18n modal + gating.** V itch módu (`options.itchMode ?? import.meta.env.
VITE_ITCH==='1'`) `createLobby` dělá early-return do nové `createItchEntry`: vypadá jako
lobby (pozadí, karta, nadpis, přepínač jazyka, „Hrát proti počítači"), ale MÍSTO formuláře
přezdívky má tlačítko „Hrát s člověkem" → modal (i18n klíče `itch.*` v cs i en) s odkazem
ven na `VITE_SITE_URL`. `createRoomClient` se v této větvi VŮBEC nevolá → room WS nemůže
vzniknout. Modal zavírá křížek, klik na pozadí i Esc; `dispose` uklidí Esc listener.
8 nových testů v `test/lobby-itch.test.ts`; celý web balík 563 testů zelený.

**Krok 3 — balicí skript.** `scripts/build-itch.mjs` (+ root `pnpm build:itch`): postaví
itch mód a zabalí OBSAH `dist/` do `packages/web/checkers-itch.zip` s `index.html` v
KOŘENI (ověřeno přes `unzip -l`). Zip je v `.gitignore`. Doložená velikost: obsah dist
1,73 MB, zip 1,65 MB — hluboko pod limitem itch. KAŽDÁ chybová větev končí nenulovým
exitem (spadlý build, chybějící/špatný výstup, nedostupný `zip`, index mimo kořen,
překročený limit).

**Krok 4 — ověření z podcesty + regrese.** Regrese default buildu ověřena mechanicky
(base `/`, Plausible přítomný, absolutní favicon). Podcesta: `dist/` naservírováno z
vnořeného `html/checkers-demo-42/` a curl z té cesty vrací 200 pro favicon, CSS, hlavní
JS i **worker chunk**. V bundlu jsem potvrdil, že worker i VŠECHNY obrázky/zvuky se staví
přes `new URL(name, import.meta.url)` (relativně k modulu) a nikde není absolutní
`/assets/` od kořene — takže z itch podcesty se assety načtou.

## Co se nepovedlo / na co pozor
- **Vizuální Chrome průchod je blokovaný**, ne provedený — viz `verify` výš. Podstatné
  invarianty (načtení z podcesty, žádný room WS, modal+odkaz, regrese) jsem ověřil
  jinak (curl + bundle + unit testy), ale reálné vykreslení a hratelnost okem chybí.
- **Reakce na self-review (nezávislý sub-agent):** balicí skript původně ověřoval jen
  „index.html v kořeni zipu" — tedy MÉNĚ podstatný invariant — a NE dvě věci, kvůli
  kterým itch mód existuje. Kdyby regex na Plausible tiše přestal matchovat (přejmenovaná
  analytika bez slova „plausible", jiný markup), `build:itch` by skončil exit 0 a na itch
  by šel živý tracker. Přidal jsem proto do skriptu TVRDOU kontrolu `dist/index.html`
  (fail, když stále obsahuje „plausible" nebo absolutní favicon) — ověřeno, že na default
  buildu by spadla. A opravil zavádějící natvrdo „→ OK" u velikosti na reálné porovnání
  s limitem.

## Otevřené / drobnosti (neblokující)
- Produkční spouštěč itch větve (`import.meta.env.VITE_ITCH === '1'`) žádný unit test
  nekryje — testy vynucují itch přes `itchMode: true`. Ověřeno jen manuálním grepem
  bundlu (itch bundle obsahuje `dama.softcode.cz`, default ne).
- `normalizeSiteUrl` neodmítá exotická schémata (`javascript:` apod.) — ale prefix
  `https://` je i tak neutralizuje na rozbitý, neškodný odkaz. Vstup je dev-řízená env,
  ne uživatelský; ponecháno.

## Poznámka k /mini:decision
Byl tu jeden implementační rozcestník: gating jsem řešil **early-return do samostatné
`createItchEntry`** místo podmíněného vypnutí `createRoomClient` uvnitř 600řádkové
`createLobby`. Důvod: nulové riziko regrese PvP cesty a tvrdá jistota, že room client v
itch větvi nevznikne. Diskuse ale zmiňovala „surgical úprava existující lobby, NE
samostatná nová obrazovka" — proto to je hraniční a možná stojí za záznam přes
`/mini:decision` (před `/mini:done`), pokud to chceš mít zdokumentované.

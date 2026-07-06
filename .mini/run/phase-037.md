---
phase: 37
verdict: done
steps:
  - title: "Sekce Požadavky a instalace"
    status: done
  - title: "Sekce Vývojové spuštění"
    status: done
  - title: "Sekce Produkční web build"
    status: done
  - title: "Sekce Proměnné prostředí"
    status: done
  - title: "Sekce Testy a kontroly"
    status: done
  - title: "Ověřit všechny příkazy na čistém stavu"
    status: done
verify:
  - title: "Nesoulad nápovědy CLI (mimo README, mimo rozsah fáze)"
    detail: "Interní USAGE text v packages/cli/src/main.ts radí `start -- [volby]` (s dvojitým `--`), ale přes pnpm to spadne (parseArgs strict odmítne `--` jako positional). Funguje jen BEZ `--`. README je opravené správně, ale nápověda v kódu CLI si s ním protiřečí. Oprava USAGE textu je mimo rozsah fáze 37 – kandidát na samostatnou drobnou fázi / todo."
---

# Phase 37 — report z auto session

## Kontext: co bylo hotové před touto session
Uživateli spadl terminál během předchozí rozpracované session. Kořenový `README.md` už
existoval (netrackovaný) a byl obsahově napsaný celý – všech pět plánovaných sekcí.
Chyběl ale poslední krok: **reálné ověření příkazů** a report. Session tedy dělala hlavně
verifikaci, ne psaní od nuly.

## Co jsem ověřil a jak

**Tvrzení proti zdroji (statická kontrola):** Node 24 (`.nvmrc`, `engines`), pnpm 10.33.0
(`packageManager`), názvy `--filter` balíčků a skriptů, `DEFAULT_PORT=3000`,
`DEFAULT_ENGINE_TIME_MS=1000`, `CHECKERS_PDN_DIR` default `.pdn/` v rootu (kotveno na
`../../..` od `main.ts`, ne na cwd), proxy `/games` v `vite.config.ts`. Vše sedělo.

**Reálný běh (mechanická kontrola – dělám sám, nedávám do `verify`):**
- `pnpm install` → projde (pnpm 10.33.0, „Already up to date").
- `pnpm --filter @checkers/web build` → exit 0, `dist/` s `index.html` + assets.
- `pnpm test` → exit 0 (cli 24, web 132, engine 250, server 105 testů, vše zelené).
- `pnpm lint` → exit 0. `pnpm typecheck` → exit 0 (5 balíčků).
- Server start → engine warmup OK, naslouchá na `127.0.0.1:3000`, `POST /games` → HTTP 201.
- Web dev → `vite` na `[::1]:5173`; `POST /games` přes :5173 → HTTP 201 (proxy na server funguje).

## Dva faktické nálezy – README lhalo, opraveno

Krok „ověřit na čistém stavu" chytil **dvě nepravdivá tvrzení**, přesně to, co má:

**1. Produkční web build – `vite preview` a proxy.** README tvrdilo, že „`vite preview`
neproxuje API" a „volání `/games` skončí chybou/404". **Realita je opačná:** preview na
:4173 vrátil na `POST /games` HTTP 201 s reálnou hrou. Po zabití serveru vrátil **502**
(ne 404 statiky) → tzn. preview `/games` **proxuje**. Ověřeno i proti zdroji Vite 8
(`resolvePreviewOptions`: `proxy: preview?.proxy ?? server.proxy` – preview dědí
`server.proxy`). Sekci jsem přepsal pravdivě: preview proxy dědí, s běžícím serverem hra
přes náhled funguje, bez serveru vrací 502. Pointa „hotová produkční verze v repu není"
zůstává, ale opřená o pravdivé důvody (server bez prod buildu = tsx; preview není
produkční web server).

**2. Hra v terminálu (CLI) – „člověk proti enginu".** Nepravda na dvou úrovních:
`cli/package.json` závisí **jen na `@checkers/rules`** (žádný engine), výchozí příkaz je
`runRandomVsRandom` (random vs random self-play), a `--mode human` je `runHumanVsRandom`
(člověk proti **náhodnému** hráči, ne enginu). Navíc předání voleb přes `pnpm ... start
-- --mode human` **spadne** (pnpm propustí `--` a `parseArgs` strict ho odmítne) –
funkční je jen bez `--`. Sekci jsem přepsal pravdivě a s ověřenou syntaxí voleb.
Poznámka: tato CLI sekce nebyla v plánu fáze 37 (plán = server + web); přidal ji do
README někdo dřív. Rozhodl jsem se ji **ponechat opravenou** (příkazy reálně existují a
fungují), ne smazat.

## Úklid
Všechny testovací procesy (server, web dev, preview, engine podproces) zabity, porty
3000/4173/5173 volné. Nedohrané testovací hry se do `.pdn/` nezapsaly (archivují se jen
dokončené partie) – žádný binec.

## Otevřená otázka pro člověka
Nápověda `USAGE` uvnitř `packages/cli/src/main.ts` radí syntaxi s `--`, která přes pnpm
nefunguje – rozpor s realitou i s opraveným README. Není to chyba README ani rozsah
fáze 37; hodí se jako drobný todo (viz `verify`).

## Poznámka k rozhodnutím
Byl tu jeden reálný křižovatkový moment (CLI sekce: opravit vs. smazat mimo rozsah).
Nešlo o architektonické rozhodnutí, spíš o dokumentační volbu – ADR asi netřeba, ale
pokud to chceš zaznamenat, spusť `/mini:decision` před `/mini:done`.

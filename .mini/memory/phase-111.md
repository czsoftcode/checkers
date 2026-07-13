# Phase 111 — Italská: Ruleset a registr

**Goal:** Rozšířit interface Ruleset (packages/rules/src/ruleset.ts) o pole mustCaptureMaximum (bool), capturePriority (enum none|kingQuality|italianFull) a manCannotCaptureKing (bool) + doplnit defaulty (mustCaptureMaximum=false, capturePriority=none, manCannotCaptureKing=false) do AMERICAN/POOL/RUSSIAN/CZECH rulesetů. Českou NEMIGROVAT - ponechat její stávající boolean kingCapturePriority beze změny (dočasná duplicita dvou mechanismů priority je na dev přijatelná). Přidat italian do VariantId/VARIANT_IDS/REGISTRY + nový ITALIAN_RULESET (manCaptureBackward=false, king=short, promoteMidCapture=false, mustCaptureMaximum=true, capturePriority=italianFull, manCannotCaptureKing=true). BEZ jakékoli nové logiky v legalMoves - jen deklarace polí a registrace; italská ještě NENÍ v lobby. Brána: perft 1-6 americké/pool/ruské/české beze změny čísel (žádná varianta se nedotýká); všechny stávající testy zelené; isVariantId('italian')=true; rulesetForVariant('italian') vrací ITALIAN_RULESET.

## Steps
- [done] Rozšířit Ruleset interface + ITALIAN_RULESET
- [done] Zaregistrovat italian mimo nabídku
- [done] Testy: italian známá, ale mimo nabídku
- [done] Brána: tsc + perft + celá suita

## Auto-commit
- Phase 111: Italská: Ruleset a registr

## Discussion
# Phase 111 — Italská: Ruleset a registr

## Intent
Připravit datový základ italské varianty: rozšířit `interface Ruleset` (packages/rules/src/ruleset.ts) o tři nová pole a zaregistrovat `italian`, ale BEZ jakékoli nové logiky v `legalMoves` a BEZ zpřístupnění v lobby. Vlastní pravidla (generační omezení, maximum, FID priorita, perft) přijdou v navazujících fázích IT-2 až IT-5. Tato fáze musí prokázat, že rozšíření nezmění chování stávajících variant.

Nová pole (povinná, ne volitelná — TS pak vynutí doplnění defaultů do všech literálů):
- `mustCaptureMaximum: boolean` (kvantita)
- `capturePriority: 'none' | 'italianFull'` (enum OSEKANÝ — `'kingQuality'` se ZÁMĚRNĚ nepřidává, nikdo ho nepoužije: česká zůstává na svém boolean `kingCapturePriority`, italská jede přes `'italianFull'`)
- `manCannotCaptureKing: boolean`

Defaulty do existujících konstant: `mustCaptureMaximum=false, capturePriority='none', manCannotCaptureKing=false` do AMERICAN/POOL/RUSSIAN/CZECH. Česká se NEMIGRUJE — `kingCapturePriority: true` zůstává beze změny (dočasná duplicita dvou mechanismů priority je na dev přijatelná).

`ITALIAN_RULESET`: `manCaptureBackward=false, king='short', promoteMidCapture=false, mustCaptureMaximum=true, capturePriority='italianFull', manCannotCaptureKing=true`.

## Key decisions
- **Rozhodnutí A (zvoleno): italskou zaregistrovat SPÍCÍ.** Přidat `'italian'` do `VariantId` typu a do `REGISTRY`, ALE NE do `VARIANT_IDS`. Důvod: `isVariantId` i `rulesetForVariant` čtou `REGISTRY` (hasOwnProperty), takže `isVariantId('italian')=true` a `rulesetForVariant('italian')=ITALIAN_RULESET` fungují; `VARIANT_IDS` naopak řídí NABÍDKU (web lobby AIvP picker + PvP accordion + server presence zakládá PvP místnost na variantu), takže ponecháním mimo `VARIANT_IDS` se italská NEobjeví v UI ani nevznikne PvP místnost. Tím je splněno „zná se, ale není v lobby".
- Přijatá cena rozhodnutí A: `rulesetForVariant('italian')` vrací ruleset, jehož vlajky maximum/priorita `legalMoves` po 3 fáze IGNORUJE (spící, zatím nevynucený ruleset). Akceptováno, protože k němu NEVEDE žádná dosažitelná cesta (lobby ne, PvP místnost ne, žádný test iterující `VARIANT_IDS`), takže nemůže tiše rozehrát rozbitou partii.
- Nová pole jsou POVINNÁ (readonly, ne optional) — kompilátor vynutí doplnění všech literálů, žádný tichý default. Blast radius potvrzen grepem: `Ruleset` literál se v celém repu staví JEN na 4 místech v ruleset.ts (žádné ad-hoc literály/spready jinde), takže povinná pole = malý hlídaný zásah.

## Watch out for
- **NEPŘIDÁVAT `'italian'` do `VARIANT_IDS`** — to je past v původním znění cíle. `VARIANT_IDS` = nabídka (lobby web + PvP místnosti server presence.ts:336/490 + web lobby.ts:95/776). Přidání by italskou hned zpřístupnilo jako rozbitou.
- **`variant.test.ts` rozdělit kontrakt „známé vs nabízené".** Řádek 46-47 dnes tvrdí „VARIANT_IDS pokrývá právě známá id (nic navíc)". Po zápisu italské do REGISTRY je known ⊋ offered. Upravit: `VARIANT_IDS` = nabízené (stále ty 4), plus test že italská je ZNÁMÁ (`isVariantId('italian')=true`, `rulesetForVariant('italian')=ITALIAN_RULESET`), ale úmyslně NENÍ ve `VARIANT_IDS`. Pozor i na per-variant shape-loop (řádky ~38-43) a `i18n-variant.test.ts` (iteruje VARIANT_IDS a čeká label pro každou) — pokud iterují VARIANT_IDS, italská tam nebude, což je OK a nesmí je rozbít.
- **Přepsat zavádějící doc-komentář ruleset.ts:4-8.** Dnes říká, že maximum „záměrně chybí, dolije se až u mezinárodní dámy" a „nové pole se přidává teprve, až ho čte kód". Obojí touto fází přestává platit (pole vědomě předbíhají svého čtenáře v legalMoves, ten přijde v IT-2..IT-5). Bez přepsání komentář lže.
- **Brána = perft 1-6 americké/pool/ruské/české BEZE ZMĚNY čísel + celá suita zelená + `tsc` čistý.** Perft je pojistka proti překlepu v defaultu (např. omylem `true`). Žádná varianta se nesmí chováním pohnout — tahle fáze nesahá na `legalMoves`.
- **Enum: jen `'none' | 'italianFull'`** — `'kingQuality'` nepřidávat (mrtvá hodnota, viz Intent).

## Run report
---
phase: 111
verdict: done
steps:
  - title: "Rozšířit Ruleset interface + ITALIAN_RULESET"
    status: done
  - title: "Zaregistrovat italian mimo nabídku"
    status: done
  - title: "Testy: italian známá, ale mimo nabídku"
    status: done
  - title: "Brána: tsc + perft + celá suita"
    status: done
---

# Phase 111 — report z auto session

## Co se udělalo
- **`ruleset.ts`**: do `interface Ruleset` přidána 3 povinná readonly pole
  (`mustCaptureMaximum: boolean`, `capturePriority: 'none' | 'italianFull'`,
  `manCannotCaptureKing: boolean`). Enum je osekaný — `'kingQuality'` NENÍ.
  Defaulty (`false`/`'none'`/`false`) doplněny do AMERICAN/POOL/RUSSIAN/CZECH
  (česká `kingCapturePriority: true` beze změny). Nová konstanta
  `ITALIAN_RULESET` (short king, muž jen vpřed, `mustCaptureMaximum: true`,
  `capturePriority: 'italianFull'`, `manCannotCaptureKing: true`). Zavádějící
  doc-komentář ř.4-8 přepsán (dřív tvrdil, že pole se přidá teprve až ho čte kód
  — teď pole vědomě předbíhají čtenáře v legalMoves, ten přijde v IT-2..IT-5).
  `ITALIAN_RULESET` exportován z `index.ts`.
- **`variant.ts`**: `'italian'` přidáno do typu `VariantId` a do `REGISTRY`
  (→ `ITALIAN_RULESET`). `VARIANT_IDS` ZŮSTÁVÁ na 4 (nabídka lobby), doc-komentář
  přeformulován z „všechna známá id" na „nabízené v lobby (podmnožina známých)".
- **Testy** `variant.test.ts`: `'italian'→ITALIAN_RULESET` v cases (kontrola i 3
  nových polí = zuby na mapování). Test ř.46 rozdělen na kontrakt known ⊋ offered:
  `VARIANT_IDS` = přesně 4 a NEobsahuje `'italian'`; nový test, že
  `isVariantId('italian')===true` a `rulesetForVariant('italian')===ITALIAN_RULESET`.

## Nečekaný širší dopad (diskuze ho podcenila)
Rozhodnutí A v diskuzi tvrdilo, že `Ruleset` literál se v repu staví jen na 4
místech v `ruleset.ts` — ten grep ale vynechal **test soubory** a **další
`Record<VariantId>` mapy**. Rozšíření o povinná pole + `italian` do `VariantId`
proto shodilo typecheck na:
- 6 ad-hoc `Ruleset` literálů v testech pravidel (flying-apply, flying-capture,
  flying-notation ×2, flying-simple-moves, ruleset-seam) → doplněny 3 defaulty.
  `czech-king-priority.test.ts` používá spread `...CZECH_RULESET`, ten byl OK.
- `server/src/archive.ts` `EVENT_NAME: Record<VariantId, string>` → přidán
  `italian: 'Italian Draughts'`.
- `web/src/i18n.ts` `VARIANT_LABEL_KEYS: Record<VariantId, MessageKey>` → přidán
  klíč `italian: 'variant.italian'` + samotný překlad do cs (`Italská dáma`)
  i en (`Italian checkers`).

Obě mapy mají v repu záměrný kontrakt „úplná mapa přes VariantId = přidání
varianty bez záznamu je chyba překladu". Zvolil jsem je **doplnit** (ctít
kontrakt), ne oslabovat typ. Přidané labely/názvy nic nerenderuje, protože
italian není ve `VARIANT_IDS` — jen splňují typovou úplnost. Nešlo o reálný
crossroads, ADR nevidím jako potřebný.

## Brána
- `pnpm -r typecheck`: čistý (všech 6 balíčků).
- `pnpm -r test`: vše zelené — rules 384, engine 268, web 629, server 199,
  ai 57, cli 24.
- Perft 1-6 (american 7/49/302/1469/7361/36768, pool, russian, czech): čísla
  jsou hardcoded v `perft*.test.ts` a prošly beze změny — žádná varianta se
  chováním nepohnula (fáze nesahá na `legalMoves`).
- `isVariantId('italian')===true` a `rulesetForVariant('italian')===ITALIAN_RULESET`
  ověřeno novými testy; `[...VARIANT_IDS]` stále 4.

Vše ověřeno mechanicky, pro člověka nic k vizuální kontrole nezbývá.

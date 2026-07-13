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

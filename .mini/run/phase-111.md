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

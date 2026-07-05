---
phase: 31
verdict: done
steps:
  - title: "Rozšířit pickBackground o vyloučení aktuálního pozadí"
    status: done
  - title: "app-shell pamatuje a předává předchozí URL"
    status: done
  - title: "Testy vyloučení a fallbacků"
    status: done
  - title: "Self-review nezávislým sub-agentem + CHANGELOG"
    status: done
verify:
  - title: "Klikni 2× za sebou na „Nová hra" a sleduj, že se pozadí opravdu vždy přehodí"
    detail: "Automatizovaně ověřeno jen v čisté funkci pickBackground (unit testy). Vizuální reálné přepnutí v prohlížeči + kontrakt app-shell↔pickBackground žádný test nehlídá (viz slabina níže). Předpoklad: v assets/ jsou aspoň 2 obrázky."
---

# Phase 31 — report z auto session

## Co se udělalo
- `packages/web/src/backgrounds.ts`: `pickBackground` dostal třetí volitelný parametr `exclude`. Odfiltruje se z výběru, losuje se jen ze zbytku, distribuce jde přes `pool.length` (ne původní délku). Fallback: prázdný pool (jediný obrázek == exclude) → zpět na plný `urls`; prázdný seznam → `undefined` v obou větvích. Zpětně kompatibilní — stávající volání beze změny.
- `packages/web/src/app-shell.ts`: closure proměnná `lastBg` drží přesně návratovou hodnotu `pickBackground` (jednu z `backgroundUrls`), ne `pageBg.src`. Předává se jako `exclude`; `lastBg` se přepíše jen když výběr vrátí URL (prázdný výčet ho nechá být).
- `packages/web/test/backgrounds.test.ts`: 7 nových testů (exclude se nikdy nevrátí napříč indexy rng; distribuce přes pool.length; jediný obrázek == exclude → fallback; zastaralý exclude mimo seznam; exclude undefined = beze změny; prázdný seznam s exclude → undefined).
- `CHANGELOG.md`: záznam pod [Unreleased] / Changed.

## Ověřeno mechanicky
- `pnpm --filter @checkers/web test`: 125 testů zelených (14 souborů).
- Zuby testů: po dočasném vypnutí filtru `exclude` padly přesně 2 relevantní testy; po obnovení zase projdou.
- `tsc --noEmit` na balíčku web: bez chyb.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Prošel všech 7 kontrolních bodů unhappy path + kontrakt mezi moduly. Žádná běhová chyba. Ověřil i past s absolutní URL (bod 3): `lastBg` bere hodnotu z `backgroundUrls`, ne z `pageBg.src`, takže vyloučení tiše neselhává.

## Známá slabina (vědomě neřešená v této fázi)
Kontrakt `app-shell` ↔ `pickBackground` je chráněný jen komentářem, ne testem. Kdyby to někdo v budoucnu „zjednodušil" na `lastBg = pageBg.src`, prohlížeč z toho udělá absolutní URL, ta se nikdy nerovná relativní Vite URL v `backgroundUrls`, filtr nic nevyřadí a vyloučení tiše přestane fungovat — bez pádu, bez varování. Integrační test jsem nepřidal záměrně: `backgroundUrls` se odvozuje z `import.meta.glob` (module-level konstanta), takže by se musel mockovat a test by ověřoval mock místo reálného kontraktu (přesně to, před čím varuje projektový checklist, bod 4). Trade-off: jediná pojistka proti tiché regresi je teď lidská paměť na komentář `app-shell.ts:114-117`. Kandidát na budoucí refaktor: zpřístupnit výběr pozadí injektovatelně, aby šel otestovat i integračně bez mocku.

## Drobnost mimo rozsah fáze
`pageBg.src = ''` u prázdného seznamu (pre-existing z fáze 26) může v některých prohlížečích vyvolat „broken image" request. Fáze 31 se toho nedotkla, není to nález této revize.

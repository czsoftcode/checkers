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

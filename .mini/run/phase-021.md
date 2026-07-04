---
phase: 21
verdict: done
steps:
  - title: "Prefix-aware model výběru (čistá logika + testy)"
    status: done
  - title: "Zvýraznění cesty: RenderState + board-view + CSS"
    status: done
  - title: "Controller: stav předpony + provedení tahu (hot-seat)"
    status: done
  - title: "Sebekontrola unhappy path + nezávislý self-review"
    status: done
verify:
  - title: "Ruční proklik vícenásobného skoku a větvení v prohlížeči"
    detail: "Testy ověřují DOM přes jsdom (třídy, provedení tahu, proměna), ale ne skutečný vizuální dojem. Doporučuji `pnpm --filter @checkers/web dev` a naklikat: dvojskok, větvení (dáma se dvěma pokračováními ze stejného mezidopadu), zrušení uprostřed sekvence. Sleduj, zda je zvýraznění cesty (třída .path) čitelné a zda hot-seat (hraje strana na tahu) nemate."
  - title: "UX kruhového skoku dámy zpět přes výchozí pole"
    detail: "Když je výchozí pole samo legálním pokračováním skoku (dáma se vrací), klik na něj sekvenci prodlouží (správně), takže v tom stavu nejde zrušit výběr klikem na origin – jen klikem jinam. Nezávislý recenzent to označil za korektní chování, ale stojí za oťukání živého pocitu."
---

# Phase 21 — report z auto session

## Co je hotové
UI vícenásobného skoku je funkční a napojené na `rules` jako jediný zdroj pravdy.

- **`selection.ts`** – přibyly čisté funkce:
  - `nextTargets(position, from, prefix)` – další možná pole dopadu po naklikané předponě (index `path[prefix.length]` matching tahů); prázdná předpona = první dopady.
  - `resolveMove(position, from, prefix)` – kompletní `Move`, právě když se předpona rovná `path` jednoho legálního tahu, jinak `null`.
  - `targetsFor` zůstal jako tenká obálka nad `nextTargets(…, [])` (staré testy dál platí).
- **`board-view.ts`** – `RenderState` rozšířen o `path` (naklikané mezidopady); `update` přepíná novou třídu `.path` vedle `selected`/`target`.
- **`styles.css`** – třída `.square.path` (plné podbarvení). Vědomě `.square.path`, ne `.path`, kvůli specificitě vůči `.square.dark`. Bez inline stylů/scriptů (CSP).
- **`controller.ts`** – přepsán z jednoho `selected` na stav `{ from, path }`; `position` je nyní `let` a po dokončení tahu se přes `applyMove` mění (hot-seat – po tahu je na tahu druhá barva). Klik na další dopad prodlouží sekvenci; když z předpony nevede další dopad, tah se provede; klik mimo/na cizí/na výchozí kámen = úplný reset.

## Testy (mají zuby, běží proti reálnému rules)
- `selection.test.ts`: +12 testů – multi-skok, větvení se sdíleným prefixem (dáma 1 → 10 → {3, 17}), předpona bez pokračování, dokončení tahu vč. správných `captures`.
- `board-view.test.ts`: +7 DOM testů – zvýraznění cesty, provedení dvojskoku (kámen dorazí, oběti zmizí, žádná zbytková třída), větvení nespadne do první větve, proměna na dámu se vykreslí jako king, zablokovaný kámen se dá vybrat bez cílů a bez pádu, zrušení uprostřed sekvence.
- Celé repo zelené: web 34, cli 24, engine 213, server 39. Typecheck i ESLint čisté.

## Nezávislý self-review (čerstvý kontext)
Sub-agent potvrdil všechny tři invarianty a nenašel blocker ani důležitou díru:
1. Detekce dokončení je těsná – v americké dámě je každý skokový řetězec maximální, takže žádná `path` není vlastní předponou jiné a `path` jednoznačně určuje `captures` (dva tahy se stejnou path a různým braním nemohou vzniknout). `resolveMove` se nemá čím splést.
2. Interakce nezamrzne – z každého stavu vede klik ven.
3. Číselná past ošetřena – `dataset.square` nese jen `String(1..32)`, NaN/float z DOM nevznikne; `selectableAt` navíc odmítá neceločíselná pole.

Nedosažitelná `resolveMove === null` větev v controlleru má obrannou pojistku (`selection = null`), takže ani teoretický rozpor nezpůsobí zámrz.

## Vědomě mimo rozsah (do dalších fází)
- **Bez serveru/enginu** – todo 20 (optimistický tah + resync). Hot-seat je záměrný placeholder; `position` jako `let` se v todo 20 pravděpodobně změní na stav řízený serverem (část controlleru se přepíše).
- **Výběr kamene bez legálního tahu** je povolen (zobrazí `selected` bez cílů) – drobná UX nejednoznačnost, ne bug.
- **Controller důvěřuje vstupní `Position`** (vždy `initialPosition()`); validace tvaru desky je relevantní až s enginem/serverem.

## Rozhodnutí k zaznamenání
Žádné zásadní rozcestí, které by nebylo zřejmé z kódu – ADR (`/mini:decision`) nepovažuji za nutné. Volby chování (kámen zůstane na startu, klik na každý dopad, hot-seat, jen úplný reset) jsou zapsané v `.mini/discuss/phase-021.md`.

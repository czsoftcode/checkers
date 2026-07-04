# Phase 21 — UI vícenásobného skoku

**Goal:** Hráč postupným klikáním dopadů složí i vícenásobný skok včetně volby větve (když z jednoho mezidopadu vede víc pokračování), interakce nikdy nezamrzne a po dokončení sekvence se tah lokálně provede přes applyMove z rules a deska se překreslí. Model výběru drží rozpracovanou předponu path a filtruje legální tahy z legalMoves na ty, jejichž path začíná naklikanou předponou; zvýrazní další možné dopady. Klient nikdy sám nerozhoduje o legalitě – jediným zdrojem je rules. Bez serveru (to řeší todo 20), bez inline stylů/scriptů kvůli CSP. Brána: hráč zadá multi-skok i větvení bez zaseknutí a deska po tahu odpovídá nové pozici.

## Steps
- [done] Prefix-aware model výběru (čistá logika + testy)
- [done] Zvýraznění cesty: RenderState + board-view + CSS
- [done] Controller: stav předpony + provedení tahu (hot-seat)
- [done] Sebekontrola unhappy path + nezávislý self-review

## Auto-commit
- Phase 21: UI vícenásobného skoku

## Discussion
# Phase 21 — UI vícenásobného skoku

## Intent
Rozšířit klientskou desku tak, aby hráč postupným klikáním doklikal celý
vícenásobný skok, zvolil větev (když z mezidopadu vede víc pokračování), a po
dokončení sekvence se tah lokálně provede přes `applyMove` z rules a deska se
překreslí. Prostý tah (path délky 1) vypadne ze stejného mechanismu.

Dnešní stav: `selection.targetsFor` vrací jen první dopad (`path[0]`) každého
tahu; `controller` drží jen jeden `selected: Square` a neměnnou `position`.
Doklikávání sekvence bylo výslovně odloženo sem (komentář v selection.ts).

Rozsah je čistě klientský: bez serveru a bez enginu (to je todo 20).

## Key decisions
Uživatel na dotazy během diskuse neodpověděl (byl pryč od klávesnice). Zvoleny
bezpečnější/jednodušší varianty jako výchozí směr — u `plan`/`do` je lze změnit,
pokud si je uživatel rozmyslí:

1. **Zpětná vazba během skoku:** kámen zůstane vizuálně na výchozím poli; zvýrazní
   se dosavadní cesta (mezidopady) + další možné dopady. Nic se neaplikuje ani
   nemaže z desky, dokud není tah kompletní. Drží invariant „jediný zdroj pravdy
   = rules" a nevzniká riziko, že by render duplikoval logiku braní.
2. **Vynucený jediný dopad:** klik na každý dopad zvlášť, i když je jen jedna
   možnost. Deska se nikdy nehýbe sama; předvídatelné.
3. **Po dokončení tahu:** hot-seat — `applyMove` otočí tah na druhou barvu a
   `selectableAt` pak pustí jen její kameny, takže hráč klika za obě strany.
   Vědomý placeholder do todo 20 (napojení enginu/serveru). Umožní protáhnout
   víc tahů za sebou a otestovat řetězení už teď.
4. **Zrušení rozpracovaného skoku:** jen úplný reset (klik na vybraný kámen nebo
   mimo zvýrazněná pole zahodí celou předponu). Žádný krok zpět po jednom dopadu.

## Watch out for
- **Detekce dokončení patří rules, ne klientu.** V americké dámě je každý skokový
  řetězec maximální (musí se skákat, dokud lze). Klient NESMÍ sám počítat „už
  není kam skočit" — jen filtruje výstup `legalMoves` na tahy, jejichž `path`
  začíná naklikanou předponou. Dokončení = předpona se rovná `path` právě jednoho
  z těch tahů. Zdroj legality zůstává výhradně rules.
- **Model výběru = předpona cesty, ne jeden Square.** `controller` musí přejít z
  `selected: Square | null` na stav (from + naklikaná předpona landing polí).
  `position` už nesmí být `const` — po tahu se mění (`let position`).
- **Nová funkce místo/vedle `targetsFor`:** potřeba je „další dopady pro danou
  předponu" = pro každý matching move square na indexu `path[prefix.length]`.
  Zvážit nahrazení `targetsFor` obecnější variantou (prázdná předpona = dnešní
  chování prvních dopadů), ať se logika nedělí na dvě.
- **Větvení se stejným prvním dopadem:** dva různé maximální tahy mohou sdílet
  prefix a rozejít se později — model musí nabízet oba směry na dalším kroku, ne
  spadnout do prvního. Klíčovat na Move objekty z legalMoves, ne rekonstruovat
  path/captures na klientu.
- **Konec hry / terminální pozice po tahu** (žádné legalMoves pro stranu na tahu)
  je mimo rozsah — deska prostě nepustí žádný výběr. Zobrazení výsledku řeší
  todo 20. Neošetřovat tady, jen se kvůli tomu nezaseknout (deska nesmí spadnout).
- **Bez inline stylů/scriptů (CSP):** nové zvýraznění (cesta, dopady) přes CSS
  třídy ve styles.css, ne inline. board-view už používá classList (`selected`,
  `target`) — přidat třídu pro „cestu skoku".
- **Unhappy path k pokrytí:** klik mimo zvýrazněná pole uprostřed sekvence, klik
  na kámen soupeře, opakovaný klik na vybraný kámen, dokončení skoku s proměnou
  (applyMove řeší proměnu i render kingů — jen ověřit, že překreslení sedí).

## Run report
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

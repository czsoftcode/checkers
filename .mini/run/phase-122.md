---
phase: 122
verdict: done
steps:
  - title: "Ověřit úplnost + opravit AIvP indikátor"
    status: done
  - title: "Opravit PvP indikátor"
    status: done
  - title: "Testy výběru assetu podle varianty"
    status: done
  - title: "Živá kontrola + brána"
    status: done
---

# Phase 122 — report z auto session

## Co bylo cílem
Indikátor strany na tahu (samostatný kámen na boku desky, MIMO desku) bral pro „černou"
stranu natvrdo `black.webp` bez ohledu na variantu → u italské svítil ČERNÝ kámen místo
červeného. IT-7 (fáze 117) swapla assety jen kamenů NA DESCE (`.board.variant-italian`),
tenhle indikátor minula. Opraveno symetricky s IT-7 v obou režimech.

## Co jsem udělal
- **Úplnost potvrzena:** grep přes web zdroj – mimo desku jsou přesně DVA indikátory
  s natvrdo `black.webp`: `.turn-indicator` (app-shell, AIvP) a `.pvp-turn` (game-screen,
  PvP). Žádné třetí místo. Kameny na desce už řeší IT-7.
- **AIvP (`app-shell.ts`):** varianta je známá hned při stavbě skořápky (`options.variant`).
  Pro italskou přidávám na indikátor marker `variant-italian` a do `preloadImages` jde
  `red.webp` místo `black.webp` (all-or-nothing gate `--img` tak platí i pro červený set).
- **PvP (`game-screen.ts`):** varianta chodí AŽ z autoritativního `game.variant` (první
  push serveru), ne při stavbě obrazovky. Proto jsem přednačtení kamenů přesunul z
  konstrukce do funkce `initTurnStones(variant)`, která běží JEDNOU s prvním stavem se
  ZNÁMOU variantou a podle ní vybere red/black set + přidá marker. Dokud varianta chybí
  (`undefined`), rozhodnutí ODLOŽÍ (viz self-review níž) – nezamkne špatný set.
- **CSS (`styles.css`, přes `url()`, žádný inline styl → CSP):** přidána dvě pravidla –
  `.turn-indicator--img.variant-italian .piece.black { url(red.webp) }` a
  `.pvp-turn--img.variant-italian .pvp-turn-stone.black { url(red.webp) }`. „white" zůstává
  sdílený. Ostatní varianty marker nemají → černý kámen beze změny.
- **Testy:** pro OBA indikátory přidán pár testů (italská vs. ne-italská) s „recording"
  Image factory, která zaznamená reálně přednačtené URL a porovná je proti importovaným
  `?url` konstantám (kontrakt mezi moduly, ne natvrdo zadaná kopie). Dva stávající PvP
  webp testy jsem musel upravit: preload nově startuje až s prvním stavem, takže do nich
  přibyl push `game-state` před `flush()`.

## Zub testů (self-check #3)
Ověřeno: dočasně jsem v `app-shell.ts` přehodil italský set na black → italský test padl
(`loaded` neobsahoval redStoneUrl, obsahoval blackStoneUrl). Po obnovení zelený. Test tedy
testuje reálný výběr assetu, ne mock.

## Nezávislý self-review (projekt CLAUDE.md – kontrakt mezi moduly + vstup PvP stavu)
Pustil jsem čerstvého sub-agenta na diff. Našel JEDNU reálnou slabinu, kterou jsem opravil:
- **PvP once-guard se zamykal už na PRVNÍM stavu bez ohledu na známost varianty.** Deska
  (`pvp-controller.applyState`) i label varianty se přepočítávají KAŽDÝM stavem, ale
  indikátor jen jednou → pořadí stavů `undefined` → `italian` by nechalo indikátor navždy
  ČERNÝ (přesně vada, kterou fáze opravuje). Oprava: guard `stonePreloadStarted || variant
  === undefined` – rozhodnutí se odloží, dokud varianta nedorazí; když ji server nikdy
  nepošle, indikátor degraduje na CSS kolečko (shodně s labelem). Přidán test na tuhle
  unhappy path (undefined první → italská druhá → červený), ověřen zub (oslabení guardu →
  test padne). Zbytek diffu (specificita CSS, regrese variant, bílá strana, dispose, zuby
  testů) reviewer prověřil bez nálezu.

## Brána (mechanická část splněna)
- Celá suita zelená: rules 435, cli 24, engine 273, ai 57, server 216, web 674.
- `tsc --noEmit` čistý přes všechny balíčky (rules, engine, cli, ai, server, web).
- `packages/rules/src` NETKNUTÝ (git diff prázdný) → perft nedotčen.

## Co se nepovedlo / otevřené
- **Živý screenshot v prohlížeči se mi nepodařil** – prostředí, ne kód. Chrome extension
  nevidí lokální dev server. Vizuální potvrzení červeného indikátoru v AIvP i PvP proto
  provedl uživatel okem a při uzavírání fáze ho potvrdil (OK).

## Poznámka k timingu PvP (drobný trade-off, ne blokující)
Přesun preloadu na první stav se ZNÁMOU variantou znamená, že u PvP se webp kámen zapne
o zlomek později (po prvním pushi s variantou místo hned při stavbě). Do té doby drží CSS
kolečko (fallback) – stejný princip jako doteď během načítání. U starého serveru bez
`game.variant` zůstane indikátor na CSS kolečku (nezapne webp), protože bez varianty nevím,
který set přednačíst; to je konzistentní s tím, jak se pro `undefined` variantu chová i
label. Rozhodnutí tu nebylo nijak dramatické (žádná zamítnutá alternativa hodná ADR) –
varianta prostě NENÍ v `ChallengeAcceptedInfo`, takže jiné čisté místo než první stav není.

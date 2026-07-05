# Phase 36 — Úroveň Pokročilý: kalibrace a UI

**Goal:** Přidat třetí úroveň obtížnosti Pokročilý mezi Začátečníka a Profesionála: páky síly { maxDepth, carelessness } opřené o self-play měření (monotónně silnější než Začátečník, slabší než Profesionál), zavedenou do LEVELS / STRENGTH_BY_LEVEL / LEVEL_LABELS / UI selectu, s testem na protažení pák k enginu a na pořadí síly.

## Steps
- [done] Kalibrace pák Pokročilého (self-play experiment)
- [done] levels.ts: přidat úroveň intermediate
- [done] Web: jediný zdroj úrovní + Pokročilý
- [done] Test protažení pák k enginu (server, se zuby)
- [done] Test pořadí síly (self-play, se zuby)

## Auto-commit
- Phase 36: Úroveň Pokročilý: kalibrace a UI

## Run report
---
phase: 36
verdict: done
steps:
  - title: "Kalibrace pák Pokročilého (self-play experiment)"
    status: done
  - title: "levels.ts: přidat úroveň intermediate"
    status: done
  - title: "Web: jediný zdroj úrovní + Pokročilý"
    status: done
  - title: "Test protažení pák k enginu (server, se zuby)"
    status: done
  - title: "Test pořadí síly (self-play, se zuby)"
    status: done
verify:
  - title: "Vizuální kontrola výběru úrovně v UI + zapamatování přes reload"
    detail: "Select nabízí tři úrovně v pořadí Profesionál → Pokročilý → Začátečník, výchozí Profesionál, popisek „Soupeř: Pokročilý" po založení. Nově: zvolená úroveň se ukládá do LocalStorage a po reloadu stránky se předvyplní (úvodní automatická partie vznikne na ní). Ověřeno typecheckem a web testy (132), ne okem v prohlížeči – doporučuji krátký pohled: přepnout na Pokročilý, F5, zkontrolovat, že select i nová partie drží Pokročilý."
  - title: "Subjektivní obtížnost Pokročilého proti člověku"
    detail: "Čísla { maxDepth: 3, carelessness: 0.2 } jsou kalibrovaná self-play měřením (pořadí síly sedí), NE ověřená obtížnost proti reálnému hráči. Zda se Pokročilý hraje jako smysluplný střed, pozná až člověk u desky. Doladění = editace konstanty STRENGTH_BY_LEVEL.intermediate a nasazení."
---

# Phase 36 — report z auto session

## Co se udělalo

Přidána třetí úroveň obtížnosti **Pokročilý** (interní drát `intermediate`) mezi Začátečníka a Profesionála, s pákami síly `{ maxDepth: 3, carelessness: 0.2 }`.

**Kalibrace (krok 1).** Jednorázovým self-play experimentem přes `runStrengthMatch` jsem proměřil kandidáty (hloubky 2–3, nepozornost 0–0,3) proti Začátečníkovi `{d1, c0.5}` a pro-like straně `{d4, c0}`/`{d6, c0}`. Zvoleno `{ maxDepth: 3, carelessness: 0.2 }`. Naměřené poměry (párovaný zápas, seedovaný, N=12 partií jako v testu):
- Pokročilý vs Začátečník: **100,0 %** (V12/R0/P0) – jasně silnější.
- Pokročilý vs Profesionál `{d4,c0}`: **8,3 %** (V1/R0/P11) – jasně slabší.
- Pokročilý vs Profesionál `{d6,c0}`: **4,2 %** (V0/R1/P11).
- Kontrola `{d3,c0}` vs `{d3,c0}` (deterministická): **45,8 %** – harness nestranný.

Pozorování z kalibrace: nepozornost je proti silnému soupeři devastující (u d3 spadne skóre z ~34 % na ~8 % už při c0,15), takže Pokročilý má nepozornost nižší než Začátečník (0,2 vs 0,5) – hloubka je hlavní páka, nepozornost jen občasný potrestatelný kaz. Kalibrační skripty byly po měření smazány (necommitují se).

**Drátování.** `levels.ts` (server): `intermediate` v `LEVELS` i `STRENGTH_BY_LEVEL`, `DEFAULT_LEVEL` beze změny. `server-client.ts` (web): zaveden `GAME_LEVELS` jako jediný web-side zdroj (dřív byly úrovně opsané na 4 místech), z něj odvozen typ `GameLevel` i runtime guard v `isGameDto`. `app-shell.ts`: `LEVEL_LABELS` doplněn („Pokročilý"), select iteruje `GAME_LEVELS` (= pořadí Profesionál → Pokročilý → Začátečník, první = výchozí).

**Testy se zuby.** Server `engine-move.test.ts`: pro `intermediate` dorazí k `bestmove` reálná mapová `STRENGTH_BY_LEVEL.intermediate`, odlišná od beginner i professional (ověřeno i dočasným rozbitím – test spadl). `levels.test.ts`: kontrakt středu (hlubší a pozornější než Začátečník, s páky). Engine `selfplay-strength.test.ts`: pořadí síly (Pokročilý > Začátečník, < pro-like) + deterministická kontrola shodné síly ~0,5.

## Ověření

Zeleně: typecheck (4 balíčky), lint, všechny testy — rules, cli 24, web 128, engine 250, server 105.

## Red-team (nezávislý sub-agent, čerstvý kontext)

Fáze sahá na cross-module kontrakt (názvy úrovní sdílí server, web, drát), tak jsem pustil adversariální review. Verdikt: **bezpečné k reportu, žádný blokující nález.** Dva neblokující nálezy — oba **zavádějící komentáře, které jsem sám napsal**, ne živé chyby — opraveny:
1. Komentář v `server-client.ts` tvrdil „pořadí NEurčuje UI", což je nepravda (select i výchozí soupeř z něj vychází). Přepsán na varování, že `professional` musí zůstat první, ať UI default sedí na serverový `DEFAULT_LEVEL`.
2. Komentář u engine testu nadhodnocoval vazbu na produkční čísla. Zpřesněn: mirror `{d3,c0.2}` je ruční kopie a drift produkčních čísel nic automaticky nechytí (vědomé omezení — engine je v grafu pod serverem, konstantu importovat nelze).

## Přídavek nad rámec plánu: úroveň přežije reload (LocalStorage)

Na žádost uživatele (mimo původních 5 kroků): zvolená úroveň se ukládá do
`localStorage` pod klíčem `checkers.level` a při startu se z ní předvyplní select –
úvodní automatická partie po reloadu tak vznikne na naposledy zvolené úrovni.
Partie sama žije dál jen v paměti serveru (reload zakládá NOVOU partii); do
LocalStorage jde pouze string úrovně, ne stav hry. To NENÍ návrat k zavrženému
LocalStorage archivu z fáze 23 (ten persistoval partie) – tady jde o UI preferenci,
server zůstává jedinou autoritou nad stavem.

Ošetřené unhappy path (web testy, se zuby ověřenými dočasným rozbitím):
- **LocalStorage nedostupný** (privátní režim, vypnuté úložiště → `getItem`/`setItem`
  hodí): čtení i zápis v `try/catch`, start appky nespadne, jede výchozí Profesionál.
  Zuby: bez `try/catch` `createAppShell` při startu spadne → test zčervená.
- **Poškozená/stará/cizí uložená hodnota** (např. `grandmaster`): validace proti
  `GAME_LEVELS`, neplatné → fallback Profesionál (nepropustí se neznámá úroveň do
  `createGame`, kde by ji server odmítl 400).
- Test `beforeEach/afterEach` `localStorage.clear()`, ať se volba neprolévá mezi testy.

Web testy 128 → 132.

## Otevřené body / rizika

- **Kalibrace = odhad, ne ověřená obtížnost.** Self-play je šumivý a Profesionál v provozu má neomezenou (časově řízenou) hloubku, kterou test jen aproximuje pevnou hloubkou 4. Zda je Pokročilý pro člověka opravdu „uprostřed", pozná až hráč (viz `verify`).
- **Server↔web kontrakt úrovní zůstává ruční kopie** (web na balíček server nezávisí kvůli build grafu). Dnes konzistentní, ale bez automatického testu shody — stejný stav jako u `GameDto`. Rozejití by se projevilo jako 400 na serveru nebo tiché odmítnutí ve web guardu.

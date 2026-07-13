---
phase: 118
verdict: done
steps:
  - title: "Audit ruleset u všech volání selection.ts"
    status: done
  - title: "Italské testy selection.ts"
    status: done
  - title: "Živá kontrola v prohlížeči"
    status: done
  - title: "Brána"
    status: done
---

# Phase 118 — report z auto session

## Co je hotové
Fáze byla podle discussu VERIFY + TESTY, ne oprava. `selection.ts` jsem NEMĚNIL –
jediná změna v produkčním kódu žádná, přibyl jen testovací soubor
`packages/web/test/selection-italian.test.ts`.

**Audit call sites (krok 1):** Prošel jsem všechna volání 7 funkcí `selection.ts`
v `controller.ts` (AIvP) i `pvp-controller.ts` (PvP), včetně drag cest. `ruleset`
teče do KAŽDÉHO volání a je odvozený z varianty hry:
- `controller.ts:184` – closure const `rulesetForVariant(game.variant ?? 'american')`,
- `pvp-controller.ts:144/489` – `let` inicializovaný na placeholder AMERICAN, přepsaný
  v `applyState` na `rulesetForVariant(dto.variant ?? 'american')` PŘED renderem
  (placeholder je neškodný: než dorazí první stav, `position === null` → deska nereaguje).

Nikde není ruleset vynechaný ani natvrdo americký. **Audit potvrdil i nezávislý
sub-agent (čerstvý kontext)** – shodný verdikt, žádná díra. Sub-agent navíc odhalil,
že `endpointsFor` a `targetsFor` se z controllerů reálně NEVOLAJÍ (jen definované);
skutečná drag-drop legalita jede přes `resolveChainTo` + `capturedOnHop`.

**Testy (krok 2):** `selection-italian.test.ts`, 15 testů, staví na reálných
fixtures z `packages/rules/test/italian-quality-priority.test.ts` (max braní + FID
priorita) a jede přes reálný `legalMoves` + reálnou `selection.ts`, ne mock:
- (a) `targetsFor(muž 9, ITALIAN)` == [] (nejde začít), dáma 22 má dopad; zub: default
  americká vrátí `[18]`.
- (b) `nextTargets` vede povinnou dáminu max cestu 15→6→13 hop-po-hopu, `resolveMove`
  na plné cestě vydá tah; zub: italská nenabídne americkou větev 24.
- (c) drag: `endpointsFor(muž 9, ITALIAN)` == [], a hlavně na REÁLNÉ drag cestě
  `resolveChainTo(...,13,ITALIAN)` dohledá max řetěz, `resolveChainTo(...,31,ITALIAN)`
  == null (nepřednostní americká větev nejde dotáhnout); zub: default oba pustí.
- (d) regrese: american exact `{6,24}`, pool obě větve (6 i 24) drží, italská jen `[6]`;
  explicitní AMERICAN == implicitní default.

Každý bod má zub: rozbití napojení rulesetu (návrat na default) by testy shodilo.

**Brána (krok 4):** tsc čistý napříč všemi balíčky; celá suita zelená
(rules 435, cli 24, engine 268, ai 57, server 206, web 658); `rules/src` beze změny
(perft ostatních variant nedotčen); jediná změna ve webu je nový test → ostatní
varianty (american/pool/russian/czech) v UI netknuté.

## Živá kontrola
Já sám ji z tohoto prostředí provést nedokázal – Chrome rozšíření je síťově izolované
od hostu (dev server běžel, curl 200, ale prohlížeč hlásil na localhost i síťových IP
chybovou stránku), a appka nemá jak vnutit vlastní pozici. **Živou kontrolu proto
provedl a potvrdil uživatel ručně** v prohlížeči (italská AIvP). Mechanická evidence to
podpírá: unit testy volají PŘESNĚ ty funkce, které controller používá, se stejným
`ITALIAN_RULESET`, nad reálným enginem; audit (můj i nezávislý) potvrdil, že controller
ten ruleset skutečně předává.

## Poznámka
Žádný reálný rozcestník k zaznamenání přes `/mini:decision` nevznikl – fáze nic
nenavrhla ani nezavrhla, jen ověřila a otestovala existující chování.

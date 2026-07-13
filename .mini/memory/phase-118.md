# Phase 118 — Italská: UI multi-skok pod maximem

**Goal:** Doklikávání sekvence dopadů (vícenásobný skok) ve webovém UI musí ctít, že legální jsou JEN tahy s maximem + FID prioritou (odvozeno z legalMoves, které to už vynucuje z IT-3/IT-4) - hráč NESMÍ zadat kratší braní ani braní mužem místo povinného braní dámou; každý mezikrok musí být PREFIX nějaké legální plné sekvence z legalMoves. K VYŘEŠENÍ V DISCUSS: jak dnešní UI odvozuje mezikroky multi-skoku - jestli z plných sekvencí legalMoves (pak fáze = hlavně OVĚŘENÍ + testy) nebo vlastní per-krok regenerací (pak = OPRAVA, ať nepustí prefix nelegální kratší/nepřednostní cesty). Brána: pokus zadat nelegální kratší/nepřednostní/mužem braní se v UI NEDÁ dokončit (ideálně ani začít, když nevede k legální plné cestě); povinná plná cesta se doklikat dá; ostatní varianty (american/pool/russian/czech) v UI netknuté; celá suita zelená; tsc čistý; rules/src beze změny (perft ostatních variant nedotčen).

## Steps
- [done] Audit ruleset u všech volání selection.ts
- [done] Italské testy selection.ts
- [done] Živá kontrola v prohlížeči
- [done] Brána

## Auto-commit
- Phase 118: Italská: UI multi-skok pod maximem

## Discussion
# Phase 118 — Italská: UI multi-skok pod maximem

## Intent
Zajistit, že doklikávání/tažení vícenásobného skoku ve webovém UI ctí italské maximum + FID prioritu. ZJIŠTĚNO: je to VERIFY + TESTY, ne oprava — `selection.ts` je celý odvozený z `legalMoves(position, ruleset)` a IT-3/IT-4 už legalMoves(ITALIAN_RULESET) osekaly na max+prioritu, takže UI to ctí automaticky.

## Key decisions
- **Fáze = audit call sites + testy + živá kontrola (ne fix), pokud audit neodhalí vynechaný ruleset.** Potvrzeno uživatelem.
- **Proč to funguje automaticky:** `packages/web/src/selection.ts` — každá funkce (`nextTargets`, `resolveMove`, `targetsFor`, `endpointsFor`, `resolveChainTo`, `capturedOnHop`, `capturesForPrefix`) prochází `legalMoves(position, ruleset)` a filtruje podle naklikané předpony. Klient NIKDY sám nerozhoduje o legalitě (hlavička ř. 4-5). Braní mužem vyřazené prioritou → `targetsFor` prázdné (nejde začít); kratší braní → není prefixem žádného legálního tahu (nejde doklikat/dotáhnout). U italské mají navíc všechny legální tahy STEJNÝ počet braní (maximum) → žádná cesta není prefixem jiné → mizí i nejednoznačnost „hotovo vs pokračuj".
- **Pre-existující kosmetika MIMO rozsah (potvrzeno):** `selectableAt` (selection.ts ř. 38) nechá VYBRAT libovolný vlastní kámen i bez legálního tahu (v povinném braní se pak nic nezvýrazní). Platí pro VŠECHNY varianty dnes, není italská specialita ani chyba legality. Nezpřísňovat v IT-8.

## Watch out for
- **JEDINÉ reálné riziko = vynechaný ruleset.** `ruleset` je u všech funkcí `selection.ts` VOLITELNÝ s defaultem `AMERICAN_RULESET`. Kdyby KTERÉKOLI volání v `controller.ts` (AIvP) nebo `pvp-controller.ts` (PvP) ruleset vynechalo, italská by v UI tiše počítala AMERICKOU legalitu → tichý bug. AUDIT: projít VŠECHNA volání selection.ts v obou controllerech VČETNĚ drag cest (`endpointsFor`, `resolveChainTo`, `capturedOnHop`) a potvrdit, že se předává ruleset varianty (odvozený z varianty hry, ne hardcoded american). Kde chybí → doplnit (drobná oprava).
- **Testy s ITALIAN_RULESET (unit nad selection.ts):** (a) muž s nepřednostním/kratším braním → `targetsFor(muž)` == [] (nejde začít); (b) povinná dámina max cesta: `nextTargets` provede skrz, `resolveMove` na konci vrátí ten legální tah; (c) endpoint kratšího/mužova braní NENÍ v `endpointsFor` (drag ho nepustí); (d) regrese: american/pool multi-skok nextTargets beze změny.
- **Živá kontrola v prohlížeči (součást brány):** italská AIvP — pokus o kratší/mužovo braní nejde ani začít; povinné max braní se doklikat i dotáhnout (drag) dá. Ne jen „testy zelené".
- **rules/src netknuté** — čistě web (verify/test). Perft ostatních variant nedotčen; celá suita zelená; tsc čistý.

## Run report
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

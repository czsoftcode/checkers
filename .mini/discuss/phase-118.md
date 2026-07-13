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

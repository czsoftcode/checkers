# Phase 98 — Ruská: proměna uprostřed braní

## Intent
Implementovat ruské pravidlo: muž, který během skokové sekvence DOPADNE na poslední (proměnnou)
řadu, se v tom okamžiku stává létavou dámou a pokračuje v braní letmo. Přidat `promoteMidCapture`
do Ruleset + `RUSSIAN_RULESET` prod const. Dokončuje ruskou variantu na úrovni knihovny (pool +
mid-capture promotion = ruská). Jedna fáze (potvrzeno), i když je pravděpodobně těžší než 95.

## Key decisions
- **Ruské pravidlo (potvrzeno, ověřit proti stejnému zdroji jako fáze 96):** muž se promuje v OKAMŽIKU
  dopadu na poslední řadu během braní (muž skáče krok-2, vždy dopadá – nemine ji). Může-li pak brát
  dál, MUSÍ pokračovat jako létavá dáma (braní povinné). Nemůže-li, sekvence končí a na poli stojí dáma.
- **Turecký úder platí i pro ruského MUŽE (klíčové, rozšiřuje rozsah).** Ruský muž NESMÍ jet po staré
  `extendJumps` cestě s okamžitým odebráním (jako pool): po promoci na létavou dámu by pozdější klouzavý
  segment mohl přejet přes pole, kde muž předtím bral – to turecký úder zakazuje. Ruské braní = JEDNA
  souvislá turecká sekvence (kameny drží na desce jako blokery do konce), kde je piece zprvu muž
  (krok-2, keep-as-blocker) a po dopadu na poslední řadu přechod na létavou dámu (klouzání). Pool muž
  ZŮSTÁVÁ na staré cestě s okamžitým odebráním (pool se uprostřed braní nepromuje → parita drží).
- **Reprezentace proměny (potvrzeno):** typ `Move` se NEMĚNÍ (nezná, kde se promovalo). `apply.ts`
  sekvenci PŘEHRAJE se stejným pravidlem jako generátor (promoce na dopadu na poslední řadu + turecký
  úder + přechod na klouzavou validaci). Generátor a apply MUSÍ sdílet identické pravidlo přechodu.
  POZOR: dnešní apply odvozuje proměnu z FINÁLNÍHO pole – pro ruskou to nestačí (dáma promuje uprostřed
  a doskočí jinam), musí sledovat, zda muž během sekvence šlápl na poslední řadu.
- **Dvojitá brána (potvrzeno, jako fáze 96):** otevírací perft mid-capture skoro netestuje (muži jsou
  na začátku daleko od proměny). Reálný test = RUČNĚ postavené pozice, kde muž právě promuje uprostřed
  braní (golden + druhá implementace cross-check); ruská OTEVÍRACÍ perft proti zafixovanému ruskému
  zdroji z fáze 96 = kontrola, že se nerozbila mašinérie. Ruská perft do PLNÉ hloubky uzavírá otázku
  hranice divergence pool↔ruská z fáze 96.

## Watch out for
- **Rozsah větší než „přidat přepínač role".** Ruský muž potřebuje vlastní turecko-úderovou krok-2 cestu
  (keep-as-blocker) + přechod na `extendFlyingKingJumps` uprostřed sekvence. Nejde jen zavolat existující
  funkce – přechod muž→dáma uprostřed rekurze při zachování blokerů je jádro obtížnosti.
- **Cross-module kontrakt generátor ↔ apply.** Oba musí IDENTICKY: promovat na dopadu na poslední řadu,
  držet brané kameny jako blokery, po promoci validovat zbytek jako klouzavé braní. Golden test ať ověří
  REÁLNÝ kód obou stran (generuj → aplikuj → zkontroluj desku: brané pryč, na cíli DÁMA i když cíl není
  na poslední řadě).
- **apply promotion z finálního pole je pro ruskou ŠPATNĚ** – musí sledovat průchod poslední řadou během
  sekvence, ne jen finální pole.
- **Americká i pool beze změny čísel** (perft, pořadí tahů). Ruská cesta se větví na `promoteMidCapture`;
  pool muž i americká zůstávají na staré cestě nedotčené.
- **Předpoklad k ověření, ne gospel:** přesná definice ruské mid-capture promotion (okamžik, povinnost
  pokračovat) proti zafixovanému ruskému zdroji PŘED použitím. Jemný tisk se mezi federacemi liší.
- **Nezávislý sub-agent review před reportem** (stejně/více riziková než 95: chybová/geometrická cesta,
  přechod režimů uprostřed sekvence, kontrakt mezi moduly – viz CLAUDE.md).
- **Opening perft sám o sobě je slabý test** této featury (jako fáze 96) – nespoléhat jen na něj.

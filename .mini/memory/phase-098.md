# Phase 98 — Ruská: proměna uprostřed braní

**Goal:** Přidat promoteMidCapture do Ruleset + RUSSIAN_RULESET prod const; v generátoru braní: muž, který během skokové sekvence dopadne na proměnnou řadu, se HNED stává létavou dámou a pokračuje v braní letmo (přechod z krok-2 cesty na klouzavou uprostřed sekvence, přepočítat legální pokračování z nové role); apply.ts proměnu časuje zrcadlově. Interaguje s tureckým úderem z fáze 95 (brané kameny blokují do konce sekvence). Brána: ruská perft proti zafixovanému ruskému zdroji z fáze 96 do PLNÉ hloubky (uzavírá otázku hranice divergence pool<->ruská z fáze 96) + golden testy mid-capture promotion; americká i pool beze změny čísel. Nezávislý sub-agent review před reportem (stejně riziková jako 95). Řez z todo 58 (fáze C); 58 zůstává otevřené (česká priorita + pool prod config).

## Steps
- [done] Ruleset promoteMidCapture + RUSSIAN_RULESET
- [done] Generátor: ruský muž (turecký úder + promoce)
- [done] apply.ts: ruský replay (deferred removal + promoce)
- [done] Golden testy mid-capture (obě strany)
- [done] Perft ruská: otevírací + hloubková brána
- [done] Nezávislý sub-agent review

## Auto-commit
- Phase 98: Ruská: proměna uprostřed braní

## Discussion
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

## Run report
---
phase: 98
verdict: done
steps:
  - title: "Ruleset promoteMidCapture + RUSSIAN_RULESET"
    status: done
  - title: "Generátor: ruský muž (turecký úder + promoce)"
    status: done
  - title: "apply.ts: ruský replay (deferred removal + promoce)"
    status: done
  - title: "Golden testy mid-capture (obě strany)"
    status: done
  - title: "Perft ruská: otevírací + hloubková brána"
    status: done
  - title: "Nezávislý sub-agent review"
    status: done
---

# Fáze 98 — report z auto session

## Co je hotové

**Ruleset.** `Ruleset` má nové pole `promoteMidCapture: boolean`. `AMERICAN_RULESET`
i `POOL_RULESET` mají `false`, nový `RUSSIAN_RULESET` (`manCaptureBackward:true`,
`king:'flying'`, `promoteMidCapture:true`) je exportovaný z indexu.

**Generátor (`moves.ts`).** Nová `extendRussianManJumps`: krok-2 braní muže obousměrně,
ale s **keep-as-blocker** (brané kameny se NEnulují, jako u `extendFlyingKingJumps`),
členství v `captures` brání dvojímu braní. Jakmile muž dopadne na proměnnou řadu,
funkce HNED deleguje zbytek sekvence (i tvorbu listu) na `extendFlyingKingJumps`
s dámou → žádný dvojitý ani ztracený list, žádné man-pokračování přes dámskou řadu.
Routing v `jumpMovesFrom`: `man + promoteMidCapture` → sem; pool muž i americká
zůstávají na `extendJumps` beze změny.

**Apply (`apply.ts`).** Pro ruského muže v braní: odložené mazání VŠECH braných
(turecký úder po celou souvislou sekvenci), zprvu validace krok-2, po dopadu na
proměnnou řadu přepnutí příznaku `promotedMid` → od dalšího segmentu klouzavá
(paprsková) validace. **Finální kámen se určuje z `promotedMid`, ne z finálního
pole** — dáma po proměně smí doskočit jinam než na proměnnou řadu. Krátká/pool/
americká cesta beze změny.

**Oracle (`pool-reference-gen.ts`).** Nezávislá druhá implementace rozšířena o
`midPromote` režim (muž na proměnné řadě se mění na dámu a bere dál). Zůstává
nezávislá na knihovně (souřadnice row/col, vlastní apply, uniformní blokery).

## Ověření (mechanicky, sám)

- `tsc --noEmit` (celý workspace, 6 balíčků) i `eslint .` → 0.
- `vitest run packages/rules` → **353 testů zeleně** (bylo 337, +16 nových).
- **Otevírací ruská perft** proti zafixovanému oracle do hloubky 8: shoda.
  Zafixovaná čísla `[7,49,302,1469,7482,37986,190146,929907]`.
- **Uzavřena divergence pool↔ruská z fáze 96:** stromy shodné do hloubky 7 VČETNĚ,
  poprvé se rozcházejí až v hloubce **8** (ruská 929907 vs pool 929902). Hloubky
  9–10 ověřeny ručně (moves.ts == oracle: 4570712, 22456537), do commitu nejdou
  kvůli běhu ~30 s.
- **Crafted mid-capture** pozice (kde proměna reálně nastává): moves.ts+apply ==
  oracle do hloubky 5 a zároveň ≠ pool už v hloubce 1 (teeth, že přepínač reálně
  mění strom).
- **Golden** (`russian-mid-capture.test.ts`): generuj → aplikuj → deska, dvě barvy
  + opačný směr; ověřeno, že na cíli stojí DÁMA i když cíl NENÍ na proměnné řadě,
  brané pryč, bloker zůstává; plus hrana „promuje a nemůže dál".
- **Zuby (mutační test):** rozbití přechodu v generátoru → 3/4 golden padnou;
  vynucení `promotedMid=false` v apply → 7 testů padne. Testy netestují jen kopii.
- **Americká i pool beze změny čísel:** existující perft a fixtures zůstaly zelené.

## Nezávislý review (čerstvý kontext)

Sub-agent bez sdíleného kontextu: **žádná kritická ani střední vada**. Prošel fuzz
(4000 náhodných + 3000 pozic u proměny, 0 výjimek při apply, 0 divergencí proti
oracle, mid-promotion nastal 135×), strukturální unhappy path apply (díra v path/
captures, teleport, obsazený dopad, duplicitní/špatný capture → všechny padnou
`RangeError`em), obě hrany a paritu AMERICAN/POOL.

Dva **drobné** nálezy:
1. Zavádějící komentář v hlavičce `applyMove` (příklad „proměna z finálního pole")
   — **opraveno**, doplněno rozlišení pro `promoteMidCapture=true/false`.
2. Nechráněná nekonzistentní konfigurace `promoteMidCapture:true` + `king:'short'`
   (muž by se stal létavou dámou, ostatní dámy krátké). V praxi nedosažitelná —
   `RUSSIAN_RULESET` má vždy `flying` a `ruleset.ts` to dokumentuje jako
   nepodporované. **Nechal jsem BEZ guardu**: přidávat runtime assert do horké
   cesty (`jumpMovesFrom` volané per-pole v perftu) kvůli nedosažitelné kombinaci
   je vrstva „pro budoucnost" bez opodstatnění TEĎ. Vědomé riziko pro budoucí
   variantu (kdyby vznikla flying-mid-capture varianta s krátkou dámou, což je
   geometricky nesmysl).

## Otevřené otázky / poznámky

- Notace (`notation.ts`) ruské mid-capture tahy nezpracovává explicitně, ale
  formátuje je správně přirozeně: `king:'flying'` bere každý segment jako paprsek
  a krok-2 segmenty muže jsou platné 2polové paprsky. Mimo řez fáze 98 (notace =
  fáze 97), nebylo potřeba měnit; testy notace zůstaly zelené. Případný explicitní
  test ruské notace je kandidát do budoucí fáze, ne blocker.
- Rozhodovací křižovatka (ADR): žádná zamítnutá alternativa neproběhla — přístup
  (vlastní `extendRussianManJumps` s delegací na flying, `promotedMid` v apply,
  oracle s `midPromote`) plyne přímo z diskuse fáze. `/mini:decision` nepovažuji
  za nutné.

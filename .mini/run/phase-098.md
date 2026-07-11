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

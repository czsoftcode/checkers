# Phase 112 — Italská: muž nebere dámu

**Goal:** V generátoru skoků (packages/rules/src/moves.ts, jumpMovesFrom/extendJumps) při zapnutém manCannotCaptureKing prořezat KAŽDÝ skokový segment, kde by muž přeskakoval soupeřovu dámu - už při GENERACI, ne post-filtrem. Muž se před dámou zastaví i s prázdným polem za ní; omezení platí i UPROSTŘED vícenásobného skoku (muž se v celé sekvenci nesmí dostat přes žádnou dámu), aby pozdější vrstva maxima počítala správnou délku braní. Aktivní JEN italským flagem (manCannotCaptureKing=true); dáma bere muže i dámy normálně, muž normálně bere muže. BEZ vrstvy maxima a priority (přijdou v IT-3/IT-4). Brána: nová fixture prokáže prořez (muž nepřeskočí dámu na prvním segmentu i v pokračování skoku); existující varianty (flag=false) beze změny včetně perft 1-6 american/pool/russian/czech; celá suita zelená; tsc čistý.

## Steps
- [done] Guard v extendJumps: muž nepřeskočí dámu
- [done] Fixture: pět zubů muž vs dáma
- [done] Brána: perft + suita + tsc

## Auto-commit
- Phase 112: Italská: muž nebere dámu

## Discussion
# Phase 112 — Italská: muž nebere dámu

## Intent
Vynutit italské pravidlo „pedina non mangia la dama": muž (man) nesmí přeskočit soupeřovu dámu (king) při braní. Prořez už při GENERACI skoků (ne post-filtr), aby pozdější vrstva maxima (IT-3) počítala správnou délku braní. Aktivní jen italským flagem `manCannotCaptureKing=true`; dáma bere muže i dámy normálně, muž normálně bere muže. BEZ vrstvy maxima a priority (IT-3/IT-4). Vedlejší (žádoucí) efekt: dáma se pro muže stává neprůchodnou překážkou.

## Key decisions
- **Jediné místo zásahu: `extendJumps` v packages/rules/src/moves.ts.** Italská má `king: 'short'` a `promoteMidCapture: false`, takže se v `jumpMovesFrom` (ř. 176-189) routuje výhradně přes `extendJumps` (muž i krátká dáma). Létavou cestu (`extendFlyingKingJumps`) ani ruskou (`extendRussianManJumps`) italská NIKDY nepoužije → guard tam NEPŘIDÁVAT (bylo by to mrtvé + proti non-goalu „nestav pro budoucnost"). Potvrzeno uživatelem.
- **Konkrétní guard:** v `extendJumps` v místě kontroly přeskakovaného kamene (ř. ~294-300, po načtení `overCell`) přidat větev: `if (ruleset.manCannotCaptureKing && piece.kind === 'man' && overCell.kind === 'king') continue;` (přeskoč tento směr). `piece` je v `extendJumps` po celou sekvenci konstantní (proměna muže sekvenci ukončí na ř. 279), takže guard automaticky platí i UPROSTŘED vícenásobného skoku bez další práce.
- **Flag-vázanost = záruka regrese:** `manCannotCaptureKing` je u american/pool/czech `false`, takže `continue` se nikdy nespustí a jejich průchod `extendJumps` je bajt-identický → perft se nehne. To je hlavní bezpečnostní bod.
- **Fixture styl:** samostatný behavior test (jako `czech-king-priority.test.ts`), NE perft JSON.

## Watch out for
- **Fixture MUSÍ mít zuby** — pět případů: (a) muž nepřeskočí dámu i s prázdným polem za ní; (b) totéž uprostřed multi-skoku (sekvence se zastaví před dámou); (c) KONTROLA: stejná pozice s AMERICAN_RULESET muže přes dámu PUSTÍ (důkaz, že guard je flag-vázaný a americká je netknutá); (d) italská DÁMA normálně bere dámu (guard neplatí na king-figuru); (e) italský muž normálně bere muže. Body (c)-(e) hlídají, ať se neproříže víc, než má.
- **NEsahat na `legalMoves` filtr `kingCapturePriority`** (česká) — italská ho nepoužívá (má `capturePriority='italianFull'`, ne ten boolean). Tato fáze mění jen generátor skoků, ne `legalMoves`.
- **Tato fáze NEDĚLÁ maximum ani prioritu** — italská `legalMoves` zatím vrátí všechny skoky (jen s prořezaným muž-přes-dámu). Neúplná italská legalita je očekávaná; test ověřuje generátor (jump sekvence), ne plnou italskou partii. Maximum přijde v IT-3, priorita v IT-4.
- **Brána:** perft 1-6 american/pool/russian/czech BEZE ZMĚNY čísel + celá vitest suita zelená + `tsc` čistý. Perft je pojistka, že guard nezasáhl ostatní varianty.
- **Terminace/turecký úder:** `extendJumps` braný kámen nuluje (American styl, ne keep-as-blocker) — pro italskou správně (krátké figury). Guard s tím neinteraguje: muž dámu nikdy nebere, takže dáma zůstává na desce jako bloker.

## Run report
---
phase: 112
verdict: done
steps:
  - title: "Guard v extendJumps: muž nepřeskočí dámu"
    status: done
  - title: "Fixture: pět zubů muž vs dáma"
    status: done
  - title: "Brána: perft + suita + tsc"
    status: done
---

# Phase 112 — report z auto session

## Co je hotovo
- **Guard v `extendJumps`** (`packages/rules/src/moves.ts`): flag-vázaná větev
  `if (ruleset.manCannotCaptureKing && piece.kind === 'man' && overCell.kind === 'king') continue;`
  přidaná hned za kontrolu barvy přeskakovaného kamene, před kontrolu volného
  dopadu. `piece` je v celé sekvenci konstantní, takže prořez platí i uprostřed
  vícenásobného skoku bez další práce. Zásah jen do `extendJumps` – létavá
  (`extendFlyingKingJumps`) ani ruská (`extendRussianManJumps`) cesta italská
  nepoužije, tam guard nepatří.
- **Fixture** `packages/rules/test/italian-man-cannot-capture-king.test.ts`
  (6 testů, styl `czech-king-priority.test.ts`), přímo přes `jumpMovesFrom`:
  - (a) muž se před dámou zastaví i s prázdným polem za ní → žádný skok;
  - (b) multi-skok se zastaví PŘED dámou uprostřed sekvence (bere muže 15 →
    dopad 19, dál přes dámu 24 už ne) – prořez otestovaný v hloubce ≥1, ne jen
    na prvním segmentu;
  - (c) ZUBY: totožná pozice jako (a) s `AMERICAN_RULESET` muže přes dámu PUSTÍ;
  - (b-zuby) tatáž multi-pozice americky pokračuje až na 28;
  - (d) italská dáma bere dámu normálně (guard je vázaný na `piece.kind==='man'`);
  - (e) italský muž bere muže normálně (prořez se netýká braní muž×muž).
- **Brána**: `pnpm -r typecheck` čistý; celá suita zelená (rules 390, web 629,
  server 199, engine 268, ai 57, cli 24). Perft 1-6 american
  (7/49/302/1469/7361/36768) i pool/russian/czech beze změny – čísla jsou
  pokrytá existujícími perft testy, které prošly.

## Adversarial self-review
Protože fáze sahá na kontrakt generátoru skoků (sdílený napříč moduly), pustil
jsem nezávislého sub-agenta (čerstvý kontext). Potvrdil: zuby drží (bez guardu
by (a) i (b) spadly), (b) je skutečně mid-sequence, geometrie sedí, guard
nezasahuje dámu ani braní muž×muž, flag-vázanost drží pro american/pool/russian/
czech. Bez funkčního nálezu.

Na jeho doporučení jsem opravil ZASTARALÉ komentáře v `packages/rules/src/ruleset.ts`,
které tvrdily, že `manCannotCaptureKing` je „SPÍCÍ / legalMoves ho zatím NEČTE" –
po této fázi už čtený JE (přes `extendJumps`). Odlišil jsem ho od skutečně
spících `mustCaptureMaximum`/`capturePriority` (IT-3/IT-4) a k guardu doplnil
poznámku o implicitní závislosti „manCannotCaptureKing ⇒ promoteMidCapture:false"
(letmý muž jde jinou cestou, kterou guard neřeší; žádný ruleset tu kombinaci
nemá, takže mezera je momentálně nedosažitelná). Po úpravě komentářů znovu ověřen
tsc i rules suita – zelené.

## Poznámky / co dál
- Tato fáze DĚLÁ jen generační prořez. Italská `legalMoves` zatím vrací všechny
  skoky (jen s prořezaným muž-přes-dámu), BEZ maxima a priority – to je
  očekávané, přijde v IT-3 (maximum) a IT-4 (FID priorita).
- Žádné reálné rozcestí s odmítnutou alternativou nevzniklo (jediné místo
  zásahu bylo předjednané v diskuzi), takže `/mini:decision` není potřeba.

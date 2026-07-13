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

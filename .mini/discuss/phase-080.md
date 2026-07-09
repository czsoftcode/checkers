# Phase 80 — Mobil AIvP: klik nezahodit pollem

## Intent
V režimu proti počítači (controller.ts) se tap na vlastní kámen na mobilu tiše zahazuje. Příčina: `handleClick` má na začátku guard `if (busy || position.turn !== humanColor) return;`. `busy` je ale nastavené i PASIVNÍMI čtecími dotazy na server, které s tahem člověka nesouvisí:
1. **Poll každých 250 ms** (`POLL_INTERVAL_MS`, `tickLoop`→`poll`→`runRequest`): každý `getGame` drží `busy=true` po dobu HTTP round-tripu. Na mobilu (RTT 100-300 ms) je `busy` pravdivé velkou část času → tap dopadlý do okna se ztratí.
2. **Nápověda ve Výuce** (`maybeRequestHint`→`runRequest`): jednorázově na začátku tahu drží `busy=true` ~1 s po dobu výpočtu `/hint`. Kratší, ale na pomalém mobilu spolkne první tap.

PvP (`pvp-controller.ts`) nepolluje (stav chodí pushem přes WS) a nemá engine/nápovědu → žádné pasivní okno, proto tam klikání funguje. Cíl: tap na vlastní kámen během TAHU ČLOVĚKA v AIvP nesmí padnout kvůli pasivnímu dotazu — chování jako v PvP. **Uživatel výslovně chce ošetřit i okno ve Výuce (nápověda), ne jen hlavní poll.**

## Key decisions
- **Nepollovat, když je na tahu člověk.** V AIvP se během tahu člověka na serveru nic nemění (engine i „AI rozhodne o remíze" reagují až na akci člověka, remíza jde vlastním requestem, ne pollem). Poll je v tu chvíli čistá režie, která jen zamyká desku. Guard v `poll()` rozšířit tak, aby se během `position.turn === humanColor` tik přeskočil. **Poll se MUSÍ znovu rozjet hned, jak člověk potáhne** (po `submitMove`→`applyServerState` je turn enginu) — jinak by tah enginu nikdy nedorazil.
- **Nápověda ve Výuce nesmí blokovat výběrový tap.** `busy` dnes v `handleClick` slouží zároveň jako zámek vstupu; pasivní čtení (poll/hint) vstup zamykat nemá. Výběr kamene je čistě klientský stav (žádný server request až do odeslání tahu), takže tap, který jen vybírá/ruší, nesmí být blokován pasivním dotazem. Návrh mechaniky nechat na `plan` (např. odlišit „běží akční request (postMove/resign/draw)" od „běží pasivní čtení").

## Watch out for
- **Závod odeslání tahu vs. pasivní dotaz:** `advance`→`submitMove` jde přes `runRequest`, které `busy`/`inflight` bezpodmínečně PŘEPÍŠE. Pustí-li se `submitMove` ve chvíli, kdy běží pasivní dotaz (hint, nebo doběhávající poll), vzniknou dva souběžné HTTP requesty a `busy` účetnictví se rozbije (pasivní `finally` shodí `busy` uprostřed běžícího tahu). Řešit serializací jako `resign()` (napřed počkat na `inflight`), nebo zajistit, že akční request nikdy neběží souběžně s pasivním.
- **Restart pollingu po tahu člověka** — ověřit, že po odeslání tahu (i po odmítnutí serverem, kdy člověk zůstává na tahu) se detekce tahu enginu nezasekne.
- **Časování tahu AI** (`humanMoveAnimEndAt`, `aiMovePauseMs` podlaha) stojí na pollu PO tahu člověka — nesmí se rozbít.
- **Hint highlight vs. výběr:** `maybeRequestHint` po awaitu bailuje, když `selection !== null` — zachovat, ať se rada nepřekreslí přes rozdělaný výběr.
- **Testy se zuby:** přidat test, že tap během běžícího pasivního dotazu vybere kámen (dnes by ho `busy` zahodil); dočasné rozbití fixu → tap se ztratí → test padne. Nespoléhat jen na mock — testovat reálnou cestu `handleClick`. Existující testy kolem pollingu/„thinking"/nápovědy musí zůstat zelené.
- **Introhraní/ballot** (`introPlaying`) a tažení myší (`dragging`) mají zámek oprávněně — ty NErozvolňovat, jde jen o `busy` z pasivního čtení.

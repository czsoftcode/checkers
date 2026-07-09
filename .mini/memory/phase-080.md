# Phase 80 — Mobil AIvP: klik nezahodit pollem

**Goal:** Tap na vlastní kámen v režimu proti počítači se nezahodí kvůli běžícímu pozadovému pollu (busy), takže výběr a tah funguje na mobilu stejně spolehlivě jako v PvP.

## Steps
- [done] Poll přeskočit, když je na tahu člověk
- [done] Odlišit pasivní čtení od akčního requestu
- [done] Serializovat odeslání tahu za pasivní dotaz
- [done] Testy se zuby
- [done] Ověření: build + typecheck + lint + testy + ruční průchod

## Auto-commit
- Phase 80: Mobil AIvP: klik nezahodit pollem

## Discussion
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

## Run report
---
phase: 80
verdict: done
steps:
  - title: "Poll přeskočit, když je na tahu člověk"
    status: done
  - title: "Odlišit pasivní čtení od akčního requestu"
    status: done
  - title: "Serializovat odeslání tahu za pasivní dotaz"
    status: done
  - title: "Testy se zuby"
    status: done
  - title: "Ověření: build + typecheck + lint + testy + ruční průchod"
    status: done
verify:
  - title: "Reálný mobil: výběr kamene na první tap v AIvP"
    detail: "Na dotykovém zařízení (nebo emulaci mobilu) v běžné hře proti počítači ověřit, že kámen jde vybrat na první ťuknutí – i opakovaně a rychle po sobě. To byl původní hlášený problém; jsdom tapy simuluje jen přes syntetický click, ne reálný dotyk + síťovou latenci."
  - title: "Reálný mobil: totéž v režimu Výuka (nápověda)"
    detail: "Ve Výuce na začátku tahu ~1 s načítá nápověda; ověřit, že tap na kámen během toho okna už neproletí naprázdno (dřív ho spolkl busy)."
  - title: "Tah AI a časování pauzy fungují dál"
    detail: "Po tvém tahu se má tah počítače objevit jako dřív (poll se po tahu člověka rozjede) a rozmýšlecí pauza AI zůstat plynulá. Ověřeno automat. testem, ale ruční průchod potvrdí i pocit."
---

# Fáze 80 — report z auto session

## Co se udělalo
Příčina: v AIvP (`controller.ts`) drží každý PASIVNÍ dotaz na server příznak `busy`, a `handleClick` na `busy` blokoval → na mobilu (pomalá síť) tap na kámen padal. Dva zdroje pasivního `busy`: poll à 250 ms a jednorázová nápověda Výuky. PvP problém nemá (WebSocket, bez pollu).

Změny (`packages/web/src/controller.ts`):
1. **Poll se během tahu člověka nespouští** (`poll()` guard `|| position.turn === humanColor`) – v AIvP se tehdy na serveru nic nemění; po tahu člověka se poll rozjede (turn přejde na engine).
2. **`passiveInflight`**: `runRequest(op, passive)` ho nastaví; poll a nápověda volají jako pasivní. `handleClick` guard přešel z `busy` na `submitting || (busy && !passiveInflight)` – pasivní čtení už výběr kamene neblokuje.
3. **Serializace odeslání tahu** (`submitMove`): synchronní zámek `submitting` (blokuje vstup i po dobu čekání) + drain `while (busy) await inflight` (vzor jako `resign`/`offerDraw`) + guard `disposed`. Zabrání dvěma souběžným HTTP a rozbití single-flight.

## Nález z adversarialu, který si vynutil čtvrtou změnu (mimo plán)
Nezávislý sub-agent (čerstvý kontext) našel VÁŽNÝ nález: `fetch` v `server-client.ts` neměl timeout, takže zaseknuté pasivní spojení (rádio drop na mobilu – žádná odpověď ani chyba) drží `await inflight` v drainu navěky → `submitting` uvízne `true` → deska zamčená. A to je přesně scénář fáze (flaky mobil + Výuka). Proto přidáno:
4. **Strop pasivních čtení** (`server-client.ts`): `getGame` a `getHint` dostaly `AbortController` s `PASSIVE_REQUEST_TIMEOUT_MS = 10 s`. Abort spadne stejnou cestou jako síťová chyba (`ServerError(0)`), volající ho spolkne, drain se odblokuje. Akční requesty (tah/vzdání/remíza) strop ZÁMĚRNĚ nemají – nesmí se utnout rozehraný tah. Řeší to zároveň i pre-existující stejné riziko u `resign`/`offerDraw`.

## Testy (se zuby, ověřeno rozbitím kódu → pád testu)
- `controller-tap-poll.test.ts` (nový): tap během načítání nápovědy kámen vybere; poll během tahu člověka neběží a po tahu se rozjede; vstup zamčený během odesílání tahu i během drainu (`submitting`).
- `server-client.test.ts` (+2): pasivní `getGame` dostane `signal` a timeout ho utne na `ServerError(0)`; akční `postMove` `signal` NEdostane.
- Narovnal jsem 6 existujících testů (5× `controller-sound`, 1× `board-view`), které modelovaly NErealistický tok: poll doručuje událost enginu, zatímco lokálně je „na tahu člověk". Optimalizace z kroku 1 to odhalila. Klíč: poll v reálné hře hlásí jen tahy ENGINU (bílé) – tah člověka jde přes `postMove`. Testy teď startují ze stavu „na tahu engine" a animují bílý tah (jinak `diffMove`, který klíčuje podle `prev.turn`, tah zahodí).

Vše zelené: typecheck, lint, build, 1313 testů (web 433).

## Zbytky / co neřešeno vědomě
- Drobnost (nález 6): `submitMove` void-async IIFE nemá `catch`; teoretický unhandled rejection, kdyby `inflight` odmítl. V praxi neodmítá (op chytá vše) a je to konzistentní s existujícím `resign()` (`void resignFlow().then(...)` taky bez catch). Nechal jsem konzistentní.
- Serializační invariant v `submitMove` (žádný `await` mezi `while (busy)` a `runRequest`) je okomentovaný – drží jen tou synchronní mezerou.

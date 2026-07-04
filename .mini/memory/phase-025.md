# Phase 25 — Nabídka remízy: AI rozhodne

**Goal:** Tlačítko „Nabízím remízu" ve webovém klientovi pošle serveru nabídku; server se zeptá enginu na skóre aktuální pozice (rozšíření protokolu enginu o vyhodnocení pozice/skóre), a když engine (bílý) v pozici nevyhrává — skóre z pohledu bílého ≤ malý práh — remízu přijme a partie skončí vynuceným výsledkem draw (archiv 1/2-1/2), jinak nabídku odmítne a hra pokračuje. Vertikální řez: protokol enginu → handler → engine-client → store → endpoint POST /games/:id/offer-draw → server-client + controller + tlačítko v app-shell. Bez inline stylů/scriptů (CSP); rozhodnutí AI přichází výhradně z enginu (server nesmí importovat evaluate).

## Steps
- [done] Protokol evaluate + handler enginu
- [done] engine-client: evaluate() + EngineMover
- [done] store.acceptDraw (dvojče resign)
- [done] Endpoint POST /games/:id/offer-draw
- [done] server-client + controller: offerDraw()
- [done] app-shell: tlačítko + stav + CSS + self-review

## Auto-commit
- Phase 25: Nabídka remízy: AI rozhodne

## Discussion
# Phase 25 — Nabídka remízy: AI rozhodne

## Intent
Tlačítko „Nabízím remízu" ve webovém klientovi: člověk (černý) nabídne remízu,
engine (bílý) na základě svého vyhodnocení pozice rozhodne přijmout/odmítnout.
Přijetí ukončí partii vynuceným výsledkem `draw` (archiv `1/2-1/2`); odmítnutí
nechá hru běžet dál. Vertikální řez přes protokol enginu → handler → engine-client
→ store → endpoint → web. Rozhodnutí (úsudek o pozici) přichází VÝHRADNĚ z enginu;
server nesmí importovat `evaluate` z engine balíku.

Struktura je z velké části „vzdání s obrácenou logikou": `store.acceptDraw` je
dvojče `store.resign` (nastaví `forcedResult = 'draw'`, stejný atomický
check-and-set), archivace i `effectiveResult`/DTO už čtou efektivní výsledek.
Jediný podstatný nový kus je engine rozhodnutí.

## Key decisions
- **Přísnost přijetí (kalibrace):** „Jen když nevede." Engine přijme, jen pokud
  pozici nehodnotí jako svou výhru. Práh = `whiteScore <= 0` (pojmenovaná
  konstanta, výchozí 0). Když vede, hraje dál a trestá. Sedí s cílem (i):
  silnému hráči vzdorovat, ne vždy vyhrát.
- **Kdy lze nabídnout:** jen na tahu člověka a když engine NEpřemýšlí. Tlačítko
  aktivní jen při `result==='ongoing' && turn==='black' && engineStatus!=='thinking'`.
  Server to i tak autoritativně ověří (jinak 409). Vyhne se čekání na dotažení
  tahu AI a serializaci v engine frontě.
- **Manuální režim (server bez enginu):** nabídka nedostupná. Endpoint bez enginu
  vrátí chybu (není kdo rozhodne); web tlačítko v tomto režimu nenabízí. Vzdání
  funguje dál (to decidéra nepotřebuje).
- **Protokol:** nová zpráva `evaluate` (`type:'evaluate'`, `id`, `position`,
  `timeMs`) → odpověď `{ type:'evaluate', id, score }`. NE přilepení `score` k
  `bestmove`. `PROTOCOL_VERSION` 2 → 3; `warmup` hlídá shodu (mismatch = chyba).
- **Zdroj skóre:** krátký `searchTimed` (stejný časový limit jako tah,
  `DEFAULT_ENGINE_TIME_MS`), NE statické `evaluate` — materiálně vyrovnaná
  pozice může být takticky prohraná.
- **Kde je práh:** engine vrací jen skóre (úsudek), práh přijetí aplikuje SERVER
  (pojmenovaná konstanta + test). Engine zůstane čistý „scorer".
- **Endpoint je synchronní:** `POST /games/:id/offer-draw` počká na engine
  (~1 s) a vrátí rozhodnutí + GameDto (remíza, když přijato). Žádný „pending
  offer" stav v paměti — rozhodnutí padne hned, není co ukládat.
- **EngineMover** dostane novou metodu `evaluate(position): Promise<{score}>`
  (test stuby ji doimplementují). App volá jen když `engine !== undefined`.

## Watch out for
- **Znaménko skóre (hlavní past na tichou chybu).** `searchTimed.score` je z
  pohledu STRANY NA TAHU (negamax). Člověk nabízí na svém tahu → `turn==='black'`
  → skóre je z pohledu ČERNÉHO. Pro rozhodnutí bílého OBRÁTIT:
  `whiteScore = turn === 'white' ? score : -score`. Test se zuby: vyhraná pozice
  bílého → odmítne; když se znaménko rozbije, test musí padnout.
- **Práh 0 vs poziční evaluace.** `evaluateV2` (mobilita, dvojitý roh, zadní
  řada) dává i v reálně remízových pozicích nenulové skóre (klidně +15). S
  přísnou nulou AI odmítne i mrtvě remízovou koncovku. Konstanta to umožní ladit,
  ale SKUTEČNÉ doladění prahu vyžaduje odehrané partie — mimo rozsah fáze. Test
  hlídá jen znaménko + mechaniku, ne „správnost" prahu.
- **Selhání enginu při vyhodnocení.** Timeout/pád/protokolová chyba během
  `evaluate` → nabídka spadne jako chybová obálka (5xx / engine chyba), hra jede
  dál. NIKDY tiché přijetí ani tiché odmítnutí (rozdíl „engine řekl ne" vs
  „engine se nezeptal").
- **`acceptDraw` atomicita.** Stejně jako `resign`: přijetí musí přes efektivní
  výsledek odmítnout už skončenou/vzdanou partii (409). `markArchived` PŘED
  `writeGamePdn`. Test: dvojí přijetí → 409 + právě jeden `.pdn` s tokenem
  `1/2-1/2`.
- **Serverový guard nezávislý na UI.** I když tlačítko je aktivní jen za správného
  stavu, endpoint sám ověří `result==='ongoing'` a `engineStatus!=='thinking'`
  (jinak 409) — klient není důvěryhodný.
- **Klient single-flight.** Nabídka jde stejnou cestou jako `resign()`
  (počkat na `inflight`, zámek proti dvojkliku). Během ~1 s čekání na rozhodnutí
  ukázat stav („Počítač zvažuje nabídku…") a tlačítko zamknout.
- **PDN nerozliší dohodnutou remízu od remízy z pravidel** (obojí `1/2-1/2`).
  Přijato, mimo rozsah.
- **CSP:** tlačítko + stav stylovat třídami v `styles.css`, žádné inline
  styly/scripty.
- **Spam nabídek.** Každá nabídka stojí ~1 s engine searche; single-flight na
  klientu + sériová fronta enginu to přirozeně škrtí. Bez perzistentního limitu
  pro v1 — vědomě, ne opomenutí.

## Run report
---
phase: 25
verdict: done
steps:
  - title: "Protokol evaluate + handler enginu"
    status: done
  - title: "engine-client: evaluate() + EngineMover"
    status: done
  - title: "store.acceptDraw (dvojče resign)"
    status: done
  - title: "Endpoint POST /games/:id/offer-draw"
    status: done
  - title: "server-client + controller: offerDraw()"
    status: done
  - title: "app-shell: tlačítko + stav + CSS + self-review"
    status: done
verify:
  - title: "Tlačítko „Nabízím remízu" v reálném prohlížeči"
    detail: "Testy ověřily logiku (enable/disable, hlášky, zamčení během rozhodování) v jsdom, ne skutečné vykreslení. Ověř vizuálně: tlačítko je vidět, aktivní jen na tvém tahu a když počítač nepřemýšlí, po odmítnutí ukáže hlášku, po přijetí skončí partie remízou."
  - title: "Kalibrace prahu přijetí (herně)"
    detail: "Práh je DRAW_ACCEPT_MAX_WHITE_SCORE = 0 (přijme, když bílý nevede). Jestli to sedí (nerozdává vyhrané pozice, ale ve vyrovnaných remízuje) jde posoudit jen odehranými partiemi – konstanta je vědomě laditelná, doladění je mimo rozsah fáze."
---

# Phase 25 — report z auto session

Nabídka remízy hotová jako vertikální řez a celá zelená: lint + typecheck čisté,
testy 90 (server) / 74 (web) / 222 (engine) / 24 (cli) prošly.

## Co se povedlo
- **Struktura „vzdání s obrácenou logikou" vyšla.** `store.acceptDraw` je dvojče
  `resign` (stejný atomický check-and-set přes efektivní výsledek), endpoint kopíruje
  tvar `/resign` + archivaci „právě jednou". Málo nového kódu, hodně sdílené cesty.
- **Znaménko skóre má zuby na OBOU větvích.** Skóre ze searche je z pohledu strany
  na tahu; server ho na tahu černého obrací na pohled bílého. Ověřeno spuštěním na
  kopii: rozbití negace shodí testy (větev černého 3 testy, větev bílého 1 test).
- **Chybové cesty nevedou k tichému falešnému úspěchu.** Selhání enginu při
  vyhodnocení → 503 `engine_unavailable`, partie beze změny (ne přijetí ani odmítnutí).
  Pokřivené skóre z nedůvěryhodného enginu → `EngineProtocolError` na hranici procesu,
  bez retry. Bez enginu → 409 `draw_offer_unavailable`.

## Rozhodnutí padlá při implementaci (drobná, ne ADR)
- **Nová protokolová zpráva `evaluate`** místo přilepení `score` k `bestmove`
  (čistší záměr; PROTOCOL_VERSION 2→3, `warmup` hlídá). Sdílená validace `timeMs`
  vytažena do `validateTimeMs`, ať se kontrakt neduplikuje mezi bestmove/evaluate.
- **Endpoint synchronní**, verdikt v odpovědi `{ accepted, game }` – žádný „pending
  offer" stav v paměti. Klient (`server-client.parseDrawOffer`) tvar ověřuje.
- **Verdikt nabídky žije ve vlastním řádku `offer-msg`**, nezávisle na řádku stavu
  (ten řídí polling přes onState) – proud stavů z pollingu hlášku nepřepíše.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Bez vážné vady. Dva body dořešeny hned:
- **Netestovaná větev negace pro bílého na tahu** → přidán test se zuby (engine v
  `error`, bílý na tahu, skóre se neneguje). Ověřeno, že rozbití té větve test shodí.
- **Doc-drift v hlavičce fake-enginu** → hlavička srovnaná s realitou (evaluate,
  módy error/malformed, --score/--protocol).
Zbylé nálezy vědomě ponechány: guard `engine_busy` má TOCTOU okno, ale skutečnou
bezpečnost drží downstream (`acceptDraw` re-check + `runEngineMove` re-check po await),
takže ke korupci stavu nedojde – guard je jen UX pojistka.

## Známá omezení (vědomá)
- **Práh 0 vs poziční evaluace.** Engine dnes hraje s v1 evaluací (`evaluate`, materiál
  + zadní řada + postup), ne evaluateV2. I ta dává v remízových pozicích občas nenulové
  skóre → práh 0 může odmítnout i mrtvě remízovou koncovku. Konstanta je laditelná,
  doladění chce odehrané partie (viz verify).
- **Hláška „Počítač remízu odmítl" přetrvává** až do dalšího tahu/Nové hry (čistí se
  jen na přijetí a Nové hře). Kosmetika, ne defekt.
- **PDN nerozliší dohodnutou remízu od remízy z pravidel** (obojí `1/2-1/2`).

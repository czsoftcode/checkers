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

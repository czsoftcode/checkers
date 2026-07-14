# Phase 120 — Italská: PvP autorita a test

## Intent
Prokázat, že PvP italská je pod serverovou autoritou nad italskými pravidly (server = hranice důvěry, nesmí tiše pustit nelegální tah). Fáze je VERIFY + adversariální test + E2E, NE nová validační vrstva.

## Key decisions
- **Wiring UŽ EXISTUJE (potvrzeno čtením store.ts + app.ts):** `store.ts createPvp(vyzyvatel, vyzvaný, variant)` → `state: initialGameState(undefined, variant)`; `app.ts handleAccept` volá `createPvp` s variantou LOBBY, ve které dvojice hraje (fáze 103/105). Italská PvP partie tak dostane `GameState.variant='italian'` a server ji validuje přes `rulesetForVariant(state.variant)` = ITALIAN_RULESET (app.ts move handler → findLegalMove). V `do` jen POTVRDIT čtením handleAccept, že se předává varianta lobby (ne default american), nepřepisovat.
- **Adversariální test = OBA levely (potvrzeno uživatelem):**
  - (a) UNIT nad `findLegalMove(position, from, path, ITALIAN_RULESET)` (packages/server/src/dto.ts): tři crafted pozice → `null` (odmítnuto): nemaximální braní (kratší když existuje delší), braní mužem místo povinné dámy (priorita), muž bere dámu (manCannotCaptureKing); legální max tah → non-null. Rychlé, přesné na 3 pravidla.
  - (b) SERVEROVÝ integrační test (JÁDRO, nejostřejší): tah, který by AMERICKÁ pustila ale ITALSKÁ odmítá, poslaný do ITALSKÉ PvP partie, server odmítne (409 illegal_move + legalMoves) a stav partie se NEZMĚNÍ. Tento jediný test dokazuje, že server validuje VARIANTOU MÍSTNOSTI, ne defaultní americkou (ne jen že pravidla odmítnou). WS harness jako `variant-lobby-ws.test.ts`.
- **E2E = OBA (potvrzeno uživatelem):** (a) integrační WS test — dvě spojení odehrají kompletní italskou PvP partii (od zahájení do konce, ideálně přes vynucené max braní); (b) živá kontrola v prohlížeči (dvě okna/klienti) — reálné odehrání partie, jako fáze 117.

## Watch out for
- **Rozlišující tah (kritické pro test (b)):** musí být AMERICKY-LEGÁLNÍ ale ITALSKY-NELEGÁLNÍ (nemaximální / mužem místo dámy / muž bere dámu). Generický nelegální tah (mimo desku, cizí kámen) NEDOKÁŽE, že server použil italský ruleset — to už pokrývá fáze 70. Cíl je prokázat VÝBĚR rulesetu podle varianty.
- **Crafted pozice do serverové partie:** partie startuje z výchozího rozestavění. Buď test-hook na `store` (nasadit stav mid-game), nebo sehrát pár legálních tahů do pozice, kde je rozlišující tah dostupný. Rozhodnout v plánu; preferovat minimální/existující seam, ne nový produkční kód jen pro test.
- **Stav po odmítnutí:** ověřit, že po odmítnutém tahu se GameState NEZMĚNÍ (žádný vedlejší efekt) a je pořád na tahu tentýž hráč.
- **Nezduplikovat fázi 70:** obecnou PvP autoritu (mimo pořadí / cizí partie / divák) řeší fáze 70; IT-10 přidává JEN italsky-specifickou nelegalitu (max/priorita/muž-bere-dámu). Mirror/rozšíření, ne kopie.
- **Regrese:** ostatní varianty (PvP i validace) netknuté; do rules/src se NESAHÁ (perft nedotčen); celá suita zelená; tsc čistý.

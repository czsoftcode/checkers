# Phase 44 — Server: endpoint nápovědy tahu

## Intent
Nový **read-only** endpoint, který pro běžící partii (na tahu je člověk) nechá engine
spočítat nejlepší tah pro člověka a vrátí ho jako `MoveDto`. Stav partie **nemění**
(nesahá na `store`, nenastavuje `engineStatus`). Je to serverová páteř módu „Výuka":
UI ho příští fází zavolá samo na každém tahu člověka a tah zvýrazní na desce
(žádné tlačítko „napověz" — nápověda se ve Výuce ukazuje proaktivně).

## Key decisions
- **Síla nápovědy = plná (Profesionál), nezávisle na úrovni partie.** Tj. engine se
  volá BEZ `Strength` (`bestmove(position, undefined)`), NE `STRENGTH_BY_LEVEL[record.level]`
  jako AI-tah. Důvod: nápověda má učit objektivně nejlepší tah, ne mělký/špatný.
- **Sloveso: `GET /games/:id/hint`.** Endpoint nic nemění → idempotentní, RESTově GET.
  (Spouští drahý výpočet enginu, ale z pohledu klienta žádný side effect.)
- **Server je level-agnostický.** Endpoint funguje pro libovolnou běžící partii, kde je
  na tahu člověk. Gating „jen ve Výuce" je čistě UI a řeší se příští fází.
- **Odpověď: jen tah (`MoveDto` = from/to/path/captures).** Žádné skóre ani „proč" —
  to je materiál na pozdější fázi.
- **Nový chybový kód `hint_unavailable`** (409, po vzoru `draw_offer_unavailable`) pro
  manuální režim serveru (`engine === undefined`).
- **Chybové kódy (reuse stávajících):**
  - partie neexistuje → 404 `game_not_found`
  - partie u konce (`effectiveResult !== 'ongoing'`) → 409 `game_over`
  - na tahu je engine (`engine !== undefined && position.turn === ENGINE_COLOR`) →
    409 `not_your_turn`
  - engine timeout/pád/protokol → 503 `engine_unavailable`
  - engine vrátí NELEGÁLNÍ tah → taky 503 `engine_unavailable` (viz Watch out)

## Watch out for
- **Ověřit výstup enginu jako u AI-tahu (app.ts:375).** Vrácený tah PROVĚŘIT přes
  `findLegalMove` proti aktuální pozici. Nelegální/nesmyslný tah = engine se zbláznil →
  503 `engine_unavailable`, NIKDY nepodat člověku nelegální nápovědu. Engine je
  nedůvěryhodný i když radí, ne jen když hraje.
- **Read-only doopravdy.** Cesta nápovědy NESMÍ volat `store.applyMove` ani
  `setEngineStatus`. Znovupoužít `engine.bestmove`, ale `store` se nedotknout.
- **Latence.** Plná síla × volání na každý tah člověka (příští fáze) = nápověda přijde
  za sekundy, s tvrdým timeoutem jako normální `bestmove`. Timeout → 503; UI ten tah
  prostě nezvýrazní (elegantní degradace). Vědomá cena za kvalitu učení.
- **`engine_busy` guard je nejspíš nedosažitelný.** Na tahu člověka engine nepřemýšlí
  (fronta je sériová); `not_your_turn` guard pokrývá stav „engine na tahu". Extra
  `engine_busy` větev nepřidávat, ledaže by plán našel reálnou cestu, jak ji spustit.
- **Cross-module kontrakt.** `hint_unavailable` přidat do `ERROR_CODES` a udržet v sync
  s klientským typem chyb (klient je samostatný balík) — konstanta, ne opsaný literál.
- **Testy musí mít zuby na unhappy path:** 404, game_over, not_your_turn, manuální
  režim (`hint_unavailable`), engine vyhodí výjimku → 503, engine vrátí nelegální tah
  → 503. Použít fake `EngineMover` (jako stávající serverové testy) pro simulaci
  pádu i nelegálního výstupu — netestovat happy path samotnou.

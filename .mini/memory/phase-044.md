# Phase 44 — Server: endpoint nápovědy tahu

**Goal:** Server přidá endpoint, který pro aktuální pozici (strana na tahu = člověk) vrátí enginem doporučený legální tah, ověřený stejnou autoritativní cestou jako každý jiný tah, a na unhappy path odpoví chybou místo tichého selhání (neexistující partie, není tah člověka, konec hry, pád/timeout enginu).

## Steps
- [done] Přidat kód hint_unavailable do ERROR_CODES
- [done] Implementovat GET /games/:id/hint v app.ts
- [done] Test happy path + read-only invariant
- [done] Testy unhappy path se zuby
- [done] Verifikace: testy, lint, typecheck, ruční curl

## Auto-commit
- Phase 44: Server: endpoint nápovědy tahu

## Discussion
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

## Run report
---
phase: 44
verdict: done
steps:
  - title: "Přidat kód hint_unavailable do ERROR_CODES"
    status: done
  - title: "Implementovat GET /games/:id/hint v app.ts"
    status: done
  - title: "Test happy path + read-only invariant"
    status: done
  - title: "Testy unhappy path se zuby"
    status: done
  - title: "Verifikace: testy, lint, typecheck, ruční curl"
    status: done
---

# Phase 44 — report z auto session

## Co je hotové
Nový endpoint `GET /games/:id/hint` (`packages/server/src/app.ts`): pro běžící partii, kde
je na tahu člověk, nechá engine spočítat nejlepší tah **plnou silou** (`bestmove(position,
undefined)`, nezávisle na úrovni partie) a vrátí ho jako `{ move: MoveDto }`. Read-only —
nesahá na `store` ani `engineStatus`. Výstup enginu se ověřuje přes `findLegalMove`
(engine je nedůvěryhodný i když radí); nelegální tah se člověku nepodá.

Chybové větve (řadí se stejně jako u `offer-draw`): bez enginu → 409 `hint_unavailable`
(nový kód v `errors.ts`), partie neexistuje → 404 `game_not_found`, konec hry → 409
`game_over`, na tahu engine → 409 `not_your_turn`, pád/timeout enginu → 503
`engine_unavailable`, nelegální výstup enginu → 503 `engine_unavailable`.

## Ověření
- `packages/server/test/hint.test.ts`: 7 testů (happy path + read-only invariant + 6
  chybových větví). Všech 112 testů serveru zelených, typecheck i lint čisté.
- Ruční curl proti reálnému serveru s enginem: nápověda na čerstvé partii vrátila legální
  tah (12→16, HTTP 200), neexistující partie 404, stav po nápovědě nezměněn (turn black,
  engineStatus idle, ongoing).

## Nález ze self-review (opraveno v rámci fáze)
Před reportem jsem pustil nezávislého sub-agenta (čerstvý kontext) na chybové cesty a
kontrakt. Našel reálnou díru v testech: **jádro fáze („nápověda vždy plnou silou =
`undefined`") nebylo přibité žádným testem** — stub enginu argument `strength` ignoroval,
takže regrese na `STRENGTH_BY_LEVEL[record.level]` by prošla zeleně.

Oprava: stub teď zachytává předanou `strength` (callback `onBestmove`) a happy-path test
tvrdí `expect(strengths).toEqual([undefined])`. **Důležité pro zuby:** test zakládá partii
úrovně `beginner` (ne default `professional`) — u profesionála je `STRENGTH_BY_LEVEL`
taky `undefined`, takže by regrese nebyla vidět. Ověřeno: po dočasné záměně produkce na
`STRENGTH_BY_LEVEL[record.level]` test spadne (`{maxDepth:1, carelessness:0.5}` ≠
`undefined`); po vrácení zpět zelený.

## Vědomě neřešené (nízká priorita, read-only kontrakt neporušují)
- **Rozsah try:** `findLegalMove` je ZÁMĚRNĚ mimo `try` (na rozdíl od background
  `runEngineMove`). Reálný `EngineClient` ověří tvar tahu a při pokřivení hodí
  `EngineProtocolError` → 503 ještě před návratem, takže `suggested` špatného tvaru se
  sem nedostane. Kdyby přesto (vlastní `EngineMover` porušující kontrakt), TypeError má
  spadnout jako 500 „neočekávaná chyba", ne se maskovat jako 503 I/O selhání enginu —
  to je správná klasifikace dle projektového pravidla, ne chyba.
- **Obsazení fronty enginu:** nápověda jde do stejné sériové fronty jako tahy na pozadí,
  ale záměrně (kvůli read-only) nenastaví `engineStatus='thinking'`. Když člověk hned po
  žádosti o nápovědu zahraje tah, reálný tah enginu počká, než dopočítá zahozená nápověda
  (latence + promrhaný výpočet). Stav se nemění (invariant drží). Je to věc navazující
  UI fáze — ta má hlídat, aby se nápověda a tah nepřekrývaly (nebo běžící nápovědu rušit).

## Poznámka k dalšímu kroku
Endpoint je level-agnostický: funguje pro libovolnou běžící partii. Gating „ukázat nápovědu
jen ve Výuce" a zvýraznění tahu na desce je čistě klientská záležitost navazující fáze.
Úroveň `Výuka` do `LEVELS`/UI zatím přidaná NENÍ (vědomě mimo rozsah této fáze).

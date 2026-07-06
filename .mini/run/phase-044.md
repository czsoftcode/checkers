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

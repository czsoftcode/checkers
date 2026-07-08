# Phase 68 — Párování výzvou: serverové jádro

**Goal:** Server přes room WS zpracuje životní cyklus výzvy (challenge → přijetí/odmítnutí) a při přijetí vytvoří PvP partii navázanou na oba hráče (dvě lidské barvy, bez enginu), oba dostanou její id; ověřeno integračním testem se dvěma reálnými WS klienty. Klientské UI výzvy a hrany typu „vyzvaný už hraje / odchod vyzvaného během výzvy" jsou vědomě mimo tento řez (navazující řez: UI párování).

## Steps
- [done] Model PvP partie v GameStore
- [done] Engine-cesty se u PvP chovají bezpečně
- [done] Registr výzev + busy stav (modul, unit testy)
- [done] Room WS: protokol výzvy
- [done] Integrační test se dvěma reálnými WS klienty
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 68: Párování výzvou: serverové jádro

## Discussion
# Phase 68 — Párování výzvou: serverové jádro

## Intent
Serverové jádro párování hráčů v místnosti (todo 38), BEZ klientského UI (to je navazující fáze).
Dva už přihlášení hráči (z fáze 67, room WS `/room/ws`) se přes stejný room WS vzájemně vyzvou;
když vyzvaný přijme, vznikne **PvP partie dvou lidí (žádný engine)** navázaná na oba hráče a oba
dostanou její `id`. Ověřeno integračním testem se dvěma reálnými WS klienty (vzor fáze 67).

Partie se v tomto řezu ještě NEHRAJE: routování a autorita tahů PvP je todo 36; konec/vzdání/remíza
PvP je todo 40. Tato fáze vytváří jen substrát (partie existuje, je navázaná na oba session id) a
protokol výzvy.

## Key decisions
- **Barvy v PvP partii:** vyzyvatel dostane ČERNOU a táhne první (v americké dámě začíná černá).
  Vyzvaný dostane bílou. Deterministické, žádné losování. Vyrovnání férovosti (střídání barev)
  je mimo tento řez.
- **Model v GameStore (návrh k realizaci, potvrzeno v diskusi):** dnešní `GameRecord` je celý
  engine-tvaru (`humanColor` + engine = opposite; `maybeTriggerEngine`, resign/draw/hint,
  `engineColorOf`, dto). PvP je JINÝ tvar. Přidat diskriminátor (např. `mode: 'engine' | 'pvp'`),
  pro PvP uložit oba hráče jako barvu→sessionId (`{ black, white }`), a NOVOU metodu
  `GameStore.createPvp(blackSessionId, whiteSessionId)` místo natahování `create` (ta je celá
  ballot/level/engine orientovaná). PvP partie startuje z výchozího rozestavění, bez ballotu,
  bez levelu, `engineStatus` irelevantní.
- **Rozsah ošetření hran — plné, ale s jednou přiznanou hranicí (potvrzeno):**
  - Skupina A (životní cyklus výzvy) se dělá KOMPLETNĚ: odchod vyzyvatele/vyzvaného během čekání
    → výzva zanikne + druhá strana dostane zprávu; přijetí zaniklé výzvy (vyzyvatel se odpojil)
    → `error`, ne pád; křížová výzva (A↔B) i dvojitá výzva (A→B dvakrát) → jasné pravidlo, ne dvě
    partie omylem.
  - „Vyzvaný už hraje": zavést stav **busy** (kdo je v partii). Nastaví se při spárování; v tomto
    řezu se ruší JEN odpojením hráče. Plné zrušení busy při KONCI PvP partie dodá až todo 40
    (konec/vzdání PvP partie zde neexistuje, partie se nedá dohrát → busy-until-disconnect je pro
    současný rozsah funkcí korektní model, ne lež).

## Watch out for
- **`maybeTriggerEngine` NESMÍ nic spustit pro PvP partii** — nemá engine barvu; bez guardu by se
  server pokusil hrát za neexistující engine. Přidat větev `mode === 'pvp'` → no-op.
- **`dtoFor` nesmí spadnout na PvP záznamu** — dnes čte `level`/`humanColor`/`engineStatus`, které
  jsou pro PvP nesmysl. V tomto řezu se dto číst nemusí (test ověří přes `store.get` interně +
  `id` v accept-zprávě), ale GET `/games/:id` na PvP partii nesmí házet. Rozhodnout: buď dto
  rozšířit o `mode`/`players`, nebo PvP nechat jen interní do UI fáze — ať to ale NELŽE a NESPADNE.
- **Resign/draw/hint endpointy jsou engine-závislé** — na PvP partii je zatím neřešíme (todo 40),
  ale musí PvP záznam bezpečně odmítnout (ne 500). Ověřit unhappy path: co vrátí `/games/:id/resign`
  na PvP id.
- **Session id je per-socket, umírá při odpojení** (stabilní identita/reconnection = todo 42).
  PvP partie se váže na session id, které při dropu zaniknou. Pro tento řez (jen vznik, žádné
  hraní, žádná reconnection) OK, ale binding je do 42 křehký — napsat do reportu.
- **Registr čekajících výzev** potřebuje vlastní stav (výzva má id, vyzyvatele, vyzvaného, stav).
  Na `close` socketu: zrušit VŠECHNY výzvy, kde je hráč vyzyvatel i vyzvaný, a uvědomit druhou
  stranu. Pozor na pořadí a na to, aby zrušení nespadlo na už zavřeném druhém socketu (readyState
  guard, fire-and-forget jako `presence.broadcast`).
- **Izolace od herní WS:** výzvy tečou po room WS `/room/ws`; herní stav po `/games/:id/ws`.
  Po vzniku partie server jen vrátí `gameId` oběma v accept-zprávě; klient (další fáze) si otevře
  `/games/:id/ws` sám. Odběratel herní WS nesmí dostat nic z místnosti a naopak (ověřit v testu).
- **Nevalidní/neúplné zprávy protokolu výzvy** (chybí target, neznámý typ, cizí challenge id,
  přijetí vlastní výzvy) → `error`, socket drží (stejný kontrakt jako join ve fázi 67:
  tvarová kontrola PŘED přístupem k polím, pozor na `JSON.parse('null')`).
- **Zprávy před join** (hráč posílá `challenge`, aniž vstoupil do místnosti) → `error`, ne pád.
- **Test má mít zuby:** ověřit i reject cestu, přijetí zaniklé výzvy (vyzyvatel odpojen → error, ne
  partie), křížovou/dvojitou výzvu, a že `store.get(gameId)` je PvP-tvaru s oběma session id.

## Run report
---
phase: 68
verdict: done
steps:
  - title: "Model PvP partie v GameStore"
    status: done
  - title: "Engine-cesty se u PvP chovají bezpečně"
    status: done
  - title: "Registr výzev + busy stav (modul, unit testy)"
    status: done
  - title: "Room WS: protokol výzvy"
    status: done
  - title: "Integrační test se dvěma reálnými WS klienty"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Fáze 68 — report z auto session

## Co je hotové
Serverové jádro párování výzvou. Přítomní hráči v místnosti (`GET /room/ws`) se přes
tytéž WS zprávy vyzvou; při přijetí vznikne **PvP partie dvou lidí bez enginu**
navázaná na oba (barvou → session id) a oba dostanou její `id` + svou barvu
(vyzyvatel černá a táhne první, vyzvaný bílá). Ověřeno integračním testem se dvěma
reálnými `ws` klienty.

**Protokol (room WS):** klient→server `challenge{targetId}` / `accept{challengeId}` /
`reject{challengeId}`; server→klient `challenged` / `challenge-accepted{gameId,color,
opponentId}` / `challenge-rejected` / `challenge-cancelled` / `error`.

**Ošetřené hrany (plné, dle diskuse):** sebe-výzva, výzva na/od hrajícího (busy),
dvojitá (A→B 2×) i křížová (A→B a B→A) výzva → `error`; odchod během čekání zruší
výzvy a uvědomí protějšek `challenge-cancelled`; pozdní přijetí zaniklé výzvy →
`error`, ne partie; nevalidní/neúplné zprávy protokolu (chybí target/challengeId,
`JSON.parse('null')`, pole, primitivum, zpráva před join) → `error`, socket žije.

## Klíčová rozhodnutí v kódu
- **Model:** `GameRecord`/`StoredGame` jsou teď **diskriminovaná unie** `mode:
  'engine' | 'pvp'` (ne nullable pole). Engine varianta drží `level/ballotIndex/
  humanColor`, PvP varianta `players{black,white}`. `toRecord` má overloady, aby
  `create`→Engine, `createPvp`→PvP, `get`→union. Diskriminátor je zdroj pravdy —
  všechny engine cesty čtou engine-pole až po zúžení přes `mode`.
- **Bezpečnost engine cest:** PvP záznam se nesmí propašovat do engine logiky. REST
  endpointy (GET /games/:id, /moves, /resign, /offer-draw, /hint) PvP odmítnou
  novým 409 `pvp_not_playable` (partie JE → ne 404; není to chyba serveru → ne 500).
  `engineColorOf`/`dtoFor`/`maybeTriggerEngine`/`runEngineMove`/`resign`/`acceptDraw`
  mají navíc guard `mode==='pvp'` (nedosažitelné throw-assertions / no-op) jako
  obranu proti tichému zkreslení.
- **Registr výzev** je samostatný čistý modul (`challenges.ts`) bez transportu; WS
  route jen serializuje a rozesílá. Busy stav (kdo hraje) žije zde, ruší se JEN
  odchodem (konec PvP partie = todo 40).

## Nezávislý self-review (čerstvý kontext, sub-agent)
Adversariální průchod unhappy path registru, WS handleru, unie i REST guardů.
**Žádný kategorie-A (self-catchable) bug.** Ověřeno čtením + během (typecheck, testy).
Potvrzené seamy mimo řez (bez pádu, dokumentované):
- **B1 — busy po spárování:** když se A+B spárují a jeden odejde, odchozí se uvolní,
  ale **druhý zůstane busy** navázaný na mrtvé session id, dokud se sám neodpojí.
  Vědomě „busy-until-disconnect" (viz discuss); uvolnění soupeře při odchodu/konci
  partie dodá **todo 40**. Test to explicitně fixuje. Uživatelsky málo bolí, protože
  PvP se zatím nedá hrát (stuck hráč stejně jen reloadne → odpojí se → uvolní).
- **B2 — PvP herní WS je němý:** `/games/:id/ws` jde odebrat i pro PvP partii, ale
  nic se do ní nebroadcastuje (žádná mutace) → odběratel nedostane nic, žádný pád.
  Vlastní PvP dto/push přijde s hraním (todo 36).

## Křehké/otevřené (napsat do watch-out pro navazující fáze)
- **Session id je per-spojení** a po odpojení zaniká (stabilní identita/reconnection
  = todo 42). PvP partie se váže na id, která při dropu mizí → binding je do 42 křehký.
- **Autorita tahů (todo 36)** zatím neexistuje: PvP partie je jen substrát, hrát ji
  přes REST nejde (`pvp_not_playable`). Tah/konec/vzdání PvP = todo 36/40.
- **B1 výše** je hlavní funkční dluh, který todo 40 musí uzavřít.

## Ověření (mechanické)
- `pnpm -r test` → vše zelené; server 266 testů (25 souborů), z toho nové
  `challenges.test.ts` (17), `challenge-ws.test.ts` (6 reálných WS scénářů),
  `pvp-endpoints.test.ts` (6), rozšířený `store.test.ts` (createPvp + PvP throw).
- `pnpm typecheck` (celé monorepo) čisté, `pnpm lint` čisté.
- Regrese engine cest: všech 235 původních server testů + M3 brána enginu prošly
  beze změny (unie nerozbila člověk-vs-engine tok).

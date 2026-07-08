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

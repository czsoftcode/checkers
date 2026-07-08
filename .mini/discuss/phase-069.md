# Phase 69 — Místnost: vstup a přítomní

## Intent
Zviditelnit dosavadní serverovou multiplayer vrstvu (fáze 66-68) v prohlížeči.
První řez: úvodní obrazovka MÍSTNOSTI. Hráč zadá přezdívku, klient se připojí přes
`/room/ws`, pošle `join{nick}` a zobrazí ŽIVÝ seznam přítomných (přibývají/ubývají).
Párování výzvou a otevření partie jsou VĚDOMĚ mimo tento řez (navazující fáze).

Stav kódu, ze kterého se vychází:
- Server má protokol místnosti hotový (app.ts route `/room/ws`, presence.ts). Klient→server:
  `join{nick}`. Server→klient (`RoomServerMessage`): `roster{players}` (jen joinerovi, VČETNĚ jeho
  samotného), `joined{player}` (ostatním), `left{player:{id}}` (ostatním), `nick-taken{suggestion}`,
  `error{message}`. Při obsazené přezdívce socket NEzavírá → jde poslat `join` znovu.
- Na klientu ZATÍM žádný WebSocket kód není — i dnešní deska běží přes REST polling (WS z fáze 66
  klient nepřevzal, to je jiný řez). Tady se staví PRVNÍ WS klient v této codebase.
- HTTP klient (`server-client.ts`) jezdí na relativních URL; WS URL se musí odvodit z `window.location`
  (ws/wss + host).

## Key decisions
- **Routing**: MÍSTNOST se stává úvodní obrazovkou. Z ní tlačítko „Hrát proti počítači" mountuje
  dnešní `app-shell` (sólo vs. engine). Dnešní `main.ts` dnes mountuje app-shell rovnou → přibude
  přepínač obrazovek (lobby ↔ deska). Přepínač udělat čistě, ne nalepit.
- **„Hrát proti počítači" NEvyžaduje přezdívku** — je to nezávislá sólo cesta. Dostupná i bez vstupu
  do místnosti.
- **Odchod z místnosti do sóla ZAVŘE room WS** (nejsi v místnosti, dokud hraješ sólo); po návratu do
  lobby se připojí znovu. Párování je vypnuté, „přítomný během sóla" teď nemá smysl.
- **Obsazená přezdívka (`nick-taken`)**: ukázat serverem navrženou volnou variantu a nechat uživatele
  POTVRDIT nebo PŘEPSAT (ne použít automaticky). Server socket drží → `join` se pošle znovu.
- **Přezdívka se pamatuje** v LocalStorage a předvyplní (analogie `LEVEL_STORAGE_KEY` v app-shell).
- **Odpojení WS** (restart serveru, výpadek sítě): zobrazit „odpojeno" + tlačítko „připojit znovu"
  (ruční). Auto-reconnect NE (patří k reconnection = todo 42). Bez ošetření by roster vypadal, že
  všichni odešli.
- **Injektovatelná WebSocket továrna** (jako `fetchImpl` v `createHttpClient`), ať jde room-klient
  ověřit unit testem s fake WS bez reálného spojení.

## Watch out for
- **`join` poslat PRÁVĚ JEDNOU na spojení** — server na druhý join vrátí `error` „Už jsi v místnosti".
- **Kdo jsem v rosteru**: `roster` NEobsahuje „ty jsi X". Server na úspěšný join nemění zadanou
  přezdívku (jen ji validuje/trimuje). Vlastní záznam zvýraznit porovnáním na (trimnutou) přezdívku,
  kterou klient úspěšně poslal. Ověřit, že server nick netransformuje jinak než trim (jinak by se
  „ty" nezvýraznilo).
- **Model rosteru**: `roster` = nastav celý seznam; `joined` = přidej; `left{id}` = odeber podle `id`.
  Držet po `id` (přezdívka je jen jmenovka).
- **Neznámé typy zpráv IGNOROVAT** (dopředná kompatibilita — challenge zprávy přijdou v další fázi),
  ne spadnout.
- **CSP (globální pravidlo uživatele)**: žádné inline styly ani skripty. Lobby stylovat třídami v
  `styles.css`.
- **WS URL**: odvodit z `location` (`wss:` pro https, jinak `ws:`), ne natvrdo. Otestovat přes
  injektovanou továrnu.
- **Unhappy path k projití v self-kontrole**: prázdná/dlouhá přezdívka (`error`/`invalid` z presence),
  `nick-taken` + opakování, spojení spadne PŘED joinem i PO něm, server neběží (WS `onerror`/`onclose`),
  rychlý reload (starý socket se na serveru zavře → `left`), přepnutí do sóla a zpět (WS se zavře a
  znovu otevře bez duplicit v rosteru).
- **Úklid při dispose/přepnutí obrazovky**: zavřít WS a odregistrovat listenery, ať nezůstane zombie
  spojení ani listener pushující do zahozeného DOM.

# Phase 69 — Místnost: vstup a přítomní

**Goal:** Web klient dostane úvodní obrazovku místnosti: hráč zadá přezdívku, připojí se přes /room/ws a v reálném čase vidí seznam přítomných hráčů (přibývají/ubývají), včetně ošetření obsazené přezdívky a odpojení; párování výzvou a otevření partie jsou vědomě až navazující řez.

## Steps
- [done] Room WS klient: spojení, parsing, roster (modul + testy)
- [done] Lobby: pole přezdívky, vstup, perzistence, nick-taken
- [done] Lobby: seznam přítomných + stav spojení + připojit znovu
- [done] Přepínač obrazovek + Hrát proti počítači (main.ts)
- [done] Ruční ověření (dvě záložky) + CHANGELOG + nezávislý self-review

## Auto-commit
- Phase 69: Místnost: vstup a přítomní

## Discussion
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

## Run report
---
phase: 69
verdict: done
steps:
  - title: "Room WS klient: spojení, parsing, roster (modul + testy)"
    status: done
  - title: "Lobby: pole přezdívky, vstup, perzistence, nick-taken"
    status: done
  - title: "Lobby: seznam přítomných + stav spojení + připojit znovu"
    status: done
  - title: "Přepínač obrazovek + Hrát proti počítači (main.ts)"
    status: done
  - title: "Ruční ověření (dvě záložky) + CHANGELOG + nezávislý self-review"
    status: done
verify:
  - title: "Vizuál lobby ve dvou reálných záložkách prohlížeče"
    detail: "Spusť `pnpm --filter @checkers/server start` a `pnpm --filter @checkers/web dev`, otevři dev URL ve DVOU záložkách. Ověř očima: (a) vzhled karty místnosti, čitelnost, mobil; (b) v jedné vstoupíš, ve druhé pod jiným nickem → v obou roster přibude/ubude živě, „(ty)" sedí; (c) obsazený nick nabídne variantu; (d) zabij server → „odpojeno“ + „Připojit znovu“, po restartu serveru reconnect funguje; (e) „Hrát proti počítači“ → deska, tlačítko „Do místnosti“ je v ŘADĚ ovládání (vedle Nová hra / Vzdávám hru) a na mobilu se zalomí jako ostatní → zpět do lobby. Logiku i drátový kontrakt jsem ověřil mechanicky (viz níže), tohle je čistě vizuál/UX, který z tohoto prostředí nejde (automatizace cílí na TVŮJ prohlížeč, ne na localhost sandboxu)."
---

# Phase 69 — report z auto session

## Co je hotové
Webový klient se nově otevírá do MÍSTNOSTI, ne rovnou do desky. Nové soubory:
- `packages/web/src/room-client.ts` — WS klient místnosti (spojení, drátový kontrakt, roster model, self-detekce, connect-timeout, dispose).
- `packages/web/src/lobby.ts` — obrazovka (pole nicku + perzistence, roster, stavy připojení, nick-taken, odpojení + reconnect, „Hrát proti počítači").
- `packages/web/src/main.ts` — přepnutý na přepínač obrazovek lobby ↔ deska (dispose předchozí PŘED výměnou DOM).
- `packages/web/vite.config.ts` — přidán WS proxy `/room` (`ws: true`), jinak by se lobby lokálně nepřipojilo.
- `packages/web/src/styles.css` — `.lobby-*` a `.back-to-room-btn` (bez inline stylů, CSP).
- Testy: `test/room-client.test.ts` (16), `test/lobby.test.ts` (13).

Rozsah držel dohodu z discuss: párování výzvou a hraní PvP jsou VĚDOMĚ mimo tento řez.

## Co jsem ověřil mechanicky (ne jen happy path)
- **Drátový kontrakt proti REÁLNÉMU serveru** (dva WS klienti přes Node global WebSocket): `join → roster{players:[{id,nick}]}`, `nick-taken{suggestion}`, `joined{player:{id,nick}}`, `left{player:{id}}` (BEZ nick), `error{message}`. Moje ručně kopírované tvary sedí přesně — 8/8 kontrol prošlo.
- **Dev proxy Vite** (http `/games` → 201 i ws `/room/ws` → roster) skrz `localhost`/IPv6. Config funguje.
- 271 testů zelených, typecheck čistý, eslint čistý, `vite build` projde.
- Unhappy path v testech: nevalidní JSON, neznámý typ (zprávy výzev z další fáze), tvarově vadný roster/hráč, prázdný nick, opakovaný join po úspěchu (server by odmítl), reconnect, pád spojení před i po vstupu, dispose + pozdní zpráva (zuby na nulování handlerů), connect-timeout.

## Nezávislý self-review (čerstvý sub-agent) — a co jsem podle něj OPRAVIL
Sub-agent našel jeden STŘEDNÍ nález: stav „Připojuji…" mohl uváznout navěky (zamčené pole, žádná zpětná vazba), deterministicky když server pošle tvarově vadný `roster` (parser ho tiše zahodí). To porušuje projektové pravidlo „žádný tichý false-success/hang". **Opraveno** jedním mechanismem — connect-timeout v `room-client.ts`: po každém odeslání `join` běží limit (výchozí 12 s); definitivní odpověď serveru (roster/nick-taken/error) ho zruší, jinak se spojení shodí a ohlásí `onDisconnected` → UI se dostane z „Připojuji…" ven a jde zkusit znovu. Pokrývá i mrtvé (half-open) spojení. Přidány 4 testy (fake timery).
Dále opraveny dvě drobnosti z review: (2) hláška odpojení rozlišuje „nepodařilo se připojit" (pád před vstupem) vs „přerušilo" (po vstupu); (3) předvyplněná přezdívka z LocalStorage se ořízne na max délku. Zuby na nulování handlerů po dispose doplněny samostatným testem.
Ověřeno bez nálezu (self-review): cross-module kontrakt, „kdo jsem" (case-insensitive, unikátnost drží server), dvojklik na Vstoupit/Reconnect, přepínač sólo↔místnost bez zombie WS/dvojitých listenerů, CSP (žádné inline style/onclick), úzký try/catch.

## Poznámky / co zůstává mimo řez
- **Vizuální/UX kontrola ve dvou reálných záložkách** je jediná věc, kterou jsem NEmohl udělat sám — viz `verify` výš. (Původně bylo tlačítko návratu fixní v rohu; na žádost uživatele přesunuto do řady ovládání `.controls` ve skořápce jako „Do místnosti", ať na mobilu sedí — dědí responzivní styl ostatních tlačítek.)
- Sub-agent upozornil (mimo rozsah): `vite.config.ts` proxuje `/games` BEZ `ws:true`, přestože `/games/:id/ws` je WS (fáze 66). Dnes nevadí (deska jede přes REST polling), ale až deska přejde na WS push, dev proxy ho neprotáhne. Kandidát na todo.
- Odchod z místnosti do sóla room WS ZAVŘE (v místnosti nejsi, dokud hraješ sólo) — vědomé rozhodnutí z discuss, párování je stejně vypnuté.

Žádný ADR-hodný křižovatkový moment (rozhodnutí padla v discuss). `/mini:decision` netřeba.

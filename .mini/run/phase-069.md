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

---
phase: 106
verdict: done
steps:
  - title: "room-client: pridat connect/enter + stavy"
    status: done
  - title: "i18n: klice predsin a modal (cs/en)"
    status: done
  - title: "lobby.ts: form-first predsin a Vstoupit"
    status: done
  - title: "Modal prichozi vyzvy misto seznamu"
    status: done
  - title: "Migrace ws testu na connect/enter"
    status: done
  - title: "Odstranit legacy join (klient + server)"
    status: done
verify:
  - title: "Vizuál a UX form-first předsíně a modalu výzvy v reálném prohlížeči"
    detail: "Ověřeno mechanicky (jsdom testy + build), ale ne okem: rozvržení hlavičky místnosti (přezdívka vlevo + Odpojit vpravo, .lobby-room-header), sbalený akordeon v předsíni (počty v hlavičkách jako jediný indikátor obsazenosti), vzhled modalu výzvy (.modal-overlay/.modal-dialog s Přijmout/Odmítnout). Doporučuju /mini:verify se dvěma prohlížeči: oba přistanou v předsíni, uvidí obsazenost 4 lobby, vstoupí do téže, vyzvou se modalem a odehrají; třetí výzva na obsazeného → „už hraje"; americký tok."
---

# Phase 106 — report z auto session

## Co se udělalo
Klient přešel na protokol z fáze 105 (`connect{nick}` = předsíň bez členství → `enter{variant}` = vstup do lobby). Vstupní obrazovka a akordeon jsou teď JEDNA form-first obrazovka (view `connected` pokrývá předsíň i členství). Příchozí výzva se ukazuje jako **modal** místo řádku v seznamu. Legacy `join` je **pryč z klienta i serveru** (room-client, `app.ts` handleJoin + dispatch case, `Lobbies.join`); ws testy včetně `presence.test.ts` přemigrovány na connect/enter. i18n klíče (odpojit, titulek/aria modalu) v cs i en.

## Stav ověření (mechanicky)
- Typecheck čistý, lint čistý, `pnpm -C packages/web build` prošel.
- Testy zelené napříč monorepem: rules 382, cli 24, engine 268, ai 57, **server 199**, **web 614**.
- Reálný tok connect→enter→challenge→hra + „třetí výzva na obsazeného → obsazen" + hratelnost americké i ruské varianty jede přes migrované `challenge-ws`, `variant-lobby-ws`, `pvp-move-ws` (skutečné WS spojení, ne mock).

## Adversariální sub-agent review (čerstvý kontext, dle projektového CLAUDE.md)
Fáze sahá na kontrakt server↔klient, WS vstupní bod i chybové cesty, tak jsem před reportem pustil nezávislý red-team. Našel **jeden reálný defekt** (potvrzený reprodukcí), který jsem opravil:

- **Zaseknutá `myNick` v room-clientu** (`room-client.ts`, handler `lobbies`): výpočet `myNick = myNick ?? pendingNick` fungoval jen na prvním connectu. Po Odpojit + connect JINÝM nickem, který koliduje se jménem reálného hráče v lobby, se `isSelf` spočítalo špatně → `lobby.ts` odvodilo špatné `myVariant` → v předsíni by se poslalo `switch-lobby` (server odmítne) → soft-lock, hráč se nedostane do lobby. **Oprava:** `myNick = pendingNick` bezpodmínečně + reset `myNick = null` v `openSocket`. Přidán regresní test se zuby (padal by před opravou).

Drobnosti od recenzenta, které jsem NEopravoval (zdůvodnění):
- `enter()` nemá vlastní timeout — záměrně konzistentní se `switchLobby` (obojí je operace už připojeného; view je `connected`, žádný spinner k zaseknutí). Tichý drop `enter` na half-open spojení nedá feedback, ale není to hang; do budoucna případně todo.
- Dvojí `enter` závod (kliknu Vstoupit na dvě lobby, než dorazí roster) — server druhý odmítne, skončím ve správné, jen matoucí notice. Kosmetika.
- Doc drift (`connectTimeoutMs`/openSocket zmiňovaly `join`) — opraveno.

## Poznámky / na co dát pozor
- Odstranění `join` je nevratné zúžení protokolu: stálý klient by po `{type:'join'}` dostal `error` „Neznámý typ zprávy" (server default case), ne tichý úspěch — což je žádoucí (jeden pravdivý protokol).
- `presence.test.ts` teď skládá vstup přes helper `joinLobby` = reálné `connect`+`enter` (ne mock), takže testy unikátnosti/validace/scope pořád testují reálný kód.
- Reconnect (pád spojení) i Odpojit vedou do PŘEDSÍNĚ (`connect(lastNick)`), ne auto-re-enter do poslední lobby — dle rozhodnutí z discuss.

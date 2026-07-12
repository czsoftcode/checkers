# Phase 106 — Klient: úvodní předsíň a modal výzvy

**Goal:** Přepnout klienta na protokol z fáze 105 (connect{nick} = předsíň bez členství, enter{variant} = vstup) a sloučit vstupní obrazovku s akordeonem do jedné (nick nahoře + živý akordeon pod ním, vstup do místnosti přes Vstoupit v sekci); příchozí výzvu ukázat jako modal místo řádku v seznamu; odstranit z klienta legacy join a přemigrovat ws testy na connect/enter; i18n texty cs/en. Brána: dva prohlížeče přistanou v předsíni, uvidí obsazenost všech 4 lobby, vstoupí do téže, vyzvou se modalem a odehrají; třetí výzva na obsazeného ukáže obsazen; americký tok zůstává hratelný. Otevřené pro discuss: kdy přesně proběhne connect (potvrzení nicku, prázdný/obsazený nick); přepínač jazyka (rebuild po připojení shodí WS); přezdívka jako label po připojení.

## Steps
- [done] room-client: pridat connect/enter + stavy
- [done] i18n: klice predsin a modal (cs/en)
- [done] lobby.ts: form-first predsin a Vstoupit
- [done] Modal prichozi vyzvy misto seznamu
- [done] Migrace ws testu na connect/enter
- [done] Odstranit legacy join (klient + server)

## Auto-commit
- Phase 106: Klient: úvodní předsíň a modal výzvy

## Discussion
# Phase 106 — Klient: úvodní předsíň a modal výzvy

## Intent
Klientská polovina splitu z fáze 105 (server postavil předsíň + pravidlo výzev). Přepnout web klienta na
nový protokol `connect{nick}` (předsíň bez členství) + `enter{variant}` (první vstup), sloučit vstupní
obrazovku s akordeonem do JEDNÉ (form-first: nick → connect → akordeon pod tím), příchozí výzvu ukázat
jako modal místo řádku v `incomingList`, a UZAVŘÍT dvojitou připojovací cestu z 105 (odstranit legacy
`join` z klienta I serveru + migrovat ws testy na connect/enter). Jen PvP lobby; AIvP (LocalClient) a herní
tok se nemění.

Reálný kontrakt serveru (ověřeno v app.ts po 105):
- `connect{nick}` → úspěch = `{type:'lobbies', ...}` (all-roster snímek), `me.variant=null`. Chyby:
  `error` (prázdný/dvojí připojení) / `nick-taken` (se suggescí).
- `enter{variant}` → echo `{type:'roster', players, variant}` + `joined` ostatním + `lobbies` všem.
  Odmítne: nepřipojen / neznámá varianta / už v lobby.
- `switch-lobby{variant}` (z 103) = člen→člen, zůstává.

## Key decisions
- **Form-first úvod (uživatel).** Nejdřív jen pole přezdívky (+ Enter/tlačítko = `connect`). Po připojení
  se pod ním objeví ŽIVÝ akordeon. Prázdný/obsazený nick se řeší hláškou u pole (server vrací `error`/
  `nick-taken`), akordeon až po úspěchu. NE „akordeon hned, connect tichý".
- **Vstup do místnosti = akordeon, ne samostatné tlačítko.** V předsíni (`myVariant=null`) mají VŠECHNY 4
  sekce tlačítko „Vstoupit" → `enter{variant}`. Po vstupu: MOJE sekce = „Vyzvat", ostatní = „Vstoupit" →
  `switch-lobby` (přechod). Tj. „Vstoupit" mapuje na `enter` z předsíně a na `switch-lobby` z členství.
- **Modal příchozí výzvy = jen tlačítka (uživatel).** Přijmout/Odmítnout; Esc a klik mimo NIC nedělají.
  Server garantuje max JEDNU příchozí výzvu (105), takže modal ukáže vždy právě jednu. Zavře se na:
  Přijmout, Odmítnout, `challenge-accepted` (→ hra), `challenge-cancelled` (vyzyvatel odešel/spároval se
  jinam → seznam prázdný → zavřít). Znovupoužít `.modal-overlay`/`.modal-dialog` (CSP-safe, už v souboru).
- **Legacy `join` pryč z KLIENTA I SERVERU.** 105 nechala `join` jen jako aditivní přechod. 106 ho
  odstraní: klient (room-client) přejde na connect/enter; server smaže `handleJoin`, dispatch case `'join'`
  a `Lobbies.join` (POZOR: nejdřív ověřit, že `Lobbies.join` nemá jiného volajícího než ws case + testy).
  Všechny ws testy (challenge-ws, room-ws, pvp-*-ws) se přepíšou z `join{nick,variant}` na
  `connect{nick}` + `enter{variant}`. Cíl: JEDEN pravdivý protokol, žádná mrtvá cesta.
- **Přepínač jazyka + přezdívka jako label (bez otázky, konzistentní s dneškem).** langSelect jen PŘED
  připojením (rebuild po connectu shodí WS – dnes je langSelect stejně jen v `entry`). Po připojení nick
  jako label „Jsi tu jako X" + možnost odpojit (návrat do form-first).

## Watch out for
- **Stavový automat room-clientu se mění.** Dnes „connected" = přišel `roster` (join uspěl). Nově DVA
  stavy: „připojen/procházím" = přišel první `lobbies` (po connectu, `myVariant=null`), a „člen lobby" =
  přišel `roster` (po enter/switch). `onLobbies` musí fungovat i BEZ členství. Definitivní odpověď na
  `connect` pro connectTimeout = `lobbies`/`nick-taken`/`error` (ne `roster`).
- **Vstup do místnosti přes akordeon má dvě serverové operace** podle stavu: `enter` z předsíně vs
  `switch-lobby` z členství. Snadno se splete → v předsíni poslat `switch-lobby` server odmítne
  („nejdřív se připoj"/„už v lobby") a UX se zasekne. buildSection musí větvit podle `myVariant===null`.
- **Reconnect → předsíň, ne auto-re-enter.** `reconnectBtn` po pádu pošle `connect(lastNick)` → přistane
  v předsíni (browse), NE zpět do poslední lobby. Reconnection do rozehrané partie je mimo (todo 42, V3).
- **AIvP tok se NESMÍ rozbít.** Lobby drží i „hrát proti počítači" (`soloBtn` + variant picker, LocalClient).
  Sloučení obrazovek a přechod na connect/enter se týká JEN PvP části; AIvP entry zůstává funkční.
- **itch varianta lobby** (druhá `createLobby` funkce, ~app kolem ř. 891) je oříznutá (bez PvP, jen modal
  odkaz). Ověřit, že se jí protokolová změna netýká (nemá room WS) – jinak ji nerozbít.
- **Testy s zuby:** migrované ws testy MUSÍ projet reálný tok connect→enter→challenge→hra (ne jen connect),
  vč. „třetí výzva na obsazeného → obsazen" a „americký tok hratelný". Po smazání serverového `join`
  ověřit, že žádný test ani kód `join` nevolá (jinak zelené jen proto, že testují mrtvý mock).
- **Modal nesmí viset ani zmizet potichu.** Otevřít při neprázdném seznamu příchozích, zavřít při
  prázdném; v předsíni (ne-člen) výzva nikdy nepřijde (105 guard) → modal se tam neobjeví.
- **Sub-agent review PŘED reportem** (klientský protokol + smazání serverové cesty + migrace testů = sahá
  na kontrakt server↔klient), viz projektový CLAUDE.md.

## Run report
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

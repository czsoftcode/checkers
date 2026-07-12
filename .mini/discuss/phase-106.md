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

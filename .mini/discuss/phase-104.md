# Phase 104 — Klient: čtyři varianta-lobby (UI)

## Intent
Klientské UI čtyř fixních varianta-lobby jako AKORDEON: nahoře přezdívka, pod ní 4 místnosti (řízeno
registrem variant), rozbalená sekce ukáže roster + akci. Uzavírá todo 59 a celou vlnu variant.

REVIZE po druhé diskuzi (103 už zacommitována jako cec4387): dva předpoklady, na kterých stála první
diskuze 104, se s reálným kódem 103 ROZCHÁZEJÍ a 104 je musí dodělat samo:
- **(a) `variant` v `PvpGameDto` NEEXISTUJE.** Interface `dto.ts:28` i web `server-client.ts:120` pole
  `variant` nemá. Server ho použije jen interně pro `legalMoves` (`dto.ts:53` `rulesetForVariant`), ale
  klientovi neposílá. → 104 přidá pole do DTO.
- **(b) Broadcast rosterů všech 4 lobby NEEXISTUJE.** 103 postavila jedno-členský model: `join{nick,
  variant}` = rovnou dovnitř jedné lobby, roster jen té jedné (`app.ts:293`); `switchLobby` = přesun,
  roster cílové. Žádná zpráva „rostery všech 4". → 104 to dodá (uživatel zvolil „doplnit broadcast").

## Key decisions
- **(b) Broadcast všech rosterů = varianta B1 (kontrakt 103 nedotčen).** Zůstává „člen právě jedné lobby"
  (jak 103 postavila). Server NAVÍC pushuje read-only rostery všech 4 lobby každému připojenému socketu
  (na connect + při každé změně prezence). Akordeon: sekce MOJÍ lobby = roster S tlačítky Vyzvat; ostatní
  3 sekce = roster jen na čtení + tlačítko **Vstoupit** = `switchLobby` (už existuje z 103). NE varianta
  B2 (skutečná „předsíň bez členství" + oddělený enter) — ta by měnila sémantiku `join` z 103 a vracela
  zpětnou kompatibilitu, kterou 103 zavřela.
- **(a) `variant` do `PvpGameDto` (zvoleno jako jednodušší cesta k zvýraznění).** Přidat pole `variant` do
  DTO (server `dto.ts` + web `server-client.ts`), naplnit v `pvpGameToDto` z `state.variant`. Klient:
  `pvp-controller.ts` importuje `rulesetForVariant` a předá ruleset do `nextTargets(...)` (dnes 5 volání
  BEZ rulesetu → defaultuje AMERICKY: `pvp-controller.ts:204,241,341,451,458`). Symetrické s AIvP (D2
  `controller.ts`). NE varianta „odvodit z server legalMoves" — čistší jeden-zdroj-pravdy, ale přepis
  zdroje zvýraznění + asymetrie vůči AIvP; dražší.
- **Vyzvat jen ve své lobby.** Rostery cizích lobby jsou display-only (žádná tlačítka Vyzvat) — jinak by se
  obešla hranice „výzva jen v téže lobby" z 103.
- **i18n:** názvy 4 místností + nové texty (Vstoupit, stavy akordeonu) přes cs/en; názvy variant už z D2.
  Žádné natvrdo řetězce; i18n testy zelené.
- **Rozsah:** SERVER — nový broadcast rosterů všech lobby (`presence.ts` snímek 4 rooms + fan-out všem
  socketům; nový typ zprávy) + `variant` v `PvpGameDto`/`pvpGameToDto` (`dto.ts`). KLIENT — `lobby.ts`
  (akordeon, příjem all-roster snapshotu, tlačítka Vstoupit=switchLobby / Vyzvat jen v mé lobby),
  `room-client.ts` (příjem all-roster zprávy, join/switchLobby jak jsou), `pvp-controller.ts` (variant z
  DTO → ruleset do nextTargets), `i18n.ts`, game-screen protáhne variantu do controlleru.

## Watch out for
- **Nový broadcast je nová cesta → CHCE vlastní test:** vstup/left/switch v lobby A musí aktualizovat
  all-roster pohled klienta připojeného v lobby B. Fan-out O(hráči × 4) na každou změnu prezence — pro
  tenhle projekt triviální, ale je to nový kontrakt, ne kosmetika.
- **Zpětná kompatibilita 103/67-68:** existující `roster`/`joined`/`left` (scoped na jednu lobby) ZŮSTÁVAJÍ
  — klient je pořád potřebuje pro svou lobby (výzvy). Nový all-roster je navíc, ne náhrada. Testy
  challenge-ws / room-ws / pvp-*-ws MUSÍ zůstat zelené; starý klient neznámý typ zprávy ignoruje.
- **Jsi vždy členem jedné lobby** (default american po připojení), není „předsíň, kde nejsem nikde". Pokud
  by uživatel chtěl přesně tu předsíň, je to varianta B2 (mimo tento řez).
- **Rozšíření viditelnosti přezdívek:** dřív nick viditelný jen v rámci jedné lobby, teď všech lobby všem.
  Pro projekt OK, ale je to vědomé rozšíření scope výzev × prezence.
- **`pvp-controller` default american je tichá past:** server je autorita nad legalitou (odmítne nelegální
  tah), takže špatné KLIENT-SIDE zvýraznění „projde" bez pádu — jen UX je rozbité. Proto MUSÍ číst
  `variant` z DTO. Bez pole (a) je deska slepá.
- **Jediný zdroj varianty pro desku = server DTO** (`game.variant`); klient si variantu nedrží zvlášť, ať
  se nerozejde s partií (server autorita).
- **Přepnutí lobby během partie** už 103 odmítá (`isBusy` guard, `app.ts` handleSwitchLobby) — klient jen
  nesmí nabízet Vstoupit/přepínání, když hráč právě hraje (jinak dostane `error`).
- **Sub-agent review** (fáze sahá na kontrakt server↔klient + prezenční broadcast + hranici výzev) — pustit
  nezávislého sub-agenta jako self-review před reportem (viz projektový CLAUDE.md).

# Phase 103 — Server: PvP varianta-lobby (jádro)

## Intent
Serverová část čtyř PvP varianta-lobby: prezence + výzvy + partie + validace tahu podle varianty.
Klientské UI čtyř místností je D3b. Uzavírá server část todo 56 (dto/store validace). Server defaultuje
na american → stávající klient beze změny hraje v americké lobby (žádná regrese).

## Key decisions
- **IDENTITA oddělená od ČLENSTVÍ (uživatel: „jedna přezdívka na program, ne na místnost, příprava na
  budoucí login").** Přezdívka = GLOBÁLNÍ identita, unikátní přes CELÝ server (jeden globální registr
  nicků, NE per-instance). Stále jen přezdížka, ŽÁDNÉ účty/hesla (non-goal držen) — je to jen seam pro
  budoucí login.
- **Členství per lobby (4 instance).** Prezence = registr `Map<VariantId, RoomPresence>` (4 členství);
  vnitřek `RoomPresence` se skoro nemění, ale nick-uniqueness se VYTÁHNE do globálního registru identit.
  Hráč (identita) je v PRÁVĚ JEDNÉ lobby, ale může PŘEJÍT do jiné (server op switchLobby) BEZ ztráty
  přezdívky/session. Cross-variant výzva padne přirozeně (vyzývaný není v lobby vyzyvatele → has() false).
- **DVOUÚROVŇOVÝ MODEL připojení/vstup (REVIZE po discuss fáze 104 – akordeon UI).** NE „join nese
  variantu = rovnou vstup do jedné lobby". Místo toho:
  - **Připojení = identita + PROCHÁZENÍ:** klient se připojí, zaregistruje globální přezdívku a dostane
    rostery VŠECH 4 lobby (broadcast). Není členem žádné, není k vyzvání.
  - **Vstup (`vstoupit`/`enter(variant)`) = ČLENSTVÍ:** hráč se stane členem JEDNÉ lobby → objeví se v
    jejím rosteru, jde ho vyzvat. Vstup do B ho odhlásí z A (členství právě jedno). Přechod = `switchLobby`.
  - Stávající klient (posílá jen `join{nick}` bez vstupu) → zpětně kompat.: buď rovnou americká lobby,
    nebo browse-only; MUSÍ zůstat funkční (americké PvP testy zelené). Detail kompat. v do.
- **(a) Varianta v `PvpGameDto` KE KLIENTOVI (přidáno po discuss 104).** Herní stav pushnutý klientovi
  MUSÍ nést `variant`, aby si klient (pvp-controller) počítal zvýraznění tahů ve SPRÁVNÉ variantě
  (dnes `nextTargets` defaultuje americky → v ne-americké partii by UI zvýraznilo špatné targety; server
  by je odmítl, ale UX špatné). Bez tohoto pole je D3b (klient) slepý na variantu.
- **(b) Broadcast rosterů VŠECH lobby procházejícímu klientovi (přidáno po discuss 104).** Akordeon v D3b
  ukazuje „kdo je kde" ve všech 4 lobby před vstupem → server rostery všech lobby vystaví/pushuje.
- **Validace tahu = server autorita (todo-56 zbytek).** `dto` `findLegalMove`/`legalMoveDtos` dostanou
  variantu z herního záznamu → `rulesetForVariant` → `legalMoves(position, ruleset)`. `createPvp(challenger,
  challenged, variant)` nastaví GameState.variant; `store.applyMove` je pak už správný přes `advanceState`
  (čte state.variant z D0). Rematch DĚDÍ variantu staré partie.
- **PDN archiv zapíše variantu** (tag Event nebo Variant; přesný formát v do). Vize: „do PDN se zapisuje
  i varianta".
- **Nezávislý sub-agent review v plánu** (velká změna serverového kontraktu + bezpečnostní hranice).

## Watch out for
- **Nick-uniqueness JEDEN globální registr, ne 4× per-instance** — jinak by „Karel" mohl být v každé
  lobby zvlášť, což odporuje „jedna přezdívka na program". Identita (nick→session id) globální; členství
  (v které lobby) zvlášť.
- **Validace tahu je bezpečnostní hranice.** `dto.findLegalMove` MUSÍ použít ruleset varianty záznamu —
  jinak server přijme nelegální tah v dané variantě (klient je nedůvěryhodný). Toto je uzavření todo 56.
- **Zpětná kompatibilita:** stávající klient posílá join BEZ varianty → americká lobby; stávající
  PvP/room-ws testy (challenge-ws, room-ws, pvp-*-ws) MUSÍ zůstat zelené.
- **Přechod mezi lobby za běhu PARTIE:** hráč ve hře by neměl přejít do jiné lobby (jako se nemění
  varianta uprostřed hry). Hrana pro plan/do: switchLobby odmítnout / vyžadovat, že hráč není v aktivní
  partii.
- **Rematch dědí variantu** — createPvp v rematch cestě (app.ts:741) musí dostat variantu STARÉ partie,
  ne default american.
- **Roster nemusí nést variantu per-hráč** (v jedné lobby jsou všichni stejné varianty), ale klient
  (D3b) musí dostat potvrzení, do které lobby vstoupil (echo varianty v odpovědi na `enter`).
- **(a) PvpGameDto MUSÍ nést variantu** — jinak je klientská PvP deska slepá na variantu a zvýrazňuje
  americké tahy v ne-americké partii (D3b to čte do pvp-controller). Snadno se zapomene, protože server
  je stejně autorita nad legalitou; ale UX zvýraznění je klient-side.
- **(b) Broadcast všech rosterů** procházejícímu (nevstoupenému) klientovi je NOVÁ schopnost oproti
  dnešní jedné místnosti (dnes roster = jen ta jedna). Prezenční vrstva musí umět „rostery všech lobby".
- **Kompatibilita dvouúrovňového modelu:** dnešní klient posílá `join{nick}` a čeká `roster`. Nová cesta
  (připojení → browse → enter) NESMÍ rozbít stávající room-ws testy; buď starý join mapovat na
  „american enter", nebo držet obě cesty. Rozhodnout v do; testy challenge-ws/room-ws/pvp-*-ws zelené.

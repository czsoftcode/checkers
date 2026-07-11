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
- **join nese variantu (default american, zpětně kompat.).** Stávající klient bez varianty → americká
  lobby. Klient volí variantu před joinem (jako přezdívku); plné přepínání v UI je D3b, ale server op
  pro přechod mezi lobby patří sem (D3b ho jen zavolá).
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
  (D3b) musí dostat potvrzení, do které lobby vstoupil (echo varianty v join odpovědi).

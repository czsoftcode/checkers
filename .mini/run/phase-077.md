---
phase: 77
verdict: done
steps:
  - title: "Store: PvP vzdání a stav nabídky remízy"
    status: done
  - title: "Room WS: zprávy resign / draw-offer / accept / reject"
    status: done
  - title: "Room-client: odeslání a příjem remízových zpráv"
    status: done
  - title: "PvP UI: tlačítka vzdát/remíza + příchozí nabídka"
    status: done
  - title: "Konec PvP partie: výsledek + návrat/nová hra"
    status: done
  - title: "Ověření: build + typecheck + lint + testy"
    status: done
verify:
  - title: "Ruční e2e dvou hráčů: vzdání a remíza v reálném prohlížeči"
    detail: "Testy pokrývají logiku (store, WS integrace přes reálné ws klienty, DOM klienta), ale ne skutečné dva prohlížeče. Ověř lidsky: A nabídne remízu → B vidí MODAL s Přijmout/Odmítnout → přijetí ukončí partii oběma remízou; odmítnutí → A dostane hlášku a hraje se dál; A se vzdá (MODAL Ano/Zrušit) → B vyhraje. A že tah otevřený modal zavře."
  - title: "Vzhled modalů vzdání/remízy (i na mobilu)"
    detail: "Dotazy na vzdání a příchozí nabídku remízy jsou teď MODALY (překryv přes viewport, znovupoužívá .modal-overlay/.modal-dialog jako výsledkový modal u AI). Ověř opticky vycentrování nad deskou a čitelnost tlačítek na úzkém displeji. U nabídky remízy Esc/klik mimo ZÁMĚRNĚ nezavírá (nutná volba); u vzdání Esc/klik mimo = Zrušit."
---

# Fáze 77 — report z auto session

## Co je hotové
Celé todo 40 v jedné fázi: v PvP partii jde **vzdát** i **nabídnout remízu druhému člověku**, server je jediná autorita.

**Server (autorita):**
- `GameStore` má PvP-vědomé metody `resignPvp` / `offerDrawPvp` / `acceptDrawPvp` / `rejectDrawPvp` + stav `drawOfferBy` na PvP záznamu. Každá ověří účastníka (session ∈ `players`, barvu si server dopočte z `players`, klientovi nevěří) a že partie běží; vrací diskriminovaný výsledek (`not-found` / `not-participant` / `already-over` / `offer-exists` / `no-offer`). Tah i vzdání **maží** visící nabídku (tah = implicitní odmítnutí).
- Room WS má nové typy zpráv napojené na store; identita hráče výhradně z `me.id`. Vzdání a přijatá remíza rozešlou terminální `game-state` **oběma přes game hub**; nabídka/odmítnutí signalizují **jen soupeři/nabízejícímu přes room WS** (`draw-offered` / `draw-rejected`). Guard `requirePvpGame` odmítne engine partii PŘED voláním store (store na engine partii hlasitě throwuje – guard ten throw nepustí k WS handleru).

**Klient:**
- `room-client` má odesílací metody + příjem `draw-offered` / `draw-rejected`.
- `lobby` rozšířil most `GameLink` o vzdání/remízu a příchozí signály s **filtrem na `activeGameId`** (zbloudilý signál ze staré partie neprojde).
- `game-screen` má tlačítka „Nabídnout remízu" a „Vzdát se". Tři MODALY (na přání – překryv přes viewport, znovupoužívá `.modal-overlay`/`.modal-dialog`, žádný nativní `confirm()`, který blokuje WS): (a) potvrzení vzdání „Opravdu se vzdát?" (Esc/klik mimo = Zrušit), (b) příchozí nabídka „Soupeř nabízí remízu" (Esc/klik mimo nic, nutná volba), (c) VÝSLEDEK partie „Vyhrál jsi!/Prohrál jsi./Remíza." s tlačítky **Odveta** a **Konec** (nedismissovatelný – obojí odvede do místnosti).
- **Konec + uvolnění busy (dokončení „konec → nová hra"):** po dohrané partii zůstávali oba hráči na serveru `busy` (a nemohli hrát s nikým jiným) – dřív se busy rušil jen odpojením (přímo poznámka v `challenges.ts`, „todo 40"). Přidáno: WS zpráva `leave-game`, `ChallengeRegistry.release`, a příznak `left` na PvP partii (`markPvpLeft`, atomický). „Konec" = uvolní OBA hráče → do místnosti. Autorita: uvolnit smí jen účastník, jen terminální partii, a nejvýš JEDNOU na partii (pojistka proti uvolnění hráče, co mezitím začal novou hru → dvojité spárování).
- **Odveta jako in-place protokol (na přání uživatele, přepsáno z původního „uvolni + výzva + do místnosti"):** nabízející klikne Odveta a ZŮSTANE na obrazovce (modal „Čekám na odpověď soupeře…", jen Konec). Soupeř dostane na SVÉ obrazovce dotaz Přijmout/Odmítnout. Přijetí → server (autorita) založí NOVOU partii s **prohozenými barvami** (kdo byl černý, je teď bílý) a OBA plynule přejdou do nové hry stávající zprávou `challenge-accepted` – **bez návratu do místnosti**. Odmítnutí / soupeřův Konec → nabízející se vrátí na výsledek s hláškou (může zkusit znovu). Server: `rematchOfferBy` na partii + `offer/accept/declineRematchPvp` (gate: terminální + účastník); nová partie i barvy jsou serverové rozhodnutí; stará partie se po odvetě zapečetí (`markPvpLeft`), busy oba drží dál (přechod partie→partie, žádné okno pro dvojité spárování).

**Testy:** store unit (14 nových větví vč. neúčastníka, dvojí nabídky, vlastní nabídky, tah/vzdání ruší nabídku), integrační WS test přes reálné `ws` klienty a reálný `buildApp` (15 případů, happy i unhappy), room-client (send + příjem + vadný tvar), game-screen DOM (25 případů), lobby most (routing + filtr gameId + odregistrace). Vše zelené; build, `tsc`, `eslint` čisté.

## Nezávislé adversarial review — tři kola, všechny nálezy opraveny
Podle projektových instrukcí jsem pouštěl nezávislé sub-agenty (čerstvý kontext) po každém větším přírůstku.

**Kolo 1 (vzdání + remíza)** — dva klientské bugy při selektivním pádu room WS, opraveno + testy:
1. **Vzdání se zaseklo:** `onResignYes` po `disarmResign()` nevolal `refreshControls()` → tlačítko „Vzdát se" zůstalo zamčené (i v „Zrušit").
2. **Ztracená příchozí nabídka:** `onDrawAccept`/`onDrawReject` schovaly výzvu i když příkaz neodešel → serverová nabídka visela bez UI. Teď se schová jen při úspěšném odeslání.

**Kolo 2 (Konec + uvolnění busy)** — žádná kritická díra; obava o dvojité spárování přes dvojí `leave-game` ověřena jako ošetřená (`markPvpLeft`) a doplněny 2 testovací mezery.

**Kolo 3 (protokol odvety)** — našel **KRITICKOU díru (K1)** + 2 střední, vše opraveno + testy se zuby:
1. **K1 (dvojité spárování):** když nabízející dá Konec (uvolní busy) a soupeř PAK přijme odvetu na mrtvý dotaz, vznikla nová partie, kde NIKDO nebyl busy → třetí hráč mohl oba vyzvat, navíc byl odešlý hráč vtažen zpět. Oprava: `left` gate ve všech odvetových store metodách (`offer/accept/declineRematchPvp` vrací `'gone'`, jakmile kdokoli partii opustil) — server nesmí věřit klientovi, že modal ještě žije.
2. **S1:** soupeřův „Přijmout odvetu" dotaz se nezavřel, když nabízející odešel. Vyřešeno signálem `game-closed` (kolo 4).
3. **S2/D1:** chyba serveru během čekání na odvetu byla neviditelná (za overlayem) → nabízející visel ve „Čekám…". Oprava: chyba ve stavu `rematch-wait` vrátí na výsledek a důvod ukáže v modalu.

**Kolo 4 (game-closed + odebrání back buttonu)** — našel **KRITICKOU regresi** + drobnosti, opraveno + test se zuby:
1. **Regrese: ztráta herního spojení za běhu = uživatel uvázl bez cesty ven.** Odebráním back buttonu jsem zavřel jediný východ pro stav `connLost` (deska mrtvá, vzdání/remíza zamčené, žádný modal) → jen reload. Oprava: při ztrátě spojení se otevře NOUZOVÝ modal s „Zpět do místnosti" (busy na serveru zůstane do timeoutu/reloadu – reconnection je todo 42). Test to hlídá.
2. Zastaralé komentáře u změněného kódu — opraveny.
3. **Ponecháno jako známý úzký závod (todo 42-adjacent):** když nabízející dá Konec v tomtéž okamžiku, kdy soupeřovo přijetí odvety dorazí na server dřív, může být nabízející vtažen do nové partie (`challenge-accepted` dorazí po optimistické navigaci do místnosti). Server stav je konzistentní (žádné zaseknuté busy), jen to jde proti záměru; recovery = vzdát se/Konec znovu. Čistá oprava chce ack na `leave-game`, což je nepřiměřené — patří k reconnection (todo 42).

## Známá omezení (vědomě mimo řez, nenavrhuju teď řešit)
- **Kontrakt řetězcových literálů** typů zpráv je duplikovaný mezi klientem a serverem bez sdílené konstanty a bez end-to-end testu, který by propojil reálný `room-client` s reálným serverem. Je to **vědomé architektonické rozhodnutí projektu** (web ZÁMĚRNĚ nezávisí na balíčku server – viz komentář v `room-client.ts`) a nová zpráva jen následuje existující vzor (`move`/`challenge`/…, taky bez sdílené konstanty). Shodu hlídá ruční e2e. Kdyby jedna strana literál přejmenovala, její vlastní test spadne; nesoulad zavedený rovnou na obou stranách by prošel. Považuju za přijatelné riziko konzistentní se stávající architekturou – zavádět kvůli tomu cross-package závislost by odporovalo doloženému rozhodnutí.
- **Nabídka odpojenému soupeři** (`presence.sendTo` je no-op, když soupeř nedrží room WS): server nabídku uloží a vrátí úspěch, ale soupeř signál nikdy neuvidí a nabízející čeká marně. Bez perzistence/reconnectionu (**todo 42**) a bez timeoutu nečinnosti (**todo 43**) to teď nemá čistou nápravu; degradace, ne pád.
- `activeGameId` v lobby se nikdy nenuluje – bezpečné jen díky odregistraci handlerů v `dispose` herní obrazovky (stejný křehký vzor jako stávající `activeGameErrorHandler`). Zaslouží pozornost, až se bude stavět reconnection.

## Otevřené otázky pro člověka
- Všechny dotazy (vzdání, remíza, výsledek, odveta) jsou MODALY (na přání uživatele). Vlastní HTML overlay, ne nativní `confirm()` (ten blokuje WS event loop). Zbývá optický human check (viz `verify`).
- Odveta je in-place protokol s prohozením barev, bez návratu do místnosti (na přání uživatele). Nabízející čeká na obrazovce; při odmítnutí se vrací na výsledek s hláškou.
- **„Konec" přesune do místnosti OBA hráče** (na přání uživatele): odcházející pošle soupeři signál `game-closed`, ten se taky přesune do místnosti (jinak visel na výsledku a nevěděl, co se děje). Oba jsou uvolnění z busy.
- **Tlačítko „Zpět do místnosti" za běhu partie odebráno** (na přání uživatele): jen se odpojilo z DOM, ale na serveru hráč zůstal `busy` → blokace pro další hru do refreshe (bez reconnectionu se do partie nevrátí). Jediný odchod z běžící partie je teď „Vzdát se"; z dohrané „Konec"/„Odveta".
- **Známé degradace (todo 42/43):** nabídka (remíza/odveta) odpojenému soupeři se tiše ztratí (server ji přijme, soupeř ji přes mrtvý room WS neuvidí) – nabízející čeká, dokud nedá Konec. Čistá náprava je reconnection (todo 42) + timeout nečinnosti (todo 43).

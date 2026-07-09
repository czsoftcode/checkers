# Changelog

Všechny podstatné změny projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/),
verzování se řídí [SemVer](https://semver.org/lang/cs/).

## [Unreleased]

## [0.65.0] - 2026-07-09

### Fixed

- **Na mobilu už ve hře proti počítači nepadá klepnutí na kámen.** Dřív každý
  pravidelný dotaz na server (a načítání nápovědy ve Výuce) na okamžik „zamkl"
  desku a na pomalejší mobilní síti se s tím tvoje ťuknutí často míjelo. Nově výběr
  kamene tyhle dotazy na pozadí neblokují, takže hra proti počítači reaguje na první
  tap stejně spolehlivě jako hra dvou lidí. Zaseknuté spojení navíc už desku
  neuvězní natrvalo – dotazy na pozadí mají časový strop.

### Changed

- **Indikátor „kdo je na tahu" ve hře proti počítači vypadá stejně jako ve hře dvou
  lidí.** Místo kamene v tmavém kroužku se teď vedle desky (na mobilu pod ní) ukazuje
  samotný kámen strany na tahu.

## [0.64.0] - 2026-07-09

### Changed

- **Pozadí herní místnosti se na mobilu (na výšku) přizpůsobí.** Při orientaci na
  výšku se místo `intro.webp` ukáže `intro_mobile.webp`; na šířku zůstává původní
  obrázek. Rozhoduje orientace displeje, ne šířka okna, a přepne se živě při otočení.

## [0.63.0] - 2026-07-09

### Added

- **Výsledek PvP partie ukáže, PROČ hra skončila.** Když se soupeř vzdá, uvidíš
  „Soupeř se vzdal – vyhrál jsi!" místo holého „Vyhrál jsi!" (a když se vzdáš ty,
  „Vzdal ses – prohrál jsi."). Remíza navíc rozlišuje „Remíza dohodou." od „Remíza
  podle pravidel.". Text je v překryvném okně i ve stavovém řádku.
- **Zvuk konce partie i ve hře dvou lidí.** Konec PvP partie teď zahraje stejné
  zvuky jako hra proti počítači: fanfáru při výhře, zvuk prohry a zvuk remízy
  (z pohledu tvé barvy), krátce po dokončení posledního tahu.

## [0.62.0] - 2026-07-09

### Added

- **Úvodní obrazovka Herní místnosti má obrázkové pozadí (`intro.webp`).** Místo
  holého pozadí teď lobby vyplňuje celostránkový obrázek přes celou plochu.
- **Vzdání partie v hře dvou lidí (v3).** V PvP partii jde teď kdykoli za běhu
  kliknout „Vzdát se" (s potvrzením v překryvném okně) – soupeř tím vyhraje. Server
  je autorita: barvu výhry si dopočte sám, vzdát smí jen účastník rozehrané partie.
- **Nabídka remízy druhému hráči (v3).** Místo „AI rozhodne" teď remíza míří na
  živého soupeře: nabídneš remízu a soupeř ji ve svém okně přijme nebo odmítne. Tah
  visící nabídku ruší (bere se jako odmítnutí). Po přijetí končí partie remízou pro oba.
- **Výsledek PvP partie jako překryvné okno s volbou Odveta / Konec (v3).** Po konci
  partie („Vyhrál jsi / Prohrál jsi / Remíza") vyskočí okno, kde si vybereš odvetu, nebo konec.
- **Odveta se stejným soupeřem (v3).** „Odveta" nabídne soupeři novou partii; ty
  zůstaneš na obrazovce a čekáš, soupeř dostane dotaz, a po přijetí obě strany rovnou
  plynule přejdou do nové hry s prohozenými barvami (kdo byl černý, je teď bílý) – bez
  návratu do místnosti.

### Changed

- **„Konec" po dohrané partii přesune do místnosti OBA hráče a uvolní je pro další
  hru.** Dřív po dohrané partii oba zůstávali serverem obsazení, dokud neobnovili
  stránku; teď „Konec" korektně ukončí partii pro oba a vrátí je do místnosti.
- **Z běžící PvP partie se odchází jen přes „Vzdát se".** Tlačítko „Zpět do místnosti"
  za běhu partie zmizelo – jen odpojilo pohled, ale hráč zůstal serverem obsazený a
  blokovaný pro další hru až do obnovení stránky. Při ztrátě spojení se místo něj nabídne
  nouzové okno pro návrat do místnosti.

## [0.61.0] - 2026-07-08

### Added

- **Vícenásobný skok tažením po jednotlivých dopadech na PvP desce (klient, v3).**
  V partii dvou lidí jde teď kámen při skákání pustit i na mezidopad – zůstane tam
  a čeká na další skok (dřív se z mezidopadu vracel a doskákat šlo jen klikáním).
  Rozdělaný skok je vidět opticky: kámen sedí na dopadu, přeskočené kameny zmizí
  a zvýrazní se, kam smí skočit dál. Tažení a klikání jde v jednom skoku míchat.

### Changed

- **Během rozehraného skoku je PvP deska zamčená do jeho dokončení.** Jakmile hráč
  skočí první skok, může už jen doskočit – klik jinam se ignoruje. Je to pojistka
  proti tomu, aby se rozehraný stav rozešel se serverem (deska se srovná zpět jen
  při odmítnutí tahu serverem nebo ztrátě spojení).

## [0.60.0] - 2026-07-08

### Added

- **Tažení kamene myší na PvP desce (klient, v3).** V partii dvou lidí jde teď kámen
  zadat i tažením myší, nejen klikáním – prostý tah, braní i vícenásobný skok (táhne
  se rovnou na koncové pole; skákat po jednotlivých dopadech jde dál klikáním). Při
  tažení se zeleně zvýrazní pole, kam lze kámen pustit. Když server tah odmítne nebo
  spadne spojení, kámen se vrátí na poslední potvrzené pole (i s obnovením sebraných
  kamenů). Tažení je jen myší; dotyk/mobil zůstává na ťuknutí.

## [0.59.0] - 2026-07-08

### Changed

- **PvP herní obrazovka dostala vzhled sladěný s hrou proti počítači.** Ovládání
  (přezdívka soupeře s popiskem „Soupeř:" a tlačítko „Zpět do místnosti") je nad
  deskou, na pozadí náhodný obrázek, celek se vejde do okna bez posouvání. Kdo je
  na tahu ukazuje reálný kámen na boku desky (místo textové hlášky) – při změně
  tahu se mění jen obrázek kamene. Zmizel nadpis „Partie" i řádek „Hraješ za …"
  (barva je jasná z vlastních kamenů dole).

### Fixed

- **Hláška o odmítnutém tahu se v PvP nikdy neukázala.** Když server tah odmítl
  (mimo pořadí / nelegální), hláška se objevila a hned zase zmizela, takže hráč
  neviděl důvod. Nově zůstane zobrazená.
- **Po ztrátě spojení mohla PvP hlášku „Spojení se přerušilo, vrať se do
  místnosti" přepsat opožděná chyba tahu** a nechat desku zamčenou bez vysvětlení.
  Po ztrátě spojení se zastaralé chyby tahu ignorují a hláška zůstane.

## [0.58.0] - 2026-07-08

### Added

- **Hratelná PvP deska v prohlížeči (klient, v3).** Po přijetí výzvy odehrají dva
  lidé celou partii proti sobě v prohlížeči. Herní obrazovka vykreslí desku
  orientovanou podle vlastní barvy (vlastní kameny dole); hráč na tahu zadá tah
  klikáním (výběr kamene → cílové pole, u vícenásobného skoku postupně přes
  všechny dopady). Server je autorita: tah se odešle a deska se pohne až po
  potvrzeném stavu ze serveru (žádné optimistické tahy). Soupeřův tah se objeví v
  reálném čase. Řádek stavu ukazuje, kdo je na tahu, a po přirozeném konci partie
  výsledek (výhra/prohra/remíza). Odmítnutý tah (mimo pořadí, nelegální) se ukáže
  jako hláška a deska zůstane na posledním platném stavu. Při ztrátě spojení se
  deska zamkne a upozorní, místo aby tiše přijímala tahy „do prázdna".

### Fixed

- **Vývojová proxy neprotahovala WebSocket stavu partie.** Dev proxy přeposílala
  cesty `/games` bez podpory WebSocket upgrade, takže herní deska pro partii dvou
  lidí by v dev režimu nedostala stav a zůstala by na „Připojuji k partii…".
  Doplněn `ws: true` na `/games` (projeví se po restartu dev serveru).

## [0.57.0] - 2026-07-08

### Added

- **Výzva a start partie v místnosti (klient, v3).** V herní místnosti jde nově
  kliknutím na přezdívku jiného hráče poslat výzvu na partii. Vyzvaný uvidí
  příchozí výzvu a může ji přijmout, nebo odmítnout; naráz může čekat i víc výzev
  od různých hráčů. Po přijetí OBA hráči přejdou na herní obrazovku se svou barvou
  (vyzyvatel hraje černé a začíná, vyzvaný bílé). Klient ošetří i mezní situace:
  odmítnutí, odchod soupeře během čekání, vyzvání hráče, který už hraje, i dvojitou
  či křížovou výzvu - vždy s čitelnou hláškou, bez vypadnutí z místnosti. Samotná
  herní deska pro partii dvou lidí přijde v další fázi (obrazovka je zatím
  placeholder).

## [0.56.0] - 2026-07-08

### Added

- **Hraní PvP partie na serveru - serverová autorita nad tahem (v3).** Dva
  spárovaní hráči nově mohou odehrát tahy proti sobě. Tah se posílá po témže
  spojení `GET /room/ws` jako přihlášení a párování: `{ type: "move", gameId,
  from, path }`. Server je autorita - přijme tah JEN od hráče, který je
  účastníkem té partie a je právě NA TAHU, a jen pokud je tah legální podle
  pravidel. Kdo tah poslal, server pozná z identity spojení (přiřazené při
  vstupu do místnosti), ne z obsahu zprávy, takže se nikdo nemůže vydávat za
  soupeře. Nelegální tah, tah mimo pořadí, tah v cizí partii i tah před vstupem
  do místnosti server odmítne čistou chybou (`{ type: "error", message }`),
  spojení zůstává a stav partie se nemění. Po platném tahu server rozešle nový
  stav OBĚMA hráčům přes `GET /games/:id/ws`.

### Changed

- **Čtení stavu partie dvou lidí funguje.** `GET /games/:id` nově vrací i stav
  PvP partie (pole `mode: "pvp"` s pozicí, výsledkem a legálními tahy; bez
  položek specifických pro hru proti počítači). Akce vázané na počítač (tah přes
  REST, vzdání, nabídka remízy, nápověda) pro PvP partii dál vracejí čitelné
  odmítnutí `pvp_not_playable`, ne chybu serveru.

## [0.55.0] - 2026-07-08

### Added

- **Úvodní obrazovka místnosti - vstup a přítomní (klient, v3).** Webový klient
  se nově otevírá do MÍSTNOSTI, ne rovnou do desky. Hráč zadá přezdívku, klient
  se připojí přes WebSocket `GET /room/ws` a vidí živý seznam přítomných hráčů,
  který v reálném čase přibývá (`joined`) i ubývá (`left`); vlastní záznam je
  zvýrazněný a označený „(ty)". Obsazenou přezdívku server odmítne a nabídne
  volnou variantu - ta se předvyplní do pole k potvrzení nebo přepsání (socket
  zůstává, stačí poslat znovu). Přezdívka se pamatuje mezi návštěvami. Když
  spadne spojení, obrazovka to řekne a nabídne tlačítko „Připojit znovu" (žádné
  automatické znovupřipojování). Vedle vstupu do místnosti zůstává „Hrát proti
  počítači" - dosavadní sólo hra proti enginu, bez přezdívky; přepnutí na desku a
  zpět do místnosti spolehlivě uklidí předchozí obrazovku (room WS se při odchodu
  do sóla zavře, polling desky se při návratu zastaví). Párování výzvou a samotné
  hraní PvP partie zatím z tohoto UI nejdou - přijdou v navazujících řezech.

## [0.54.0] - 2026-07-08

### Added

- **Párování výzvou - serverové jádro (dvouhráčová verze v3).** Přítomní hráči v
  místnosti se nově mohou vzájemně vyzvat na partii, a to po témže spojení
  `GET /room/ws` jako přihlášení. Klient pošle `{ type: "challenge", targetId }`;
  server (autorita nad párováním) ověří pravidla - nelze vyzvat sám sebe, hráče,
  který už hraje, ani poslat druhou výzvu téže dvojici (ať přímou, nebo
  křížovou) - a vyzvanému doručí `{ type: "challenged", challenge: { id,
  challengerId, challengerNick } }`. Vyzvaný odpoví `{ type: "accept", challengeId }`
  nebo `{ type: "reject", challengeId }`. Při přijetí vznikne **partie dvou lidí
  bez počítače** a oba hráči dostanou `{ type: "challenge-accepted", gameId,
  color, opponentId }` - vyzyvatel hraje černou a táhne první, vyzvaný bílou.
  Odmítnutí pošle vyzyvateli `{ type: "challenge-rejected" }`. Když jeden z
  dvojice během čekání opustí místnost (nebo se spáruje jinam), zaniklé výzvy se
  zruší a jejich protějšek dostane `{ type: "challenge-cancelled" }`; pozdní
  přijetí už neplatné výzvy skončí chybou, ne partií. Je to zatím jen serverová
  vrstva ověřená testem se dvěma reálnými WS klienty; klientské UI výzvy a
  samotné hraní PvP partie (doručování tahů a kontrola, že tah posílá hráč na
  tahu) přijdou v dalších řezech. Engine-orientované REST endpointy (čtení stavu,
  tah, vzdání, remíza, nápověda) na PvP partii zatím vracejí chybu
  `pvp_not_playable` - partie existuje, ale přes tuto cestu se nehraje.

## [0.53.0] - 2026-07-08

### Added

- **Místnost přítomnosti přes WebSocket (základ dvouhráčové verze v3).** Server
  nově drží jednu společnou místnost přítomných hráčů. Klient se připojí na
  `GET /room/ws` a pošle zprávu `{ type: "join", nick: "…" }`; server hráči
  přidělí skryté session `id` (přezdívka je jen jmenovka, na kterou se pak
  navěsí párování), zapíše ho a odpoví mu celým seznamem přítomných
  `{ type: "roster", players: [{ id, nick }, …] }`. Ostatním rozešle příchod
  `{ type: "joined", player: … }` a při odpojení odchod `{ type: "left", … }`.
  Přezdívka musí být unikátní (porovnání bez ohledu na velikost písmen); při
  kolizi server neodmítne natvrdo, ale pošle `{ type: "nick-taken", suggestion }`
  s volnou variantou (`Honza_1`, `Honza_2`, …) a spojení nechá otevřené pro nový
  pokus. Prázdná i příliš dlouhá přezdívka (nad 24 znaků) skončí zprávou
  `{ type: "error", … }`. Je to zatím jen serverová vrstva ověřená testem se
  dvěma reálnými WS klienty; klientská obrazovka místnosti, rozlišení
  volný/hraje, stabilní identita při reconnectu a úklid nečinných spojení jsou
  vědomě mimo tento řez.

## [0.52.0] - 2026-07-08

### Added

- **Real-time push stavu partie přes WebSocket (základ dvouhráčové verze v3).**
  Server umí nově rozeslat aktuální stav partie připojeným klientům přes
  WebSocket na adrese `GET /games/:id/ws` - jakmile se partie změní (tah
  člověka, tah počítače, vzdání i přijatá remíza), všichni, kdo tu konkrétní
  partii sledují, dostanou nový stav okamžitě, místo aby se museli opakovaně
  ptát dotazem (polling). Zpráva má tvar `{ type: "game-state", game: … }`, kde
  `game` je stejný stav jako v REST odpovědích; diskriminátor `type` nechává
  místo pro pozdější typy zpráv (místnost, výzvy). Je to zatím jen serverová
  vrstva ověřená testem se dvěma připojenými klienty: push jde jen účastníkům
  dané partie a nikomu jinému (izolace dvojice). Web klient se v této fázi
  nemění a stav dál polluje - push je aditivní. Vědomě mimo tento řez zůstává
  úklid nečinných spojení a limity velikosti/frekvence zpráv.

- **Rešerše endgame databáze: rozhodovací dokument a měřicí skript.** Než se
  začne stavět endgame databáze (nejtěžší kus v2), vznikl podklad pro
  rozhodnutí `docs/endgame-db.md` postavený na reálných, změřených číslech, ne
  na odhadu. Nový jednorázový skript `scripts/endgame-count.mjs` (není produkční
  kód) přesně spočítá počet legálních pozic pro 2 až 8 kamenů dvěma nezávislými
  metodami, které se musí shodnout (jinak končí chybou), a výsledek křížově
  ověří proti veřejnému číslu projektu Chinook (odchylka 0,84 %). Dokument z
  toho odvozuje paměťovou, diskovou a časovou náročnost a doporučuje **stavět
  vlastní generátor koncovek do 6 kamenů** (na vývojovém stroji se ještě vejde
  do paměti), se stropem: 7 kamenů vyžaduje jiný algoritmus, 8 kamenů je reálné
  jen importem Chinook dat, který je zatím blokovaný nejasnou licencí. Žádná
  změna běhového chování hry - jde čistě o přípravu rozhodnutí.

## [0.51.0] - 2026-07-07

### Added

- **Počítač hraje reálná zahájení i komplexu 12-16 (poslední první tah).** Kniha
  zahájení se rozšířila o **sedmý a poslední** první tah černého – 12-16 – takže
  počítač teď zná všech sedm legálních prvních tahů. Zdrojem je opět kniha
  Richarda Paska „Complete Checkers" (Část 7, sekce 12-16s); každá linie jde do
  zhruba osmi půltahů včetně řetězců braní a výměn a je ověřená proti pravidlům
  hry. Na rozdíl od zahájení 10-15 a 11-16 (kde kniha pokrývala všech sedm
  soupeřových odpovědí) má 12-16 v knize jen **šest** ze sedmi: soupeřova odpověď
  23-19 sice existuje, ale nemá v soutěžním rozlosování (3-move deck) žádnou
  linii, takže po ní počítač z knihy vypadne a dopočítá si tah sám. U odpovědi
  24-19 přechází hlavní linie po sedmi půltazích do zahájení 11-16, tato jedna
  linie je proto o půltah kratší. Na výchozí pozici teď počítač vybírá ze sedmi
  zahájení (11-15, 9-13, 9-14, 10-14, 10-15, 11-16 a 12-16); přednostně stále
  hraje 11-15. Tím je celý první tah černého v knize kompletní.

## [0.50.0] - 2026-07-07

### Added

- **Počítač hraje reálná zahájení i komplexu 11-16.** Kniha zahájení se rozšířila
  o šestý první tah černého – 11-16 – se **sedmi** hlavními odpověďmi soupeře
  (21-17, 22-17, 22-18, 23-18, 23-19, 24-19, 24-20) do zhruba osmi půltahů,
  včetně řetězců braní a výměn. Zdrojem je opět kniha Richarda Paska „Complete
  Checkers" (Část 6, sekce 11-16s); každý tah je ověřený proti pravidlům hry.
  Stejně jako u 10-15 má i 11-16 přesně sedm legálních odpovědí soupeře a kniha
  pokrývá **všechny** – po tomto tahu tedy počítači žádná soupeřova odpověď
  z knihy nevypadne. U odpovědi 24-20 má první ballot v knize jen odkaz na jiné
  pořadí tahů (do zahájení 12-16, které je zatím mimo rozsah), proto se bere
  první 24-20 ballot se samostatnou linií (jako u dřívějších komplexů); u
  odpovědi 21-17 přechází hlavní linie po sedmi půltazích do zahájení 10-15, tato
  jedna linie je proto o půltah kratší. Na výchozí pozici teď počítač vybírá
  z šesti zahájení (11-15, 9-13, 9-14, 10-14, 10-15 a 11-16); přednostně stále
  hraje 11-15. Zbývající první tah (12-16) přijde v další fázi.

## [0.49.0] - 2026-07-07

### Added

- **Počítač hraje reálná zahájení i komplexu 10-15.** Kniha zahájení se rozšířila
  o pátý první tah černého – 10-15 – se **sedmi** hlavními odpověďmi soupeře
  (21-17, 22-17, 22-18, 23-18, 23-19, 24-19, 24-20) do zhruba osmi půltahů,
  včetně řetězců braní a výměn. Zdrojem je opět kniha Richarda Paska „Complete
  Checkers" (Část 4, sekce 10-15s); každý tah je ověřený proti pravidlům hry. Na
  rozdíl od dřívějších komplexů má 10-15 přesně sedm legálních odpovědí soupeře a
  kniha pokrývá **všechny** – po tomto tahu tedy počítači žádná soupeřova
  odpověď z knihy nevypadne. Na výchozí pozici teď počítač vybírá z pěti zahájení
  (11-15, 9-13, 9-14, 10-14 a 10-15); přednostně stále hraje 11-15. Zbývající
  první tahy (11-16, 12-16) přijdou v dalších fázích.

## [0.48.0] - 2026-07-07

### Added

- **Počítač hraje reálná zahájení i komplexu 10-14.** Kniha zahájení se rozšířila
  o čtvrtý první tah černého – 10-14 – se šesti hlavními odpověďmi soupeře (22-17,
  22-18, 23-18, 23-19, 24-19, 24-20) do zhruba osmi půltahů, včetně běžných
  výměn. Zdrojem je opět kniha Richarda Paska „Complete Checkers" (Část 3, sekce
  10-14s); každý tah je ověřený proti pravidlům hry. U odpovědí 23-19 a 24-20 má
  hlavní linie příslušného ballotu v knize jen odkaz na jiné pořadí tahů, proto
  se bere první ballot se samostatnou linií (stejně jako u předchozích komplexů).
  Na výchozí pozici tak počítač vybírá ze čtyř zahájení (11-15, 9-13, 9-14 a
  10-14); přednostně stále hraje 11-15. Zbývající první tahy (10-15, 11-16,
  12-16) přijdou v dalších fázích.

## [0.47.0] - 2026-07-07

### Added

- **Počítač hraje reálná zahájení i komplexu 9-14.** Kniha zahájení se rozšířila
  o třetí první tah černého – 9-14 – se šesti hlavními odpověďmi soupeře (22-17,
  22-18, 23-18, 23-19, 24-19, 24-20) do zhruba osmi půltahů, včetně běžných
  výměn. Zdrojem je opět kniha Richarda Paska „Complete Checkers" (Část 2, sekce
  9-14s); každý tah je ověřený proti pravidlům hry. Na výchozí pozici tak počítač
  vybírá ze tří zahájení (11-15, 9-13 a 9-14); přednostně stále hraje 11-15.
  Zbývající první tahy (10-14, 10-15, 11-16, 12-16) přijdou v dalších fázích.

## [0.46.0] - 2026-07-07

### Added

- **Počítač hraje reálná zahájení i komplexu 9-13.** Kniha zahájení se rozšířila
  o druhý první tah černého – 9-13 – se šesti hlavními odpověďmi soupeře (21-17,
  22-17, 22-18, 23-18, 24-19, 23-19) do zhruba osmi půltahů, včetně běžných
  výměn. Zdrojem je opět kniha Richarda Paska „Complete Checkers" (Část 1);
  každý tah je ověřený proti pravidlům hry. Na výchozí pozici tak počítač
  vybírá z dvou zahájení (11-15 a 9-13); přednostně stále hraje 11-15. Zbývající
  první tahy (9-14, 10-14, 10-15, 11-16, 12-16) přijdou v dalších fázích.

### Changed

- **Testy enginu už nezávisí na obsahu knihy zahájení.** Testy background tahu
  enginu, guardů a archivace dřív mlčky spoléhaly, že jejich úvodní tah není
  v knize; jak kniha roste (9-13), knižní tah by engine v testu zkratoval
  (falešné úspěchy i vypršení). Nově tyto testy stavějí server s prázdnou knihou,
  takže cvičí čistě engine a jsou nezávislé na dalším naplňování knihy.

## [0.45.0] - 2026-07-07

### Added

- **Počítač hraje reálná zahájení komplexu 11-15.** Kniha zahájení už není jen
  ukázková – na plnosilových úrovních počítač v úvodu partie hraje skutečné
  mistrovské linie prvního tahu 11-15 a hlavních odpovědí soupeře (Single Corner,
  Kelso a další) do zhruba osmi půltahů, včetně běžných výměn (braní). Zdrojem je
  volně dostupná kniha Richarda Paska „Complete Checkers"; každý tah je ověřený
  proti pravidlům hry. Když partie z knihy vybočí (soupeř zahraje něco mimo
  pokryté linie), počítač plynule přejde na vlastní počítání jako dřív. Ostatní
  první tahy (9-13, 10-14, 11-16…) a hlubší varianty přijdou v dalších fázích.

### Changed

- **Kniha zahájení umí víc tahů na jednu pozici (interní příprava).** Datový
  model knihy se změnil z „jedna pozice = jeden tah" na „jedna pozice = seznam
  možných tahů", aby do ní v příští fázi šla uložit skutečná teorie zahájení,
  která se větví (na tutéž pozici bývá víc dobrých pokračování). Dřív dvě linie
  sdílející pozici s různým tahem shodily načtení serveru; nově se hromadí jako
  varianty. Na hru to teď nemá žádný vliv – ukázková kniha zůstává stejná a
  počítač vybírá první uloženou variantu. Naplnění reálnými zahájeními přijde
  v další fázi.

## [0.44.0] - 2026-07-07

### Added

- **Kniha zahájení pro silného soupeře (základ).** Na plnosilových úrovních
  (Profesionál, Výuka a Mistrovství po odehrání losovaného zahájení) počítač
  v úvodu partie zahraje tah z knihy zahájení místo vlastního počítání, pokud
  danou pozici v knize má; jinak počítá jako dřív. Oslabené úrovně (Začátečník,
  Pokročilý) knihu nepoužívají, aby zůstaly poražitelné. Zatím jde jen o kostru
  s malou ukázkovou knihou (pár tahů) – naplnění skutečnou teorií zahájení přijde
  v další fázi. Na hru to teď má minimální vliv; jde o základ pro budoucí sílu.

## [0.43.0] - 2026-07-07

### Added

- **Nový vzhled desky a kamenů (dřevo + vyřezávané kameny).** Hrací deska je teď
  dřevěná šachovnice a kameny jsou obrázky (černý a červený, včetně dam s korunkou),
  místo dosavadních jednobarevných polí a kreslených koleček. Kameny jsou o něco
  větší (lépe vyplní pole) a vrhají stín – při přenášení myší je stín výraznější,
  aby působily „zvednuté nad deskou". Když se obrázky z jakéhokoli důvodu nenačtou,
  hra se sama vrátí k původnímu vzhledu (barevná pole a kreslené kameny), takže
  zůstane vždy hratelná.

## [0.42.0] - 2026-07-07

### Added

- **Mistrovství se hraje na dvě kola (zápas).** Na úrovni Mistrovství teď jedna
  partie nestačí – hraje se zápas dvou kol se stejným vylosovaným zahájením, jen
  s prohozenými barvami. V 1. kole máš černé (počítač zahájení otevírá), po jeho
  dohrání se výsledek ukáže a po zavření okna se **samo spustí 2. kolo**, kde máš
  bílé a otvíráš ty. Tím si obě strany zahájení vyzkoušíš z obou pohledů. Po 2. kole
  zápas končí – další partii spustíš tlačítkem „Nová hra". Během zápasu je úroveň
  zamčená na Mistrovství. Když 1. kolo vzdáš, zápas se ukončí (2. kolo se nespustí).
  (Pod kapotou: server umí přijmout konkrétní vylosované zahájení a ověřit ho stejnou
  autoritativní cestou jako vlastní los; neplatný požadavek odmítne, netiší chybu.)

## [0.41.0] - 2026-07-07

### Added

- **Střídání barev mezi partiemi.** Po každé dohrané partii dostaneš na příští hru
  opačnou barvu – jednou hraješ černé, podruhé bílé, a tak dokola. Volba přežije i
  znovunačtení stránky (drží se v prohlížeči). Deska se orientuje podle tvé barvy
  (ty jsi vždy dole), hlášky výhry/prohry i indikátor „kdo je na tahu" se tomu
  přizpůsobí, a když hraješ bílé, počítač (černý) zahájí partii sám.

## [0.40.0] - 2026-07-06

### Added

- **Animace vylosovaného zahájení (Mistrovství).** Na úrovni Mistrovství se teď
  vylosované třítahové zahájení před tvýma očima přehraje: deska nejdřív ukáže
  výchozí rozestavění a pak po jednom sehraje tři půltahy zahájení (včetně
  případného braní) se zvuky pohybu a dopadu kamene. Ballot běží záměrně o něco
  pomaleji než tahy ve hře (~půl vteřiny na tah), ať je dobře sledovatelný; teprve
  po jeho dohrání odehraje počítač (bílý) svůj první tah. Zvuk se probudí výběrem
  úrovně, takže zahájení opravdu zní (po znovunačtení stránky s uloženou volbou
  Mistrovství zůstane kvůli pravidlům prohlížeče potichu, dokud do stránky neťukneš).

## [0.39.0] - 2026-07-06

### Added

- **Nová úroveň Mistrovství (vynucené zahájení).** Ve výběru obtížnosti přibyla
  volba „Mistrovství". Když ji zvolíš, partie nezačíná od výchozího rozestavění, ale
  vylosovaným třítahovým zahájením (3-move ballot) z kurátorovaného seznamu 156
  zahájení – jako na turnajích. Po nasazení zahájení je na tahu počítač (bílý), takže
  **táhne první** (indikátor svítí bíle, počítač přemýšlí). Síla počítače je stejná
  jako u Profesionála; liší se jen vynucené zahájení. Server zůstává autoritou –
  každé nasazené zahájení je ověřeně legální.

## [0.38.0] - 2026-07-06

### Added

- **Nový režim Výuka (nápověda tahů).** Ve výběru obtížnosti přibyla čtvrtá volba
  „Výuka". Když ji zvolíš, počítač hraje jako soupeř plnou silou a k tomu ti na
  každém tvém tahu sám ukáže na desce doporučený tah – zvýrazní modře kámen, kterým
  máš táhnout, i pole, kam. Nápověda jede vždy plnou silou (učí objektivně nejlepší
  tah, ne mělký podle úrovně); než se spočítá, deska chvíli (~1 s) počká. V ostatních
  úrovních (Profesionál, Pokročilý, Začátečník) se žádná nápověda neukazuje. Server
  zůstává autoritou – doporučený tah ověří jako legální a partii jím nijak nemění.

### Changed

- **Na dotyku a peru se kameny netáhnou, jen ťukají.** Tažení kamene (drag & drop)
  je nově vyhrazené jen myši; na mobilu, tabletu a peru se kámen posouvá výhradně
  ťuknutím (vybrat a ťuknout na cíl) jako před přidáním tažení. Tažení prstem se
  neosvědčilo a kolidovalo s klikáním. Na desktopu myší tažení zůstává beze změny.

## [0.37.0] - 2026-07-06

### Added

- **Drag & drop kamenů.** Kámen jde uchopit myší nebo prstem: při stisku se zvedne
  (zvětší), vybere a zvýrazní se pole, kam smí táhnout; pak ho přeneseš a upustíš na
  cílové pole. Puštění mimo legální pole kámen animovaně vrátí a zmenší zpět. Při
  tažení zní jen zvuk dopadu (ne rozjezdu). Kurzor myši je nad vlastním kamenem
  „dlaň" (uchopení) a po dobu držení „pěst". Klasické klikání (ťuknutí) zůstává
  funkční jako alternativa. U vícenásobného braní lze buď táhnout kámen rovnou na
  koncové pole (celý řetěz najednou), nebo skákat po jednotlivých dopadech.

### Changed

- **Rozpracované vícenásobné braní zobrazuje kámen na posledním dopadu.** Během
  braní kámen zůstává na poli, kam právě doskočil, a čeká na další skok; sebrané
  kameny mizí průběžně. Nově to platí i pro ovládání klikáním – dřív kámen u
  klikání stál na výchozím poli a celý řetěz se animoval až po dokončení tahu.

## [0.36.0] - 2026-07-06

### Added

- **Výsledek partie i chyby se ukazují jako vyskakovací okno (modal).** Konec
  partie (výhra „Vyhráli jste.", prohra „Vyhrál počítač.", remíza „Remíza." – bez
  dřívějšího „Konec:" prefixu), chyba enginu i selhání založení partie vyskočí
  uprostřed obrazovky, ať se neztratí. Modal se zavře tlačítkem „Zavřít", klávesou
  Esc nebo klikem mimo něj, po konci partie se objeví jen jednou a „Nová hra"
  zůstává v panelu.

### Changed

- **Přeuspořádání plochy: stavové hlášky jsou v pruhu POD deskou, deska je větší.**
  Horní panel nese už jen ovládání (tlačítka + přepínač úrovně) – zmizel prázdný
  pás nad tlačítky, čímž se zvětšila hrací deska. Průběžné hlášky (načítání partie,
  verdikt nabídky remízy) se píšou vodorovně zleva do tmavého stavového pruhu u
  spodní hrany okna (víc hlášek oddělí svislá čárka).

## [0.35.0] - 2026-07-06

### Changed

- **Oznamovací panel (stav + ovládání) je natrvalo nad hrací deskou** na širokém
  monitoru i na mobilu, roztažený na šířku desky. Dřív plaval v pravém horním
  rohu a při některých šířkách okna zasahoval do desky – to už se neděje. Deska
  zůstává u levého okraje.
- **Přepínač úrovně je teď v jednom řádku s tlačítky**, vlevo od „Nabízím remízu",
  oddělený od nich svislou čárou (na mobilu se čára při zalomení skryje). Popisek
  „Nová hra proti:" byl odstraněn.
- **Z panelu zmizel text „kdo je na tahu"** (koho se čeká, poznáte z barvy
  svítícího kamene indikátoru) **i řádek se soupeřem** (proti komu hrajete ukazuje
  přepínač úrovně). Konec partie a chybu enginu panel hlásí dál.

## [0.34.0] - 2026-07-06

### Added

- **Indikátor strany na tahu vedle desky:** kruh v barvě tmavého pole desky se
  svítícím kamenem té barvy, která je právě na tahu (černý = člověk, bílý =
  počítač). Kámen je o 30 % větší než hrací kámen na desce. Na širokém okně stojí
  vpravo od desky, svisle na jejím středu; na malém displeji (<768 px) se přesune
  pod desku a vodorovně vycentruje. Za běhu partie svítí, po jejím konci (výhra /
  prohra / remíza i vzdání) zmizí.

## [0.33.0] - 2026-07-06

### Changed

- **Hrací deska je otočená tak, že kameny hráče (černé) jsou dole** a kameny
  soupeře nahoře – přirozenější pohled, hráč sedí „u své strany". Jde čistě o
  vizuální otočení o 180°; číslování polí, pravidla, validace tahů ani server se
  nemění.

### Added

- Kořenový **README.md** s ověřeným návodem: požadavky (Node 24, pnpm 10.33.0),
  instalace, vývojové spuštění serveru (`:3000`) i webového klienta (`:5173` s
  proxy `/games`), produkční web build (`vite build` + `preview`), proměnné
  prostředí (`PORT`, `ENGINE_TIME_MS`, `CHECKERS_PDN_DIR`) a příkazy testů/kontrol.
  Každý příkaz je reálně odzkoušený; README poctivě uvádí, že samostatná produkční
  verze serveru zatím neexistuje (běží přes `tsx`) a že `vite preview` je jen
  lokální náhled, ne produkční web server.

## [0.32.0] - 2026-07-05

### Added

- Třetí úroveň obtížnosti **Pokročilý** mezi Začátečníkem a Profesionálem.
  Engine na ní vidí do hloubky 3 (bezprostřední hrozby a jednoduché kombinace,
  ne hluboké taktiky) a jen mírně chybuje – měřitelně silnější než Začátečník,
  slabší než Profesionál. Páky (`maxDepth 3`, `carelessness 0.2`) jsou
  vykalibrované self-play měřením (pořadí síly ověřené testem); konkrétní
  obtížnost proti člověku je první odhad, doladí se reálným hraním.
- Zvolená úroveň se **pamatuje mezi návštěvami**: po zavření/obnovení stránky se
  přepínač předvyplní naposledy zvolenou úrovní (uloženo v prohlížeči). Nedostupné
  úložiště (privátní režim) ani poškozená hodnota hru neshodí – padá se na
  Profesionála.

## [0.31.0] - 2026-07-05

### Added

- Výběr úrovně obtížnosti při zakládání partie: hráč si v panelu vybere
  „Profesionál" (výchozí, plná síla jako dosud) nebo „Začátečník" (výrazně
  oslabený). Volba se protáhne od UI přes `POST /games` až do zprávy pro engine:
  - server přijímá volitelné pole `level` v těle `POST /games` (zod, výchozí
    `professional` → prázdné/chybějící tělo je zpětně kompatibilní; neznámá
    úroveň → 400). Úroveň se drží u partie a je pevná po celou partii;
  - mapa úroveň → páky enginu (`maxDepth`, `carelessness` z fáze 34) žije na
    jednom místě (`levels.ts`); Začátečník = `maxDepth 1` + mírná nepozornost.
    Kalibrace opřená o měření: hloubka je dominantní páka (`maxDepth 2` slabšího
    hráče pořád poráží, `maxDepth 1` dá vyhratelnou partii); nepozornost při
    hloubce 1 výsledek skoro nemění. Doladění zůstává věcí reálného hraní;
  - Profesionál pošle enginu PŘESNĚ dnešní požadavek (bez páek), takže hraje
    bit po bitu jako dřív.
  - Panel ukazuje SKUTEČNOU úroveň rozehrané partie („Soupeř: …") ze serveru
    (`GameDto.level`), nezávisle na přepínači.
  - Úroveň jde volně přepínat až do PRVNÍHO tahu: appka po startu rovnou založí
    hru (napoprvé Profesionál, ať uživatele uvítá kompletní deska, ne prázdná
    obrazovka), ale dokud nepadne první tah, přepnutí úrovně partii jen přehraje
    na novou úroveň. Po prvním tahu se přepínač zamkne (aby přepnutí nerozbilo
    rozehranou partii) a po konci partie se zas odemkne. Úroveň se tak nikdy
    nezamkne bez vědomí hráče.
  - Rozsah: dvě úrovně; další (žebříček) a doladění konkrétní obtížnosti podle
    reálného hraní přijdou později.

## [0.30.0] - 2026-07-05

### Added

- Engine: dvě páky síly v protokolu `bestmove` (základ pro budoucí úrovně hry
  Začátečník/Pokročilý vedle stávajícího Profesionála). Obě pole jsou VOLITELNÁ
  a zpětně kompatibilní (chybí → Profesionál, dnešní chování), proto se NEmění
  verze protokolu (v3):
  - `maxDepth` (kladné celé číslo): strop iterativního prohlubování – engine
    „vidí" méně tahů dopředu a hraje mělčeji. Chybí → `MAX_SEARCH_DEPTH`.
  - `carelessness` (0..1): pravděpodobnost, že engine v daném tahu místo
    nejlepšího zahraje „o úroveň horší" tah (nejlepší z tahů mimo top skóre) –
    slabší, ale ne náhodně zahozený. Chybí → 0 (nikdy). Nutné kvůli povinnému
    braní: samotná mělká hloubka pořád trestá každou darovanou figuru, takže bez
    nepozornosti nemá slabší hráč šanci na výhru.
  - Search umí na požádání (`rankRoot`) vrátit skóre VŠECH kořenových tahů
    (`rankedMoves`, kořen se nepruuje); mimo ranked režim je chování bit-identické
    s dřívějškem. Výběr tahu dělá sdílená funkce `chooseMove` (stejný kontrakt pro
    handler enginu i self-play harness). Self-play harness dostal `runStrengthMatch`
    (srovnání SÍLY per-strana); seedovaným zápasem je doloženo, že slabší
    nastavení měřitelně prohrává s Profesionálem. Rozsah: jen engine – napojení
    na server a přepínač v UI přijdou v dalších fázích.

## [0.29.0] - 2026-07-05

### Added

- Plausible analytika (privacy-friendly, self-hosted na `plausible.softcode.cz`):
  do web klienta se přidalo měření návštěvnosti. Měřicí skript se načítá jako
  externí `<script async>` z `index.html`; inicializace (`window.plausible`
  fronta + `plausible.init()`) je v novém linkovaném modulu `src/analytics.ts`
  importovaném z `main.ts`, takže v HTML NENÍ žádný inline `<script>` blok
  (drží se zákazu inline skriptů kvůli CSP). Chování je shodné s oficiálním
  Plausible snippetem: fronta `q` zachytí případné události zaznamenané ještě
  před dotažením externího skriptu, ten je po načtení přehraje. Modul je
  idempotentní – když je `window.plausible` už nastavené, použije se ono.
  Poznámka: měření se počítá jen v produkci na doméně `dama.softcode.cz`; na
  `localhost` Plausible ve výchozím stavu nic neodesílá.

### Changed

- Mobilní rozložení panelu: na úzké obrazovce (media query `max-width: 768px`,
  tj. telefony i menší tablety) panel se stavem a tlačítky přestane plavat
  v pravém horním rohu (kde na malém displeji zakrýval desku) a zařadí se do toku NAD desku jako svislý sloupec:
  nahoře „kdo je na tahu", uprostřed hlavní tlačítka **vedle sebe**, pod nimi
  hláška o remíze. Tlačítka mají na mobilu menší padding/font a `flex: 1`, aby se
  tři popisky vešly na jeden řádek (s `flex-wrap` jako pojistkou). Deska se na
  mobilu drží stropem `--board-size: min(70vh, 94vw)`, aby panel + deska
  nepřetekly viewport. Řešeno čistě v `styles.css` (žádná změna DOM ani JS).
- Losování pozadí hry: při nové partii se právě zobrazené pozadí vyloučí z výběru,
  takže dva obrázky po sobě nikdy nejsou stejné (dřív se mohlo totéž vylosovat
  vícekrát za sebou). Vyloučení běží v čisté funkci `pickBackground` přes nový
  volitelný parametr `exclude`; `app-shell` si pamatuje přesně tu URL, kterou
  funkce vrátila (ne `pageBg.src`, který prohlížeč překlopí na absolutní URL, kde
  by porovnání selhalo). Fallback: když je v `assets/` jen jeden obrázek, vrátí se
  on (radši zopakovat než prázdné pozadí); prázdný výčet zůstává na výchozím
  barevném pozadí z CSS.

## [0.28.0] - 2026-07-05

### Added

- Rozmýšlecí pauza AI: tah počítače (bílý) se v prohlížeči zobrazí až chvíli po
  tom, co doklouže tvůj tah – od konce jeho animace uplyne aspoň ~600 ms. Dřív
  tah AI „probliknul" hned, nejvíc u posledního tahu partie (po něm už nenásleduje
  tah člověka, který by pauzu vyplnil). Je to PODLAHA, ne přičtení: když engine
  počítal dlouho (soft budget ~1 s), pauza už uplynula a nečeká se znovu, takže
  se hra celkově nezpomalí. Řešeno na klientovi (`controller.ts`), kde se pauza
  vnímá; hranice je laditelná (`aiMovePauseMs`, v testech 0). Vědomý kompromis:
  klik na Vzdát/Nabídnout remízu podaný během té pauzy se neztratí, ale vyřídí se
  až po ní (≤ délka pauzy).

## [0.27.0] - 2026-07-05

### Added

- Zvuk remízy: skončí-li partie remízou, zazní vlastní zvuk (`zvuk_remizy.mp3`) –
  stejně jako u výhry/prohry až po dokončení animace posledního tahu a s krátkou
  prodlevou, jednou (další polly ho neopakují). Dřív byla remíza záměrně tichá.

### Changed

- Zvuk tahu počítače: přibyl test, který ověřuje, že tah AI doručený pollingem
  spustí přehrání zvuku (zavolá se `play`) – dřív to nebylo pokryté. Reálné
  odemčení autoplay v prohlížeči závisí na tom, že člověk (černý) táhne první a
  jeho kliknutí audio odemkne dřív, než engine potáhne; to už test neověří.
  Chování se nemění, jde jen o pojistku.

## [0.26.0] - 2026-07-05

### Added

- Zvuky hry: animace tahu je ozvučená – na začátku každého skoku zazní zvuk
  rozjezdu, na každém dopadu (i mezidopadu vícenásobného skoku) zvuk dopadu
  kamene, takže u víceskoku se střídá rozjezd→dopad→rozjezd→dopad. Na konci
  partie zazní podle výsledku vítězná fanfára (výhra hráče) nebo zvuk prohry;
  remíza je bez zvuku. Koncový zvuk se přehraje až po dokončení animace
  posledního tahu (s krátkou prodlevou), ne během něj. Zvukové soubory jsou v
  `packages/web/src/assets/`; prostředí bez podpory přehrávání zůstává tiché a
  hru to nijak neomezí.

## [0.25.0] - 2026-07-05

### Added

- Animace tahu na desce: po tahu (počítače i vlastním) se kámen plynule přesune
  z výchozího na cílové pole místo skoku beze změny. U vícenásobného skoku projde
  jednotlivými mezidopady po diagonále a na každém se krátce zastaví, aby bylo
  vidět, kudy skok vedl; sebrané kameny mizí postupně, jak je kámen přeskakuje.
  Tah se odvozuje z porovnání pozic (server se nezměnil). Prohlížeč bez podpory
  Web Animations API i režim „omezený pohyb" spadnou na okamžité překreslení.

### Fixed

- Web: nadbytečné přetypování ve výčtu obrázků pozadí (`import.meta.glob`), které
  hlásil lint.

## [0.24.0] - 2026-07-04

### Added

- Náhodné pozadí stránky: web klient při každé nové partii (i po obnovení
  stránky) náhodně vybere jeden z obrázků `background_<NN>.webp` ve
  `packages/web/src/assets/` a zobrazí ho jako pozadí celé plochy. Počet obrázků
  se zjišťuje automaticky při buildu – přidání dalších obrázků nevyžaduje změnu
  kódu, jen rebuild.

## [0.23.0] - 2026-07-04

### Added

- Nabídka remízy: nový endpoint `POST /games/:id/offer-draw` a webové tlačítko
  „Nabízím remízu". Člověk (černý) nabídne remízu na svém tahu, o přijetí
  rozhoduje počítač (bílý) svým vyhodnocením pozice. Přijetí ukončí partii
  remízou a zapíše ji do `.pdn` (token `1/2-1/2`); odmítnutí nechá hru pokračovat.
  Tlačítko je aktivní jen na tahu člověka, když počítač nepřemýšlí; po dobu
  rozhodování je zamčené a výsledek („zvažuje" / „odmítl") se ukáže v hlášce.
- Protokol enginu rozšířen o zprávu `evaluate` (skóre pozice bez výběru tahu),
  verze protokolu zvýšena na 3. Práh přijetí drží server: počítač přijme remízu,
  jen když pozici nehodnotí jako svou výhru.

### Changed

- Rozvržení webu: hlavní tlačítka jsou pod sebou (na úzkém monitoru se vedle sebe
  nevešla), panel má strop šířky (dlouhé hlášky se zalomí) a hrací deska je
  zarovnaná k levému okraji.

## [0.22.0] - 2026-07-04

### Added

- Vzdání partie: nový endpoint `POST /games/:id/resign` (člověk = černý se vzdá →
  vyhrává počítač/bílý). Výsledek vzdání žije mimo pravidla (pozice zůstává
  rozehraná) a čte se přes jedinou funkci `effectiveResult`, kterou procházejí
  všechna serverová rozhodnutí „je konec?" - engine tak nemůže zahrát ani znovu
  archivovat vzdanou partii. Vzdaná partie se zapíše do `.pdn` (token `1-0`).
- Web klient: tlačítka „Vzdávám hru" (aktivní za běhu, s inline dvoukrokovým
  potvrzením bez systémového dialogu) a „Nová hra" (aktivní až po skončení
  partie). Nová hra zakládá další partii přímo v aplikaci a uklidí předchozí
  (zastaví polling) - restart už nevyžaduje obnovení stránky. Přibyl řádek stavu
  („Jste na tahu", „Počítač je na tahu…", „Konec: …").

### Changed

- Nová partie po skončení NEstartuje automaticky - jen na tlačítko „Nová hra".

## [0.21.0] - 2026-07-04

### Added

- Archiv dokončených partií na disk: po skončení partie server zapíše kompletní
  PDN celé hry jako `<id>.pdn` (7 hlavičkových tagů, číslované tahy, výsledkový
  token). Zápis je atomický (`.tmp` + přejmenování), jednosměrný (zpět do hry se
  nenačítá - stav dál žije v paměti serveru) a best-effort: selhání zápisu (plný
  disk, chybějící práva) partii neshodí, jen se zaloguje. Cílový adresář určuje
  proměnná `CHECKERS_PDN_DIR` (výchozí `.pdn/`, ignorováno gitem). Nahrazuje
  dříve plánovaný klientský LocalStorage archiv.

## [0.20.0] - 2026-07-04

### Added

- Napojení web klienta na autoritativní server (konec hot-seatu). Klient při
  načtení založí partii (`POST /games`) a vykreslí pozici ze serveru, tah člověka
  pošle na `POST /games/:id/moves` a desku nastaví na plný stav z odpovědi; tah
  enginu (bílý) zachytí pollingem `GET /games/:id` à 250 ms. Klient je jen
  prezentace serverového stavu - `rules` v něm zůstávají výhradně na zvýrazňování
  legálních tahů, tah už neprovádí lokálně. Server zůstává jedinou autoritou.
- Vite proxy `/games` na server (relativní cesty, žádné CORS) a typovaný klient
  serveru (`server-client.ts`) nad `fetch`. Odpověď serveru se ověřuje runtime
  guardem tvaru: ne-JSON tělo (např. z proxy) nebo drift kontraktu skončí
  `ServerError`, ne tichým poškozením desky.

### Changed

- Během tahu enginu (na tahu bílý) klient nepustí žádný výběr; jedním requestem
  naráz (single-flight) se hlídá, aby se polling a odeslaný tah nepřekryly.
- Neúspěšná odpověď na tah (409/404/5xx i výpadek sítě) desku nezasekne - stav se
  dorovná z `GET` a klik se zase povolí.

### Fixed

- Spolehlivost kliku: kameny se při překreslení už nerecyklují (deska se
  aktualizuje idempotentně). Dřív polling à 250 ms recykloval DOM a klik na kámen
  se občas spolkl (musel se trefit mimo kámen); zároveň mizí i blikání kamenů.

## [0.19.0] - 2026-07-04

### Added

- Web klient: doklikávání vícenásobného skoku. Hráč složí i vícenásobný skok
  postupným klikáním jednotlivých polí dopadu; při větvení (víc pokračování ze
  stejného mezidopadu) se nabídnou obě větve. Naklikaná cesta se zvýrazní; po
  dokončení sekvence se tah lokálně provede přes `rules` a deska se překreslí.
  Legalitu i dokončení tahu určuje výhradně `rules` - klient sám nerozhoduje.
  Zatím bez serveru (hraje se hot-seat, po tahu je na tahu druhá barva).

## [0.18.0] - 2026-07-04

### Added

- Webový klient (`@checkers/web`, Vite + vanilla TS): šachovnice 8×8 v prohlížeči.
  Vykreslí výchozí rozestavění, klik na vlastní kámen ho vybere a zvýrazní jeho
  legální tahy. Legalita jde výhradně přes sdílenou knihovnu `rules`, takže deska
  respektuje i povinné braní - když je k dispozici skok, prosté tahy se nenabídnou.
  Zatím bez serveru a bez provádění tahů (jen výběr a zvýraznění).

## [0.17.0] - 2026-07-04

### Added

- Orchestrace enginu: server spouští TS engine jako oddělený podproces za JSON
  Lines protokolem. Po tahu člověka se tah enginu (bílý) spočítá NA POZADÍ a
  zahraje do partie; klient ho vidí pollingem `GET /games/:id`. `POST /moves`
  vrací odpověď hned po tahu člověka a nikdy nečeká na engine.
- Stav tahu enginu `engineStatus` (`idle` / `thinking` / `error`) v odpovědi
  serveru - klient podle něj při pollingu pozná, jestli engine přemýšlí nebo
  selhal.
- Odolnost proti selhání enginu: tvrdý časový strop (`timeMs + 500 ms`) se
  zabitím zaseknutého procesu, restart a jedno zopakování na polovičním čase;
  úklid osiřelých procesů přes pidfile při startu i vypnutí serveru. Pád ani
  zaseknutí enginu partii neshodí (engine je nedůvěryhodný, jeho tah se ověřuje
  přes `rules` stejně jako tah člověka).

### Changed

- Když je zapojený engine, člověk smí táhnout jen svou stranou (černou). Pokus
  o tah, když je na tahu engine, server odmítne novým chybovým kódem
  `not_your_turn` (409) - server zůstává jedinou autoritou nad pozicí.

## [0.16.0] - 2026-07-04

### Added

- Autoritativní HTTP server partie (`@checkers/server`, Fastify + zod): založení
  partie (`POST /games`), přečtení stavu (`GET /games/:id`) a odehrání tahu
  (`POST /games/:id/moves`). Partie žijí v paměti serveru (bez databáze).
- Server je jediný zdroj pravdy o pravidlech: legalita každého tahu se ověřuje
  proti sdílené knihovně `rules`. Klient posílá jen výchozí pole a cestu dopadů
  (`{ from, path }`); která pole se berou, si server odvodí sám - klient braní
  nediktuje. Odpověď u nelegálního tahu přikládá aktuální seznam legálních tahů.
- Jednotná chybová obálka se strojově čitelným kódem (`invalid_request`,
  `not_found`, `game_not_found`, `illegal_move`, `game_over`) - i pro neznámou
  cestu a nelegální tah.
- Brána `packages/server/scripts/curl-gate.sh`: odehraje kompletní partii přes
  reálně běžící server a ověří, že server nepřijme žádný nelegální tah.

## [0.15.0] - 2026-07-04

### Added

- Transpoziční tabulka + Zobrist hash v searchi: engine si přes transpozice
  (tatáž pozice dosažená jiným pořadím tahů) pamatuje už prohledané pozice a
  neprohledává je znovu. Úbytek prohledaných uzlů roste s hloubkou (~15 % na
  hloubce 5, ~48 % na hloubce 8). TT je čistá optimalizace: na dané hloubce
  vrací IDENTICKÝ výběr tahů i skóre jako bez ní (ověřeno korektnostní bránou
  `pnpm --filter @checkers/engine tt-gate [hloubka] [pozice]`).
- 53-bit Zobrist otisk pozice (bezpečné JS celé číslo, bez BigInt).

### Changed

- Výsledek searche nese počet prohledaných uzlů (`nodes`) - podklad pro měření
  úbytku; výběr tahu ani skóre se nemění.

### Known limitations

- TT je zatím na hodinách přínosná až od hloubky ~7; níž ji přebije režie
  přepočtu hashe (počítá se z celé desky na každý uzel). Na provozních
  hloubkách 5-7 je zhruba break-even, na hloubce 6 mírně pomalejší. Odstranilo
  by to inkrementální hashování (navazující krok, pokud bude potřeba).

## [0.14.0] - 2026-07-03

### Added

- Self-play harness a brána (`pnpm --filter @checkers/engine selfplay-gate
  [zahájení] [hloubka]`) pro srovnávání dvou evaluací: párovaná randomizovaná
  zahájení se střídáním barev, fixní hloubka (izoluje kvalitu evaluace od
  rychlosti), kontrolní běh jako sanity check harnessu a statistický práh
  (50 % + 2σ dle N). Odlišené exit kódy (0 PASS / 1 FAIL / 2 špatný argument /
  3 neočekávaná chyba), aby se pád nemaskoval jako legitimní neúspěch.
- Injektovatelná evaluace do searche (`EvalFn` v `searchRoot`/`searchTimed`) -
  umožňuje spustit víc variant evaluace v jednom procesu; produkční default
  zůstává beze změny.
- Kandidátní evaluace v2 (mobilita, kontrola dvojitého rohu, podmíněná zadní
  řada). Změřena self-play bránou proti v1 (≥ 200 partií, hloubky 4 a 5):
  převahu NEPROKÁZALA (remízovější, marginálně slabší, 2-3× pomalejší).
  **Produkční evaluace zůstává v1**; v2 je zatím jen kandidát k dalšímu ladění.

## [0.13.0] - 2026-07-03

### Added

- Časová kontrola enginu: iterativní prohlubování 1-25 s měkkým limitem.
  Engine vrací výsledek poslední KOMPLETNÍ iterace - rozdělaná hloubka se
  při vypršení času celá zahodí; hloubka 1 doběhne vždy, takže legální tah
  existuje i při absurdně malém limitu. Doba odpovědi nepřekročí
  `timeMs` + malou režii (brána M3: nejpomalejší tah 27 ms při limitu 25).
- Quiescence: na hranici hloubky se povinné výměny dohrají do klidné
  pozice, engine tak přestal „šlapat do braní" těsně za horizontem
  (horizont efekt).

### Changed

- Protokol enginu zvednut na v2: zpráva `bestmove` má nově POVINNÉ pole
  `timeMs` (měkký limit v ms, kladné celé číslo) - chybějící nebo vadná
  hodnota vrací `error/invalid_message`. Pevná hloubka (`SEARCH_DEPTH`)
  zmizela; hloubku určuje čas. Tvrdý strop (kill procesu) zůstává na
  volajícím - orchestrace M4 počítá s `timeMs + 500`.
- Brána M3 zpřísněna a splněna: 100 partií proti náhodnému hráči se
  střídáním barev = 100 výher, 0 remíz, 0 proher; žádný tah nepřekročil
  tvrdý strop a legalitu každého tahu ověřila nezávisle knihovna pravidel.

## [0.12.0] - 2026-07-03

### Changed

- Engine už nehraje náhodně: zprávu `bestmove` odbavuje negamax
  s alfa-beta ořezáváním na pevnou hloubku 6 a evaluací v1 (muž 100,
  dáma 130, bonus za hlídanou zadní řadu, drobný bonus za postup mužů).
  Engine preferuje rychlejší výhru a pozdější prohru; mezi stejně dobrými
  tahy rozhoduje seedovatelný tie-break (dřívější `--seed` má teď jen
  tuto roli). Brána M3 splněna: 12 seedovaných partií proti náhodnému
  hráči = 12 výher, každý tah enginu ověřen nezávisle knihovnou pravidel.
- Dokumentace protokolu nově výslovně uvádí limity v1: `bestmove` nenese
  časový limit ani remízový stav partie (čítač půltahů, opakování) -
  obojí přijde s fází časové kontroly.

## [0.11.0] - 2026-07-03

### Added

- Engine jako samostatný proces (`@checkers/engine`, začátek milníku M3):
  JSON Lines protokol na stdin/stdout - požadavky `hello` (handshake vrací
  `protocol` a `engine` id) a `bestmove` (zatím náhodný legální tah,
  seedovatelný přes `--seed`; search přijde v další fázi). Pozice a tah
  putují přímo jako JSON tvar typů z `@checkers/rules`, server je bude
  importovat místo opisování. Spuštění:
  `pnpm --filter @checkers/engine start -- [--seed <n>]`.
- Odolnost protokolu: řádkový buffer správně skládá zprávy rozseknuté mezi
  chunky (i CRLF); nevalidní JSON, špatný tvar zprávy, neznámý typ, vadná
  pozice i pozice bez tahů vracejí odpověď `error` s kódem a proces žije
  dál. Nečekaná chyba enginu vrací `internal_error` se zachovaným `id`
  (volající si odpověď spáruje) a stackem na stderr. Exit kódy: 0 konec
  spojení (EOF/zavřená roura), 1 chybné argumenty.
- Brána fáze kryta integračními testy přes skutečný podproces: handshake,
  legální bestmove ověřený rules knihovnou, rozsekané zprávy, garbage
  vstup, čistý konec na EOF.

## [0.10.0] - 2026-07-03

### Added

- CLI hra (`@checkers/cli`, milník M2): kompletní partie americké dámy
  v terminálu bez UI a serveru. Režim random vs random (důkaz, že pravidla
  vždy terminují - remíza po 80 půltazích bez pokroku) a člověk vs random
  se zadáváním tahů v PDN (`11-15`, `22x15`, `26x17x10`); chybný nebo
  nelegální vstup dostane hlášku a nový prompt, partii nic neshodí.
  ASCII deska ukazuje kameny (m/k/M/K) a čísla prázdných polí 1-32.
  Spuštění: `pnpm --filter @checkers/cli start -- --mode random|human
  [--seed <n>] [--color black|white]`; bez `--seed` se vypíše náhodný seed,
  takže je každá partie reprodukovatelná. Exit kódy: 0 dohraná partie,
  1 chyba, 2 partie přerušená člověkem (EOF/Ctrl+C).
- Herní smyčka CLI je zároveň bránou legality: tah každé strategie
  (i random hráče) projde jen přes členství v `legalMoves` - stejný princip,
  jakým později server ověří tahy enginu.
- Tvrdý strop hloubky perftu (`MAX_PERFT_DEPTH = 12`): hlubší volání odmítá
  `RangeError` místo prakticky nekonečného výpočtu - pojistka pro budoucí
  vystavení přes CLI/server (nález SEC-2).

### Changed

- Projekt oficiálně běží na Node 24 LTS: projektový dokument srovnán
  s realitou repa a `@types/node` zvednuty na ^24, takže typy popisují
  skutečný runtime (nález 10-1, viz ADR fáze 11).
- GitHub Actions v CI přišpendlené na plné commit SHA místo pohyblivých
  tagů (nález SEC-1); aktualizace akcí jsou nově ruční.

### Fixed

- `ALL_DIRS` má jediný zdroj pravdy v `board.ts` (nově i ve veřejném API);
  duplicitní kopie v generátoru tahů a testech odstraněny, obsah konstanty
  přibíjí test (nález 10-2).

## [0.9.0] - 2026-07-03

### Added

- Perft (`perft(position, depth)`): počet listových uzlů stromu legálních
  tahů; vícenásobný skok je jeden tah. Hodnoty 1-6 z výchozí pozice sedí
  na čísla nezávislého zdroje (Aart Bik): 7/49/302/1469/7361/36768 -
  generátor tahů je tím ověřený proti světu, milník M1 (knihovna pravidel)
  je uzavřený.
- Sdílené fixtures (`packages/rules/fixtures/*.json`): jazykově neutrální
  kontrakt pravidel - výchozí pozice s perft hodnotami + pasti z GDD 2.7
  (povinné braní, větvení multi-skoku, zákaz zastavení uprostřed větve,
  muž nebere vzad, proměna ukončuje tah, kruhový skok dámy, zablokovaná
  pozice). Formát popsán ve `fixtures/README.md`; stejné soubory později
  přibijí i případný Rust engine. Testy fixtures načítají z JSON a
  poškozený soubor hlasitě odmítnou.

## [0.8.0] - 2026-07-03

### Added

- PDN notace tahu: `formatMove` převádí tah na text (prostý tah `22-18`,
  skok s celou sekvencí dopadů `26x17x10`), `parseMove` z textu tah
  zrekonstruuje včetně dopočtu braných kamenů z geometrie skoků. Nesmyslný
  zápis i strukturálně vadný tah odmítá `RangeError`. Round-trip
  (tah → text → stejný tah) je ověřený nad všemi legálními tahy
  20 náhodných partií. Zkrácený zápis skoku (`26x10` bez mezidopadů)
  se vědomě nepodporuje - PDN se jen exportuje, cizí soubory se nečtou.

## [0.7.0] - 2026-07-03

### Added

- Stav partie (`GameState`): vrstva nad jednou pozicí - čítač půltahů bez
  pokroku, historie pozic a `advanceState` pro posun po tahu. Pokrok
  (braní nebo tah mužem, včetně proměny) čítač nuluje a historii zahazuje.
- Remízová pravidla (`gameResultFromState`): remíza po 80 půltazích bez
  braní a bez tahu mužem, nebo při trojím opakování stejné pozice se
  stejnou stranou na tahu. Prohra bez tahu má před remízou přednost.
  `GameResult` nově zná hodnotu `draw`.
- Klíč pozice (`positionKey`): deterministická textová serializace desky
  a strany na tahu; poškozenou pozici odmítá `RangeError`.
- Garance terminace: každá partie skončí - ověřeno testem s 50 seedovanými
  náhodnými partiemi (deterministický PRNG, žádná nekonečná hra).

## [0.6.0] - 2026-07-03

### Added

- Detekce konce hry (`gameResult`): hráč na tahu bez legálního tahu
  prohrává - i se zablokovanými kameny na desce (pat v americké dámě
  neexistuje). Vrací `ongoing` / `black-wins` / `white-wins`; remízová
  pravidla přijdou samostatně.

## [0.5.0] - 2026-07-03

### Added

- Aplikace tahu (`applyMove`): vrací novou pozici (vstup se nemění), kámen
  se přesune na konec sekvence, brané kameny zmizí, na tah jde soupeř.
  Validuje strukturu tahu (geometrie kroků, volné dopady, soupeř na braných
  polích) a při porušení vyhazuje `RangeError`; plnou legalitu drží
  `legalMoves` (viz ADR fáze 6).
- Proměna: muž končící na zadní řadě soupeře se stává dámou, prostým tahem
  i skokem. Proměna ukončuje tah - proměněný muž v tomtéž tahu nepokračuje
  v braní jako dáma (past z GDD 2.7, pokryto end-to-end testem).

## [0.4.0] - 2026-07-03

### Added

- Vícenásobný skok: braní pokračuje z pole dopadu, dokud existuje další
  skok - uprostřed sekvence skončit nejde. Větvení vrací každou maximální
  větev jako samostatný tah; volba kratší větve z rozcestí je legální
  (maximum braní se nevyžaduje). Stejný kámen nelze v sekvenci přeskočit
  dvakrát; kruhový skok dámy s návratem na výchozí pole funguje.
- Testy pastí z GDD 2.7 pro multi-skoky: trojskok, větvení, zákaz zastavení
  uprostřed větve, muž nebere vzad ani v pokračování sekvence.

### Changed

- Odstraněno dočasné omezení z verze 0.3.0: skok už nekončí po jednom braní.

## [0.3.0] - 2026-07-03

### Added

- Jednoduché braní: skok přes soupeřův kámen na prázdné pole za ním; muž
  bere jen vpřed, dáma všemi čtyřmi směry.
- Povinnost braní přes nové veřejné API `legalMoves`: existuje-li skok
  kterékoli figury strany na tahu, prostý tah není legální. Prázdný seznam
  tahů je zafixovaný kontrakt pro budoucí detekci konce hry.
- Validace strany na tahu: pozice s neplatným `turn` vyhazuje `RangeError`
  místo tichého „žádné tahy".

### Changed

- Generátory prostých tahů zmizely z veřejného API balíčku rules – jediným
  vstupem pro konzumenty je `legalMoves` (stavební bloky ignorují povinnost
  braní). Dočasné omezení: skok zatím končí po jednom braní, vícenásobné
  skoky přijdou v další fázi.

## [0.2.0] - 2026-07-03

### Added

- Výchozí rozestavění partie (`initialPosition`): černí muži na polích 1-12,
  bílí na 21-32, černý na tahu.
- Generátor prostých tahů (bez braní): muž táhne jen vpřed o 1 pole, dáma
  všemi čtyřmi směry o 1 pole (není dálková). Kotva perft(1): z výchozí
  pozice přesně 7 tahů pro černého i bílého, ověřeno testy proti ručně
  vypsaným tahům.
- Poškozená pozice (deska s jinou délkou než 32 polí) vyhazuje `RangeError`
  místo tichého vynechání tahů.

## [0.1.0] - 2026-07-03

### Added

- Základ knihovny pravidel (`@checkers/rules`): typy partie (barva, kámen,
  pozice, tah s podporou vícenásobných skoků), standardní PDN číslování
  polí 1-32 s převodem na souřadnice a zpět a předpočítané tabulky
  sousedství a skoků (`NEIGHBORS`, `JUMPS`) pro 4 diagonální směry.
  Neplatné vstupy (pole mimo 1-32, světlé políčko, neplatný směr) vyhazují
  `RangeError`; vše kryté 92 testy s ručně spočítanými hodnotami.
- Kostra monorepa: pnpm workspaces se čtyřmi balíčky (`@checkers/rules`,
  `@checkers/engine`, `@checkers/server`, `@checkers/web`).
- Sdílený přísný TypeScript základ (`tsconfig.base.json`, strict +
  `noUncheckedIndexedAccess`).
- Vitest se smoke testy ve všech balíčcích, ESLint 10 s typed lintingem.
- GitHub Actions CI: lint, typecheck a testy na Node 24 při každém pushi.

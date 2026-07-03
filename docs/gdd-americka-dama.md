# Americká dáma — návrhový dokument a plán prací

Verze 0.1 · stav: návrh · stack: TypeScript / Node (Rust jako pozdější varianta enginu)

---

## 0. K čemu tento dokument je

Klasická šablona GDD (příběh, postavy, art direction, monetizace) je pro dámu bezcenná — pravidla hry jsou pevně daná a herní design tvoří zlomek práce. Tenhle dokument je proto z 20 % herní specifikace a z 80 % technický návrh s plánem milníků. Sekce 2 (pravidla) je **závazná specifikace**: každá věta v ní se má promítnout do testu. Když se implementace a tento dokument rozejdou, oprav jedno nebo druhé — nikdy nenech rozpor žít.

**Definice hotového (v1):** člověk odehraje v prohlížeči kompletní partii proti enginu; engine táhne do 3 s; server nepřijme žádný nelegální tah (ani od enginu); pád enginu partii neshodí.

---

## 1. Cíle a ne-cíle

**Cíle v1:**

1. Hratelná americká dáma (English draughts) člověk vs. AI v prohlížeči.
2. Server je jediná autorita nad stavem partie a pravidly.
3. AI engine běží jako oddělený proces za stabilním protokolem — vyměnitelný bez zásahu do serveru a klienta.
4. Pravidla existují jako samostatná knihovna s kompletním testovým pokrytím (perft).

**Ne-cíle v1** (vědomě odloženo, ne zapomenuto):

- Multiplayer, účty, žebříčky, matchmaking.
- Perzistence do databáze (partie žijí v paměti serveru).
- Opening book, endgame databáze, opravdu silný engine.
- Mobilní aplikace, PWA, offline režim.
- Undo, analýza partie, nápověda tahů od enginu.

Trade-off: každý ne-cíl je lákadlo, které rozbije plán. Nejnebezpečnější je multiplayer — vypadá jako „jen přidat druhého hráče“, ale znamená WebSockety, session management a autorizaci. Nedělej to ve v1.

---

## 2. Pravidla americké dámy — závazná specifikace

### 2.1 Deska a číslování

Hraje se na 8×8 desce, ale pouze na 32 tmavých polích. Pole číslujeme 1–32 po řadách shora:

```
 .  1  .  2  .  3  .  4
 5  .  6  .  7  .  8  .
 .  9  . 10  . 11  . 12
13  . 14  . 15  . 16  .
 . 17  . 18  . 19  . 20
21  . 22  . 23  . 24  .
 . 25  . 26  . 27  . 28
29  . 30  . 31  . 32  .
```

Převod: pro pole `s` (1–32) je řada `r = ⌊(s−1)/4⌋` (0 = horní), `f = (s−1) mod 4`; sloupec `c = 2f+1` pro sudé `r`, `c = 2f` pro liché `r`. Diagonální sousedé jsou `(r±1, c±1)`. Zrcadlení (chiralita) desky nemá vliv na logiku ani perft — důležitá je jen vnitřní konzistence. Doporučení: sousedy a cíle skoků předpočítej do tabulek `NEIGHBORS[32][4]` a `JUMPS[32][4]` (směry NW, NE, SW, SE), ať se aritmetika řeší na jednom místě.

### 2.2 Rozestavění a začátek

Černý (Black) obsazuje pole 1–12, bílý (White) 21–32. **Černý táhne první** (konvence anglické dámy i PDN). Černý postupuje k vyšším číslům, bílý k nižším.

### 2.3 Tahy bez braní

- Muž (obyčejný kámen) táhne diagonálně o jedno pole **pouze vpřed** na prázdné pole.
- Dáma (king) táhne diagonálně o jedno pole **libovolným směrem**.
- **Dáma není dálková.** Žádné klouzání přes více polí. Tohle je hlavní rozdíl proti české a mezinárodní dámě — pokud z nich vycházíš, tady uděláš první chybu.

### 2.4 Braní

- Braní je **povinné**: existuje-li aspoň jeden skok, tahy bez braní nejsou legální.
- Skok: přeskočení sousedního soupeřova kamene na prázdné pole bezprostředně za ním.
- Muž bere **pouze vpřed**. Dáma bere všemi čtyřmi směry.
- **Vícenásobný skok:** může-li tentýž kámen z pole dopadu skákat dál, **musí** pokračovat. Celá sekvence je jeden tah.
- Hráč si mezi dostupnými skoky a větvemi **volí libovolně**. Žádné pravidlo maxima (braní většiny je pravidlo mezinárodní dámy, ne americké).
- Přeskočený kámen se odstraňuje ihned po přeskočení; invariant: žádný kámen nelze v jedné sekvenci přeskočit dvakrát.

### 2.5 Proměna

- Muž, který dokončí tah na poslední řadě soupeře (černý na 29–32, bílý na 1–4), se stává dámou.
- **Proměna uprostřed skokové sekvence tah okamžitě ukončuje.** Nový král nepokračuje ve skákání, ani kdyby další skoky existovaly.

### 2.6 Konec hry

- Prohrává hráč, který je na tahu a **nemá žádný legální tah** (přišel o kameny, nebo jsou všechny blokované). Pat neexistuje — blokace je prohra.
- Remíza (pragmatická konvence pro v1, viz sekce 9):
  - trojí opakování téže pozice se stejnou stranou na tahu, nebo
  - 80 po sobě jdoucích půltahů bez braní a bez tahu mužem (čítač `pliesWithoutProgress`, reset při braní nebo tahu mužem).

Pravidlo 80 půltahů navíc garantuje, že **každá partie terminuje** — bez něj ti e2e test „random vs. random“ může běžet věčně (dvě dámy se honí po desce).

### 2.7 Známé pasti — každá odrážka = minimálně jeden test

- Povinnost braní má přednost přede vším; generátor při existenci skoku nesmí vrátit jediný prostý tah.
- Rekurze vícenásobných skoků včetně větvení (z jednoho dopadu více směrů).
- Proměna uprostřed skoku ukončuje tah.
- Muž nebere dozadu; dáma bere dozadu.
- Dáma táhne jen o jedno pole.
- Kámen nelze přeskočit dvakrát v jedné sekvenci.
- Hráč bez tahu prohrává (i s kameny na desce).
- Volba kratší skokové větve je legální, i když existuje delší.

---

## 3. Architektura

### 3.1 Komponenty

| Komponenta | Odpovědnost | Co nesmí dělat |
|---|---|---|
| `rules` (knihovna) | generování tahů, aplikace tahu, detekce konce, notace | žádné I/O, žádné závislosti |
| `web` (klient) | vykreslení, vstup, zvýraznění legálních tahů (přes `rules`) | nesmí být autoritou nad stavem |
| `server` | autoritativní stav partií, validace všech tahů, orchestrace enginu | nesmí obsahovat vlastní kopii pravidel mimo `rules` |
| `engine` | výpočet nejlepšího tahu v časovém limitu | nesmí měnit stav partie; jeho výstup se validuje |

### 3.2 Zásada autority

Server je jediný zdroj pravdy. Klient smí tah aplikovat optimisticky (okamžitá odezva UI), ale po odpovědi serveru se sesynchronizuje na plný stav; při neshodě tvrdý resync + log, protože neshoda znamená bug, ne stav k tichému zamaskování. **Engine není důvěryhodný:** server validuje i jeho tahy stejnou cestou jako tahy hráče. To je pojistka, díky které si engine později může dovolit vlastní implementaci pravidel (viz 3.3).

### 3.3 Pravidla jednou — a co s Rust enginem

Autoritativní implementace pravidel je jedna: balíček `rules` v TypeScriptu, který sdílí server (validace) i klient (zvýraznění tahů). Engine v TS (milník M3) ji používá taky — nulová duplicita.

Rust engine (M6+) nutně znamená druhou implementaci generátoru tahů. To je přijatelné za dvou podmínek: (a) server validuje každý enginový tah, takže divergence se projeví jako odmítnutý tah a chyba v logu, ne jako tichá korupce partie; (b) obě implementace jsou přibité stejnými perft hodnotami a sdílenými fixtures (`fixtures/*.json`: pozice → očekávaná množina tahů). Trade-off: při změně pravidel udržuješ dvě implementace — u dámy se pravidla nemění, takže cena je nízká; u hry s vyvíjejícím se designem by to byla past.

### 3.4 Struktura repozitáře

```
dama/
  package.json            # pnpm workspaces
  packages/
    rules/                # čistá logika, nulové runtime závislosti
    engine/               # CLI proces, JSON přes stdin/stdout
    server/               # Fastify REST, správa partií a engine procesu
    web/                  # Vite + vanilla TS klient
  fixtures/               # sdílené testovací vektory (JSON)
```

### 3.5 Datové typy (kanonické, balíček `rules`)

```ts
type Color = "b" | "w";
type Cell = "b" | "B" | "w" | "W" | null;   // malé = muž, velké = dáma

interface Position {
  board: Cell[];                 // délka 32; index = číslo pole − 1
  sideToMove: Color;
  pliesWithoutProgress: number;  // pro remízové pravidlo
}

type Move = number[];
// prostý tah: [22, 18]
// vícenásobný skok: [26, 17, 10] — posloupnost polí dopadu
```

Kódování tahu posloupností polí je jednoznačné: u krátkého skoku určuje pole dopadu přeskočený kámen jednoznačně, takže není třeba braný kámen uvádět. PDN zápis pro logy a historii: `22-18`, `26x17x10`.

### 3.6 REST API (server ↔ klient)

```
POST /api/games                { engineTimeMs?: number }        → 201 { gameId, state }
GET  /api/games/:id                                             → 200 { state }
POST /api/games/:id/moves      { move: number[] }               → 200 { state }
                                                                → 409 { error: "illegal_move", legalMoves }
```

```ts
interface GameState {
  position: Position;
  legalMoves: Move[];                      // pro stranu na tahu
  engine: "idle" | "thinking" | "error";
  result: null | "b" | "w" | "draw";
  history: string[];                       // PDN
}
```

Tok tahu: `POST /moves` aplikuje tah hráče, spustí engine a vrátí se hned se `engine: "thinking"`; klient polluje `GET` (interval ~250 ms), dokud engine nedotáhne. Trade-off: polling je hloupý a plýtvá požadavky, ale je o řád jednodušší než správa WebSocket spojení. Až tě začne štvát, mezikrok je SSE — jednosměrný stream stavů bez WS režie. Vstupy validuj (zod) na hranici API; 404 pro neexistující partii, 409 pro nelegální tah.

Úložiště partií v1: `Map<gameId, Game>` v paměti. Trade-off: restart serveru zabije všechny rozehrané partie. Pro v1 přijatelné a levné; zapisuju to sem, aby to bylo rozhodnutí, ne překvapení.

### 3.7 Protokol server ↔ engine (JSON Lines přes stdin/stdout)

Jedna JSON zpráva na řádek; `id` se vrací v odpovědi; pole `protocol` od prvního dne (levná pojistka proti budoucím změnám). Obdoba UCI u šachových enginů.

```
→ {"id":1,"cmd":"hello","protocol":1}
← {"id":1,"ok":true,"name":"dama-engine","version":"0.1.0","protocol":1}

→ {"id":2,"cmd":"bestmove","position":{…},"timeMs":2000}
← {"id":2,"ok":true,"move":[23,18],"info":{"depth":9,"scoreCp":34,"nodes":812345,"timeMs":1987}}

← {"id":2,"ok":false,"error":"invalid_position"}
```

Provozní pravidla:

- v1 obsluhuje engine požadavky **sériově**; server drží frontu. Trade-off: souběžné partie na sebe čekají — pro v1 v pořádku, škálování (pool procesů) je změna jen na straně serveru díky protokolu.
- Tvrdý timeout = `timeMs + 500 ms`. Po překročení nebo pádu: kill, restart procesu, jeden retry s `timeMs/2`. Druhé selhání → `engine: "error"`, partie se nezahazuje a UI nabídne opakování.
- Server engine **nikdy** nevolá synchronně v request handleru — jeden přemýšlející výpočet by zablokoval celé API.

Dvě věci tady selžou spolehlivě: zombie procesy po pádu serveru (řeš úklidem při startu i vypnutí) a rozbité čtení stdinu po částech (řádkový buffer, ne `data` event naslepo).

---

## 4. Technologický stack

### 4.1 Doporučená cesta (varianta A): TypeScript všude

`pnpm` workspaces, TypeScript ve `strict` režimu, Vitest na testy, Fastify + zod na serveru, Vite + vanilla TS na klientu, `tsx` pro vývoj, Node 22 LTS. Frontend bez frameworku — šachovnice je CSS grid a pár event handlerů; React by tu řešil neexistující problém. Trade-off: až budeš chtít lobby, nastavení a víc obrazovek, vanilla přístup začne bolet; to je ale problém v2, ne v1.

Trade-off celé varianty A: TS engine bude výrazně pomalejší než nativní kód — čekej použitelnou hloubku ~10–14 půltahů v pár sekundách, ne turnajovou sílu. Pro v1 to stačí a jde o vědomou směnu rychlosti enginu za rychlost vývoje.

### 4.2 Varianta B: Rust core + WASM

Pravidla i engine v Rustu (cargo workspace), do prohlížeče přes `wasm-pack`, server tenký (Node volá nativní binárku, nebo rovnou axum). Kdy dává smysl: pokud je tvým primárním cílem silný engine a Rust samotný, a přijmeš pomalejší iteraci na všem ostatním. Trade-offy: WASM build pipeline a debugging v prohlížeči jsou tření navíc, serde hranice mezi JS a Rustem přidává boilerplate, a kompilační cyklus zpomalí ladění pravidel — což je přesně fáze, kde budeš iterovat nejvíc. **Rozhodnutí: začni variantou A; Rust vstupuje až v M6 jako druhý engine za hotovým protokolem.** Pak dostaneš výkon Rustu tam, kde je ho třeba, bez WASM daně na klientu.

---

## 5. Návrh enginu

### 5.1 Reprezentace pozice

v1: pole 32 buněk (typ `Cell` výše) — pomalé, ale triviálně laditelné a sdílené s `rules`. Bitboardy (tři 32bitová čísla: černé kameny, bílé kameny, dámy) jsou standard a patří do Rust verze; v TS je nezaváděj, dokud tě profiler nedonutí. Trade-off bitboardů: rychlost za čitelnost — chybu v bitových maskách budeš hledat hodiny.

### 5.2 Prohledávání

- Negamax s alfa-beta ořezáváním.
- **Iterativní prohlubování** 1..N s měkkým časovým limitem: po každé dokončené hloubce ulož nejlepší tah; při vypršení vrať poslední kompletní výsledek. Nejčastější chyba: vrácení tahu z nedokončené iterace — ten může být libovolně špatný.
- Generátor sám vynucuje povinné braní, takže větve se skoky se prohledávají přirozeně. Navíc: **neukončuj hodnocení v pozici, kde existují povinné skoky** — prodluž o půltah (obdoba quiescence; řeší horizont efekt, kdy si engine „nevšimne“, že o tah dál přijde o dámu).
- Řazení tahů v1: skokové sekvence první (delší dřív), pak tahy s proměnou. Transpoziční tabulka (Zobrist hash) až v M6 — dřív je to optimalizace bez měření.

### 5.3 Evaluace v1

Materiál (muž 100, dáma 130), malý bonus za neopuštěnou vlastní zadní řadu (brání soupeřově proměně), drobný bonus za postup mužů. Víc ne. Mobilita, kontrola dvojitého rohu a „runaway“ kameny jsou v2 — přidávej je až proti měřitelné základně (self-play, viz 6.5), jinak nepoznáš, jestli pomáhají.

### 5.4 Očekávaná síla — realisticky

Anglická dáma je slabě vyřešená hra (Chinook, remíza při bezchybné hře) a existující enginy s endgame databázemi jsou prakticky neporazitelné. Tvůj v1 engine porazí běžného člověka a to je správný cíl; nesnaž se soutěžit s Chinookem. Obtížnost pro lidi řeš omezením `timeMs`/hloubky, ne vylepšováním evaluace.

---

## 6. Testovací strategie

### 6.1 Perft — páteř celého projektu

Perft(N) = počet legálních **tahů-sekvencí** do hloubky N (celá skoková sekvence = jeden tah — jiná definice ti čísla rozbije). Referenční hodnoty z výchozí pozice:

| hloubka | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| pozic | 7 | 49 | 302 | 1 469 | 7 361 | 36 768 |

Než je prohlásíš za bernou minci, ověř je proti nezávislému publikovanému zdroji — překlep v referenční tabulce znamená týdny ladění správné implementace. Sanity check zdarma: hloubka 1 = 7 si spočítáš ručně (muži na 9–12 mají 2+2+2+1 tahů vpřed).

### 6.2 Jednotkové testy pravidel

Sekce 2.7 je seznam testů; navíc golden testy proměny, konce hry a remízových pravidel. Pravidlo: žádný kód mimo `rules` nevzniká, dokud perft 1–6 nesedí.

### 6.3 Sdílené fixtures

`fixtures/*.json`: pozice → setříděná množina očekávaných tahů. Spouští se proti TS `rules` a později proti Rust enginu — to je mechanismus, který drží obě implementace u sebe (3.3).

### 6.4 Integrační a e2e

Server ↔ engine přes skutečný podproces (hello, bestmove, timeout, kill+restart). E2e: partie random vs. random přes REST doběhne do výsledku (terminaci garantuje pravidlo 80 půltahů).

### 6.5 Self-play regrese

Nová verze enginu vs. předchozí, ~200 partií, střídání barev. Bez tohohle jsou „vylepšení“ evaluace jen pocit.

---

## 7. Plán prací — milníky

Pořadí je závazné. Odhady jsou pro hobby tempo (večery) a ber je jako hrubý řád, ne slib — odhady softwarových prací selhávají systematicky směrem k optimismu.

### M0 — Kostra repa (0,5–1 den)

Monorepo, TS strict, Vitest, lint, CI (GitHub Actions: lint + test na push). Hotovo: prázdný test projde v CI. Trade-off: půl dne „neviditelné“ práce; bez CI ale rozbité testy začneš ignorovat do týdne.

### M1 — Knihovna pravidel (3–6 dní) ← těžiště projektu

Typy z 3.5, generátor tahů (rekurze pro vícenásobné skoky), aplikace tahu, detekce konce a remíz, PDN zápis tahu, perft funkce. **Hotovo:** perft 1–6 sedí, všechny testy z 2.7 zelené. Co tu selže: větvení multi-skoků a proměna uprostřed skoku — proto se to celé staví na testech, ne na klikání. Tenhle milník nesmíš uspěchat; všechno ostatní na něm stojí.

### M2 — CLI hra (1 den)

Textové rozhraní: člověk vs. random, random vs. random. Hotovo: odehratelná partie v terminálu, random vs. random vždy terminuje. Účel: důkaz, že `rules` jsou kompletní, bez jediného řádku UI a serveru.

### M3 — Engine (3–5 dní)

Samostatný proces s protokolem z 3.7, negamax + alfa-beta + iterativní prohlubování, evaluace z 5.3. **Hotovo:** porazí random hráče ≥ 95 % z 100 partií a nikdy nepřekročí tvrdý timeout. Co tu selže: časová kontrola (viz 5.2) a zapomenuté prodloužení při povinných skocích.

### M4 — Server (2–3 dny)

Fastify, endpointy z 3.6, in-memory úložiště, engine jako spravovaný podproces s frontou, retry a restartem. **Hotovo:** kompletní partie odehratelná přes `curl`; test: kill enginu uprostřed přemýšlení → partie přežije. Co tu selže: synchronní volání enginu v handleru a zombie procesy.

### M5 — Webový klient (3–5 dní)

Vite + vanilla TS: šachovnice, výběr kamene, zvýraznění legálních tahů přes sdílenou `rules`, optimistická aplikace tahu + resync, stavový řádek, konec hry. **Hotovo:** definice hotového z sekce 0 splněna. Co tu selže: UI pro vícenásobné skoky (uživatel kliká sekvenci dopadů — navrhni interakci předem, doklikávání větví je nejhorší UX část celé hry) a rozjetý stav při zamítnutém optimistickém tahu.

### M6 — Hardening a volitelný Rust engine (2–4 dny + Rust dle chuti)

Zátěž: víc souběžných partií, chování fronty; úklid procesů; TT + Zobrist v TS enginu, pokud chceš sílu. Volitelně: Rust engine za stejným protokolem, validovaný fixtures a perftem, self-play proti TS enginu. Hotovo: TS a Rust engine prohoditelné konfigurací serveru.

---

## 8. Rizika

| Riziko | Dopad | Obrana |
|---|---|---|
| Divergence pravidel engine vs. `rules` | tichá korupce partií | server validuje každý tah; perft + fixtures (3.3, 6.3) |
| Začátek od UI | pravidla laděná klikáním, skryté bugy | pořadí milníků je závazné; UI až M5 |
| Blokující volání enginu | zamrzlé API | fronta + async + tvrdý timeout od prvního dne M4 |
| Zombie / spadlé engine procesy | visící partie | supervize, retry, test killu v M4 |
| Předčasná odbočka k WASM/bitboardům | týdny bez viditelného pokroku | Rust a bitboardy až M6, po měření |
| Scope creep (multiplayer, účty) | v1 nikdy nevyjde | seznam ne-cílů v sekci 1 |
| Chybné referenční perft hodnoty | ladění správného kódu | ověřit proti nezávislému zdroji (6.1) |

---

## 9. Otevřená rozhodnutí

- Přesná remízová čísla (80 půltahů je konvence, ne oficiální turnajové pravidlo) — konstanta v `rules`, rozhodni v M1 a otestuj.
- Úrovně obtížnosti (mapování na `timeMs`/hloubku, případně řízená chybovost) — rozhodnout před M5.
- Perzistence partií a nasazení (Docker?) — v2.
- Undo a prohlížení historie — server historii má, ale sémantika vůči enginu není zadarmo; v2.

# Endgame databáze: rešerše a rozsah

Rozhodovací dokument (fáze 65). Odpovídá na otázku „jak náročná je endgame
databáze pro americkou dámu" reálnými, změřenými čísly a končí **jedním
doporučením**, co stavět jako příští fázi. Není to implementace, je to podklad
pro rozhodnutí.

Zdroj čísel: `scripts/endgame-count.mjs` (jednorázový měřicí skript, není
produkční kód). Spustitelný `node scripts/endgame-count.mjs`, výsledky jsou
reprodukovatelné.

---

## TL;DR – doporučení

- **Stavět vlastní generátor (retrográdní analýza) pro koncovky do 6 kamenů
  včetně.** Data se generují jednou offline, uloží na disk a runtime je jen
  čte (read-only lookup na serveru/enginu).
- **Postupovat po řezech:** začít nejmenším užitečným krokem (≤ 4 kameny,
  triviální), pak ≤ 5, cílový řez ≤ 6.
- **Strop vlastního generátoru na tomto stroji je 6 kamenů.**
  - **7 kamenů** = šedá zóna: největší materiálová třída potřebuje ~8,9 GB RAM
    jen na hodnoty; reálně nutný external-memory (blokový) algoritmus se
    streamem na disk = samostatný projekt, mimo tento generátor.
  - **8 kamenů** = mimo možnosti tohoto stroje: největší třída ~104 GB RAM.
    Jediná cesta je **import Chinook DB**, a ten je **blokovaný nejasnou
    licencí** (viz níže).
- **Swap (64 GB) tenhle strop neposune.** Retrográdní analýza má náhodný
  přístup napříč celým polem; jakmile pracovní množina přeleze RAM, stroj
  stránkuje u skoro každého přístupu a propustnost spadne o 2-3 řády. 64 GB
  swapu tedy není 64 GB použitelné paměti. Použitelný strop = ~10 GB RAM.

---

## 1. Co je endgame databáze

Statická, jen ke čtení určená tabulka: pro každou pozici s malým počtem kamenů
uloží její teoretickou hodnotu při bezchybné hře. Není to perzistence stavu
partie (ta zůstává v paměti serveru) - je to znalostní data.

Dva druhy:

- **WLD** (Win / Loss / Draw) - jen výsledek: výhra, prohra, remíza. 2 bity na
  pozici. **Tohle chceme.** K cíli v2 („vzdorovat, remízovat dobré pozice,
  trestat chyby") stačí vědět výsledek, ne přesný počet tahů do výhry.
- **DTW / DTC** (Distance To Win/Conversion) - navíc počet tahů do výhry.
  Řádově větší, potřebné jen pro dokonalou konverzi výhry. Pro nás zbytečné.

Chinook je WLD. My budeme generovat WLD.

---

## 2. Naměřená čísla

Skript počítá počet **legálních rozestavění** s právě `k` kameny na 32 tmavých
polích: každý kámen ∈ {černý/bílý muž/dáma}, obě strany mají ≥ 1 kámen, a
**muž nikdy nestojí na své proměňovací řadě** (černý muž ne na polích 29-32,
bílý muž ne na 1-4 - tam by se proměnil v dámu, takže tam nikdy neodpočívá).
Strana na tahu prostor zdvojuje (× 2).

**Legalita = rozestavění, ne generování tahů.** Endgame DB indexuje pozice
podle materiálu, ne podle toho, jestli má někdo tah. Proto se správnost
neopírá o `legalMoves` z knihovny pravidel (ta přijme i muže na proměňovací
řadě), ale o **dva nezávislé algoritmy počítání, které se musí shodnout**:
přesnou dynamickou kombinatoriku (DP po polích) a hrubou enumeraci (brute
force) pro malé `k`. Skript při rozporu končí nenulovým kódem. Pozor na hranici
té kontroly: oba algoritmy sdílejí tutéž definici legality (zákaz mužů na
proměňovacích řadách), takže křížová kontrola ověřuje jen enumeraci, ne tu
definici - ta je ověřená zvlášť proti geometrii desky v `packages/rules/src/board.ts`
(pole 1-4 = řada 0 / strana černého, pole 29-32 = řada 7 / strana bílého).

| k | pozic (× 2 strana na tahu) | disk @ 2 bity (nekompr.) | největší 1 třída | RAM @ 1 B/třída |
|--:|--------------------------:|:------------------------:|:----------------:|:---------------:|
| 2 | 6 976 | 1,7 KB | 1č vs 1b | 3,4 KB |
| 3 | 392 064 | 95,7 KB | 1č vs 2b | 95,7 KB |
| 4 | 12 418 632 | 2,96 MB | 2č vs 2b | 2,54 MB |
| 5 | 278 901 616 | 66,5 MB | 2č vs 3b | 44,4 MB |
| 6 | 4 852 171 352 | 1,13 GB | 3č vs 3b | **747 MB** |
| 7 | 68 486 227 248 | 15,9 GB | 3č vs 4b | **8,87 GB** |
| 8 | 806 380 501 122 | 187,8 GB | 4č vs 4b | **103,7 GB** |

- **Součet pozic k = 2..8 (× 2):** 880 010 619 010.
- **Součet pozic k = 2..6 (× 2, cílový řez):** 5 143 890 640 (disk ~1,2 GB
  nekomprimovaně @ 2 bity, se symetrií ~0,6 GB, po kompresi řádově desítky MB -
  viz §3).

### Křížová kontrola proti Chinooku

Chinook uvádí pro ≤ 8 kamenů **443 748 401 247** pozic. Náš nezávislý počet
rozestavění **bez** faktoru strany na tahu je **440 005 309 505** - odchylka
**0,84 %**. To potvrzuje, že model pozic je správný a řády sedí. Zbylé < 1 %
je definiční nuance (jak přesně Chinook počítá stranu na tahu / symetrii /
hraniční pozice) a pro rozhodnutí o velikosti je nepodstatné.

---

## 3. Náročnost: paměť, disk, čas

### Paměť generování (retrográdní analýza)

Nepočítá se celá DB najednou. Retrográdní analýza jede **po materiálových
třídách** (kolik černých mužů/dam × kolik bílých mužů/dam) v pořadí závislostí:
nejdřív třídy s méně kameny, protože braní ubírá kámen a proměna mění typ, takže
následné pozice musí být už spočítané. Špičková RAM ≈ **největší jedna třída,
kterou se zrovna řeší** × ~1 bajt/pozice (hodnota WLD + stav propagace). Nižší
a následné třídy se čtou z disku read-only (mmap), nemusí být v RAM.

Z tabulky výše (sloupec „RAM @ 1 B/třída"):

- ≤ 5 kamenů: desítky MB - triviální.
- **6 kamenů: 747 MB** (třída 3č vs 3b). Pohodlně se vejde do 10 GB RAM i s
  rezervou na value + successor-count. **Realizovatelné.**
- **7 kamenů: 8,87 GB** (3č vs 4b). Těsně pod 10 GB jen pro hodnoty; s režií
  propagace přeteče. Reálně nutný external-memory algoritmus (bloky na disk) =
  samostatný projekt.
- **8 kamenů: 103,7 GB** (4č vs 4b). Nevejde se ani náhodou.

### Disk

Sloupec „disk @ 2 bity" je **nekomprimovaný horní odhad**. WLD data se ale
komprimují velmi dobře (velké souvislé oblasti mají stejnou hodnotu): Chinook
má ≤ 8 kamenů rozbaleno jen **5,6 GB** (a 2,7 GB zip), zatímco nekomprimované 2
bity/pozice by dělaly ~110 GB - tedy reálná komprese ~20×. Náš cílový řez ≤ 6
je i nekomprimovaně jen ~1,2 GB, po kompresi řádově desítky MB. Server má disk,
runtime je server-side only, klient DB nikdy nevidí - velikost tady není
překážka.

### Čas generování

Offline jednorázový krok, čas není runtime omezení („spustí se jednou, vytvoří
tabulky, pak se jen čtou"). Pozor ale: běží to v **Node/TS**, což je ~10-50×
pomalejší než C (Chinook). Pro ≤ 6 kamenů (miliardy pozic × iterace do
fixpointu) to reálně znamená hodiny až nižší jednotky hodin, ne minuty. Pro
offline krok přijatelné; přesnou dobu je nutné ZMĚŘIT při stavbě, ne slíbit od
stolu. (Kdyby to bylo neúnosné, je to přesně ten bod, kdy do hry vstupuje
podmíněný Rust engine / nativní generátor.)

---

## 4. Chinook: fakta a proč zatím ne

Fakta ověřená z <https://webdocs.cs.ualberta.ca/~chinook/databases/>:

- Pokrývá **všechny pozice s ≤ 8 kameny**, celkem 443 748 401 247 pozic.
- **2,7 GB zip / 5,6 GB rozbaleno.** Formát: ZIP archivy. Dělené do skupin:
  jeden soubor 2-6 kamenů, pět souborů 7 kamenů, dvacet souborů 8 kamenů.
  Velikosti jednotlivých souborů stránka NEUVÁDÍ.
- **WLD** (ne DTW).
- Přiložený **C kód** pro přístup (`code.c`), autoři sami píšou, že „není
  napsaný tak hezky, jak by měl". Vlastní schéma indexace pozic.
- **Žádná explicitní licence, copyright ani citační podmínky na stránce.**

Proč to zatím není cesta:

1. **Licence (hlavní blokátor).** Data jsou volně ke stažení, ale **bez
   uděleného práva na redistribuci**. Zabalit je do naší aplikace a nasadit je
   právně nejasné. Než by se Chinook importoval, musí se licence vyřešit
   (kontakt na autory: jonathan@cs.ualberta.ca, případně citace publikací
   Chinooku). Bez toho je import slepá ulička.
2. **Port indexace.** Chinookovo číslování pozic je nutné přeportovat z C do
   TS a namapovat na naši `Position` (packages/rules) - proměna, strana na
   tahu, orientace desky. To je většina práce a rizik importu.
3. **Nepotřebujeme 8.** Pro cíl „vzdorovat" pokryje drtivou většinu reálně
   rozhodných koncovek řez ≤ 6, který umíme vygenerovat sami, bez licence a
   bez cizího formátu.

Chinook tedy bereme jako (a) **referenci** pro ověření správnosti vlastního
generátoru (naše WLD verdikty musí sedět s Chinookem na překryvu ≤ 6 kamenů) a
(b) **fallback** pro 7-8 kamenů, kdyby se ukázaly potřeba a licence se vyřešila.

---

## 5. Návrh formátu tabulek a integračního bodu (skica, ne implementace)

### Formát na disku = kontrakt generátor ↔ lookup

Generátor zapisuje, runtime lookup čte - obě strany MUSÍ používat **totožnou
funkci indexace pozice → pořadí (rank)**. To je kontrakt mezi dvěma moduly,
proto: společný modul s ranking funkcí + test, který ověří `rank(unrank(i)) === i`
a shodu generátoru s lookupem na reálných pozicích (ne mock s natvrdo zadanou
hodnotou).

Návrh:

- **Rozdělení podle materiálové třídy** (jako Chinook): jeden soubor na
  kombinaci (černí muži, černé dámy, bílí muži, bílé dámy) + strana na tahu.
- **Deterministický rank pozice v rámci třídy:** kombinatorické pořadí
  obsazených polí (colex rank) + bity typů kamenů. Pozice → rank je bijekce na
  0..N-1 v dané třídě.
- **Hodnota:** 2 bity (WLD) na rank, baleno 4 pozice/bajt. Volitelně komprese
  (RLE) jako u Chinooku; rozhodne se podle naměřené velikosti.
- **Symetrie (volitelně, rozhodnutí příští fáze):** kanonizovat pozici na menší
  z {pozice, zrcadlo(pozice)} před lookupem → ~½ místa. Přidává složitost;
  u řezu ≤ 6, kde je i nekomprimovaná velikost ~1,2 GB, není nutná hned.

### Integrační bod

- **Runtime = server-side only.** DB se načte read-only (mmap) při startu
  enginu; klient ji nikdy nevidí.
- **Kdo se ptá:** engine při hledání. Když je na desce ≤ N kamenů, místo
  evaluace/dalšího hledání vezme z DB přesný WLD výsledek listu (nebo přímo
  rozhodne koncovku). To je reálná páka síly: v koncovce engine nehádá, hraje
  teoreticky správně (neprošustruje vyhranou/remízovou koncovku).
- **Autorita zůstává na serveru.** DB mění jen to, KTERÝ tah engine zvolí -
  nikdy neobchází validaci. Server ověří enginem vrácený tah stejnou cestou jako
  dnes. Žádná nová důvěryhodnostní plocha, DB jsou jen statická data.
- Volitelně stejný lookup využije i endpoint nápovědy (režim Výuka).

---

## 6. Rozhodnutí a otevřené otázky pro příští fázi

**Rozhodnutí:** vlastní WLD generátor retrográdní analýzou, cílový řez **≤ 6
kamenů**, stavěný po krocích od ≤ 4. Strop 6 na tomto stroji; 7 = external-memory
(samostatný projekt), 8 = import Chinooku (blokováno licencí).

Otevřené, k rozhodnutí/změření v příští (stavební) fázi:

- Přesná doba generování ≤ 6 v Node - ZMĚŘIT, ne slíbit. Podklad pro případný
  nativní generátor.
- Přesný formát ranku a souborů (viz §5) + sdílený modul a jeho test.
- Zda hned řešit symetrii (½ místa vs. složitost).
- Od kolika kamenů dolů se DB v enginu aktivuje a jak se váže na quiescence /
  koncové uzly hledání.
- Ověřovací sada: srovnat naše WLD verdikty s Chinookem na vzorku ≤ 6 (Chinook
  jako reference, i bez importu se dá dotázat jeho online query rozhraní nebo
  lokálně ověřit na malém vzorku).

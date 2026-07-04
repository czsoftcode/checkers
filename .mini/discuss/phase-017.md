# Phase 17 — Transpoziční tabulky + Zobrist hash

## Intent
Zbývající kus todo 15: search dostane Zobrist hash pozice + transpoziční
tabulku (TT), aby přes transpozice ubylo prohledaných uzlů → hlubší search za
stejný čas. Poziční evaluace (druhá půlka todo 15) je hotová z fáze 16. Cíl
této fáze je RYCHLOST/hloubka, ne síla evaluace.

Hashuje se `Position` = `board` (32 polí, každé `null | {color, kind}`, tj. 4
typy kamene × 32 polí) + `turn`. Hash žije JEN v enginu; `Position` ani balík
`rules` se NEmění (sdílí je server/klient, žádný důvod je zatěžovat).

## Key decisions
- **Přesnost kořene je tvrdý kontrakt.** Kořen (`search.ts:150-170`) sbírá
  VŠECHNY tahy se shodným nejlepším skóre — podklad pro tie-break a kalibraci
  remíz. Trik okna `best - 1` funguje jen s PŘESNÝMI skóre; TT vrací meze
  (lower/upper). → TT čte i píše JEN uvnitř `negamax` (ply ≥ 1). Kořen zůstává
  přesný jako dnes, z TT bere maximálně pořadí tahů (zkusit uložený nejlepší
  jako první), NE skóre/cutoffy.
- **Brána na MNOŽINU tahů, ne na jeden tah.** Brána porovnává celou množinu
  `bestMoves` A skóre mezi TT-on a TT-off na sadě fixtures a několika fixních
  hloubkách. Rozejití = FAIL (TT porušila přesnost kořene). Vedle toho brána
  měří úbytek prohledaných uzlů (musí prokazatelně klesnout).
- **Klíč = 53-bit číslo** (JS `number`), ne BigInt. Rychlé, bez alokace na
  horké cestě. Vědomě přijatá mizivá šance kolize (~10⁻⁵ na dlouhém běhu) —
  pro hloubky 5-6 v pohodě. Zobrist hodnoty tedy 53-bit celá čísla.
- **Hashování PŘEPOČTEM z 32 polí v každém uzlu** (zatím), ne inkrementálně.
  Jednodušší; inkrement (XOR rozdílu z tahu: kámen, braní, proměna, obrat
  strany) je pozdější optimalizace, když bude potřeba.
- **Životnost TT:** jedna tabulka na volání `searchTimed`, sdílená napříč
  iterativním prohlubováním (hlavní zisk), na začátku KAŽDÉHO volání vyčištěná.
  Bez stárnutí záznamů / bez držení přes partii (nedeterminismus, složitost) —
  do v1 ne.
- **Struktura TT:** pole PEVNÉ velikosti (index = otisk mod velikost), náhrada
  „preferuj hlubší záznam", při ČTENÍ ověřit plný klíč (kvůli kolizím kbelíku).
  Předvídatelná paměť — engine má tvrdý timeout, `Map` rostoucí s unikátními
  pozicemi by mohl na dlouhém přemýšlení nafouknout paměť.
- **Orientační měření času** (čas-do-hloubky) přidat vedle brány jako
  NEblokující kontrolu — ať neodešleme TT, co je na hodinách pomalejší, i když
  uzlů ubylo.

## Watch out for
- **Node-gate ≠ zrychlení na hodinách.** Brána měří úbytek uzlů; režie
  hashování (přepočet 32 polí/uzel) + čtení TT ji může sežrat. Reálná síla na
  čas může být horší, než úbytek uzlů naznačuje → proto orientační měření času.
- **Tři typy záznamu (exact / lower / upper) jsou notorický zdroj tichých
  chyb**: špatná kontrola hloubky (použít záznam jen když `entry.depth >=
  zbývající hloubka`), špatné určení typu meze (fail-high → lower, fail-low →
  upper, jinak exact), návrat skóre z jiné hloubky. Chce to cílené testy
  (search s TT vs. bez TT musí na fixtures vrátit stejnou množinu bestMoves i
  skóre), ne „běží to".
- **Kolize kbelíku vs. kolize klíče.** Ověření plného 53-bit klíče při čtení
  chytne kolizi kbelíku (dvě pozice, stejný index), NE kolizi klíče (dvě pozice,
  stejný 53-bit otisk) — ta zůstává vědomě přijatým rizikem (viz rozhodnutí o
  klíči).
- **Skóre zůstávají CELÁ čísla** (kontrakt z evaluate.ts / trik okna `best-1`).
  TT nesmí zavést žádné float.
- **WIN_SCORE - ply záznamy:** skóre výhry závisí na `ply` (vzdálenost od
  kořene). Uložit/číst mat-skóre přes TT bez korekce na ply je klasická chyba
  (mat v jiné hloubce). Buď mat-skóre v TS neukládat/nepoužívat pro cutoff, nebo
  korigovat o ply — rozhodnout v plan.

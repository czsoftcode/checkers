# Phase 65 — Endgame DB: rešerše a rozsah

## Intent
Rešeršní/rozhodovací fáze bez produkčního DB kódu. Výstup = jeden dokument
v `docs/` (např. `docs/endgame-db.md`), který s reálnými čísly odpoví, jak
náročná je endgame databáze pro americkou dámu, a doporučí nejmenší
realizovatelný řez jako příští stavební fázi. Motivace: nevrhnout se na
443miliardový Chinook (2.7 GB) bez rozmyslu ohledně velikosti, licence a
integrace.

## Hardware & paměťový strop (dev stroj: ~10 GB volné RAM, 64 GB swap)
- **Paměť retrográdní analýzy ≈ největší JEDNA materiálová třída × ~1 bajt/pozice**
  (WLD hodnota + stav propagace během výpočtu; hotová tabulka pak packed na 2 bity
  na disk). Nepočítá se celá DB najednou — jede se po materiálových třídách
  (černí kameny/dámy × bílí kameny/dámy) v pořadí závislostí; nižší/následné
  třídy (po braní/proměně) se čtou z disku read-only (mmap), nemusí být v RAM.
- Řádové odhady (32 polí; přesná čísla po třídách = úkol měřicího skriptu):
  - ≤ 5 kamenů: < 10^8 pozic → < 100 MB → triviální.
  - 6 kamenů: ~1-4 mld. pozic, největší třída stovky M-~1,5 mld. → ~0,5-1,5 GB
    → VEJDE se do 10 GB RAM s dávkováním po třídách; generování offline minuty-
    desítky minut.
  - 7 kamenů: ~3-4×10^10, největší třída jednotky mld. → ~3-8 GB/třída → na hraně,
    jen s external-memory (blokovým) algoritmem streamujícím na disk = samostatný
    projekt, ne tato ani příští fáze.
  - 8 kamenů: ~4,4×10^11, největší třída desítky mld. → ~20-60+ GB/třída → NEVEJDE.
- **Swap NEZACHRÁNÍ velký počet kamenů.** Retrográdní analýza má náhodný přístup
  napříč celým indexovým polem; jakmile pracovní množina přeleze RAM, stránkuje
  u skoro každého přístupu → propustnost o 2-3 řády dolů, výpočet reálně neskončí.
  64 GB swapu tedy NENÍ 64 GB použitelné paměti pro tuhle úlohu. Použitelný strop
  = ~10 GB RAM.
- **Node/TS penalta:** i kdyby se vešlo, JS retrográd je ~10-50× pod C (Chinook).
  7 kamenů = paměťově na hraně A časově týdenní projekt; 8 = ne (proto Chinook).
- **ZÁVĚR pro strop:** reálný vlastní generátor **do 6 kamenů** na tomto HW;
  7 = šedá zóna (external-memory, mimo rozsah); 8 = import Chinooku (2,7 GB, po
  vyřešení licence + portu indexace). Toto číslo (≤ 6) by měl dokument potvrdit
  naměřenými počty pozic z měřicího skriptu, ne přijmout jen z tohoto odhadu.

## Key decisions
- **Měřicí skript ANO (throwaway).** Cíl „bez produkčního kódu" nevylučuje
  jednorázový skript, který přes náš `rules` generátor NAPOČÍTÁ reálný počet
  legálních pozic pro 2, 3, 4 (příp. 5) kamenů — se stranou na tahu, korekcí
  symetrie, respektováním povinného braní a proměny. Odpověď „jak náročné"
  musí stát na měření z našeho vlastního `rules`, ne na odhadu od stolu.
  Skript se po fázi zahodí / zůstane jako scratch, nejde do produkce.
- **Runtime = server-side only.** DB nikdy nevidí klient; lookup je čistě na
  serveru (sedí s „server je autorita"). Za běhu server má normální disk →
  strop velikosti je velkorysý. Toto omezení určuje, co je únosné.
- **Generování = offline build krok, ne runtime.** „Spustí se jednou, vytvoří
  tabulky, pak se jen čtou." Čas generování tedy NENÍ omezení — retrográdní
  analýza smí běžet minuty. Tlačí to k vlastnímu generátoru u malého řezu.
- **Příklon: vlastní retrográdní generátor pro malý počet kamenů**, pokud
  vyjde lepší (plná kontrola, žádná licence, malá data, přímo na naší
  `Position`). Chinook brát primárně jako REFERENCI pro ověření správnosti
  vlastního generátoru (WLD verdikt musí sedět) a jako fallback pro velký
  počet kamenů.
- **Dokument leží v `docs/`.**

## Watch out for
- **Doporučení nebude „import vs. generátor" natvrdo, ale řez + strop.**
  Vlastní generátor je lepší jen do nízkého počtu kamenů (2-4, možná 5). U 6-8
  retrográdní analýza narazí na paměť a indexaci = samostatný týdenní projekt,
  který Chinook už vyřešil. Rešerše MUSÍ pojmenovat strop KONKRÉTNÍM ČÍSLEM
  (kameny), za kterým je import jediná rozumná cesta — ne mlžit.
- **Formát tabulek na disku je kontrakt mezi dvěma moduly** (generátor zapisuje,
  runtime lookup čte): jak se pozice indexuje → WLD výsledek. Formát je součást
  rozhodnutí, ne detail k odložení.
- **Riziko slabé rešerše:** bez aspoň jednoho reálného čísla z našeho `rules`
  (počet pozic 2-4 kamenů) je „rešerše náročnosti" jen esej. Verifikovatelnost
  fáze = dokument obsahuje NAMĚŘENÁ čísla a JEDNU volbu řezu, ne výčet možností.
- **Chinook fakta pro dokument:** ≤ 8 kamenů, 443 748 401 247 pozic, 2.7 GB zip
  / 5.6 GB rozbaleno, WLD (ne DTW), přiložený neoptimální C kód pro přístup,
  vlastní schéma indexace pozic (port do TS = většina práce a rizik: proměna,
  strana na tahu, orientace desky), ŽÁDNÁ explicitní licence na stránce
  (licenční riziko = musí se dohledat/vyřešit, jinak je import slepá ulička).
- **Pasti při počítání pozic:** proměna (kámen na zadní řadě), povinné braní
  (mění dosažitelnost/legalitu), strana na tahu (zdvojuje prostor), symetrie
  desky (redukuje). Skript to musí ošetřit, jinak čísla lžou.

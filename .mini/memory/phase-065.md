# Phase 65 — Endgame DB: rešerše a rozsah

**Goal:** Sepsat rozhodovací dokument, který s konkrétními čísly odpoví, jak náročná je endgame databáze pro americkou dámu (počet kamenů, velikost/formát, generovaná vs. externí Chinook data, náročnost retrográdní analýzy, integrační bod), a doporučí první realizovatelný řez — bez psaní produkčního DB kódu.

## Steps
- [done] Měřicí skript: přesné počty pozic 2-5 kamenů
- [done] Extrapolace na 6-8 kamenů + paměť a velikost
- [done] Chinook: fakta, formát, indexace, licence
- [done] Návrh formátu tabulek a integračního bodu
- [done] Rozhodovací dokument docs/endgame-db.md s doporučeným řezem
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 65: Endgame DB: rešerše a rozsah

## Discussion
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

## Run report
---
phase: 65
verdict: done
steps:
  - title: "Měřicí skript: přesné počty pozic 2-5 kamenů"
    status: done
  - title: "Extrapolace na 6-8 kamenů + paměť a velikost"
    status: done
  - title: "Chinook: fakta, formát, indexace, licence"
    status: done
  - title: "Návrh formátu tabulek a integračního bodu"
    status: done
  - title: "Rozhodovací dokument docs/endgame-db.md s doporučeným řezem"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
verify:
  - title: "Přečíst docs/endgame-db.md a odsouhlasit doporučený strop ≤6 kamenů"
    detail: "Rozhodnutí (vlastní generátor do 6 kamenů, 7 = jiný algoritmus, 8 = import Chinooku blokovaný licencí) je věcné, ale je to strategická volba pro celé pokračování v2 - patří na tvůj stůl, ne na můj. Čísla, o která se opírá, jsou změřená a nezávisle ověřená; posoudit je třeba směr, ne aritmetiku."
---

# Phase 65 — report z auto session

Rešeršní fáze, žádný běhový kód se nezměnil. Výstupy: `docs/endgame-db.md`
(rozhodovací dokument) a `scripts/endgame-count.mjs` (jednorázový měřicí skript,
není produkční).

## Co se povedlo

- **Čísla jsou změřená, ne odhadnutá.** Skript počítá počet legálních
  rozestavění pro k = 2..8 přesnou kombinatorikou (DP) a nezávisle brute-force
  pro k = 2,3,4; při rozporu končí nenulovým kódem (ověřené zuby - sub-agent
  reálně rozbil obě větve a dostal exit 1).
- **Externí validace:** náš nezávislý počet (bez ×2) 440 005 309 505 sedí na
  Chinookem uváděných 443 748 401 247 s odchylkou 0,84 %. Potvrzuje model pozic.
- **Strop je podložený měřením:** 6 kamenů = největší třída 747 MB RAM (vejde se
  do 10 GB), 7 = 8,87 GB (šedá zóna, external-memory), 8 = 103,7 GB (jen import).
- **Doporučení je jedno, ne výčet:** vlastní WLD generátor retrográdní analýzou,
  cílový řez ≤ 6 kamenů, stavěný po krocích od ≤ 4.
- Dokument poctivě odlišuje změřené od odhadu (čas generování v Node ~10-50×
  pod C = ZMĚŘIT při stavbě; komprese WLD ~20× dle Chinooku; RAM 1 B/pozice je
  optimistický spodní odhad).

## Odchylka od plánu (přiznaná)

- Krok „Legalitu ověří přes legalMoves" jsem záměrně nesplnil doslova:
  `legalMoves` legalitu **rozestavění** nedefinuje (přijme i muže na proměňovací
  řadě - to je otázka umístění, ne generování tahů). Správnost místo toho stojí
  na dvou nezávislých algoritmech počítání + křížové kontrole proti Chinooku.
  Definice zakázaných řad je ověřená zvlášť proti `packages/rules/src/board.ts`.
- Krok 2 „extrapolace na 6-8" se ukázal zbytečný jako extrapolace: DP počítá
  6-8 přesně (levná kombinatorika), takže tam nejsou odhady, ale přesná čísla.
  To je silnější, ne slabší.
- Rules se do skriptu neimportuje: balíček exportuje `.ts` s `.js` specifikátory,
  což Node bez build kroku mimo vitest nerozběhne. Geometrie je proto do skriptu
  převzatá z board.ts a ověřená sub-agentem. Skript je čisté JS, spustitelné
  `node scripts/endgame-count.mjs`.

## Nezávislý self-review (sub-agent, čerstvý kontext)

Všechny tři prověřované body PASS (zuby skriptu, shoda čísel doc↔skript,
podloženost doporučení). Dva drobné nálezy opraveny: „0,85 %" → „0,84 %";
formulace „dvě nezávislé metody" upřesněna (nezávislé v enumeraci, sdílená
definice legality ověřená proti board.ts). Třetí nález (1 B/pozice je
optimistické) byl už v dokumentu přiznaný.

## Otevřené otázky pro příští (stavební) fázi

Sepsané v §6 dokumentu: přesná doba generování ≤ 6 v Node (změřit), přesný
formát ranku a souborů + sdílený modul s testem (kontrakt generátor↔lookup),
zda hned řešit symetrii, od kolika kamenů DB v enginu aktivovat, ověřovací sada
proti Chinooku.

## Pozn. k ADR

Padlo reálné rozhodnutí s odmítnutou alternativou (vlastní generátor vs. import
Chinooku; strop 6 vs. 7/8). Zvaž před `mini done` spustit `/mini:decision`,
ať je zaznamenané PROČ (licence Chinooku + paměťový strop 10 GB), ne jen výsledek.

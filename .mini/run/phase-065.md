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

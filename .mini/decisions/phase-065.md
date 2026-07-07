# Endgame DB: vlastní WLD generátor do 6 kamenů, ne import Chinooku

## Decision
Endgame databázi postavíme jako vlastní WLD generátor retrográdní analýzou s cílovým řezem <=6 kamenů, generovaný jednou offline a čtený read-only na serveru. Import hotové Chinook DB (<=8 kamenů) odmítnut. Strop 6 kamenů je tvrdý pro tento vývojový stroj: 7 = jiný (external-memory) algoritmus mimo tento generátor, 8 = jedině import.

## Why
Zvažen a odmítnut import Chinook DB (443,7 mld. pozic, <=8 kamenů, 2,7 GB). Dva důvody proti: (1) nejasná licence - data jsou volně ke stažení, ale bez uděleného práva na redistribuci, takže zabalit je do aplikace je právně riskantní a bez vyřešení s autory je to slepá ulička; (2) port cizí indexace z C do naší Position je většina práce a rizik importu. Vlastní generátor dává plnou kontrolu, žádnou licenci a data přímo na naší knihovně pravidel.

Řez <=6 zvolen proti ambicióznějším 7-8 na základě naměřené paměti (scripts/endgame-count.mjs): největší materiálová třída má u 6 kamenů 747 MB (vejde se do ~10 GB RAM), u 7 už 8,87 GB (přeteče s režií retrográdky) a u 8 kamenů 103,7 GB (nemožné). Swap tenhle strop neposune - retrográdní analýza má náhodný přístup napříč celým polem, takže po přetečení RAM stroj jen stránkuje a výpočet reálně neskončí. Chinook zůstává jako referenční kontrola správnosti a případný fallback pro 7-8, pokud se licence vyřeší.

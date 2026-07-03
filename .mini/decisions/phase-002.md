# Pozice jako pole 32 políček, ne bitboardy

## Decision
Pozice v knihovně rules je reprezentovaná jako pole 32 políček (Cell[], index = číslo pole − 1) + strana na tahu. Bitboardy se nezavádějí; případný přechod na ně je odložený do M6 a jen podmíněně.

## Why
Zvažovaná a odmítnutá alternativa: bitboardy (pozice zakódovaná do 32bitových masek) – znatelně rychlejší generování tahů, což by pomohlo hloubce prohledávání TS enginu. Odmítnuto, protože M1 je těžiště správnosti celého projektu (perft, sdílená pravidla pro server, klienta i engine) a pole políček je řádově čitelnější a laditelnější; chyba v bitové magii by se přes nesedící perft hledala mnohem hůř. Trade-off přijatý vědomě: pokud TS engine nedosáhne cílové síly, přepis vnitřku rules bude práce navíc – rozhraní a testy ale zůstávají, takže se nezačíná od nuly. Rozhoduje se znovu nejdřív v M6, na základě změřené síly enginu, ne dopředu.

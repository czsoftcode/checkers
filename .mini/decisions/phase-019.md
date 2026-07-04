# Autorita barvy na POST /moves místo spoléhání na findLegalMove

## Decision
Když je zapojený engine, POST /games/:id/moves explicitně odmítá tah člověka, pokud je na tahu engine (bílý) — nový chybový kód not_your_turn (409). Nespoléhá se jen na findLegalMove.

## Why
Diskuze fáze 19 rozhodla opak: „zdvojený tah člověka odmítne autorita sama (není černý na tahu → prázdný seznam → 409), žádné zvláštní if navíc." To ale platí jen pro tah ČERNÝM kamenem. findLegalMove hledá legální tah pro stranu na tahu — když engine přemýšlí (bílý na tahu), legální BÍLÝ tah od klienta najde a přijme. Klient by tak mohl zahrát za engine a přepsat mu pozici pod rukama (TOCTOU: runEngineMove počítá nad snímkem, který mezitím přestal platit). Adversarial review to odhalil jako díru v autoritě serveru. Explicitní guard barvy je nutný if navíc — bez něj server není jediná autorita, jak projekt vyžaduje. Doplněno o re-fetch stavu v runEngineMove po awaitu jako obrana do hloubky.

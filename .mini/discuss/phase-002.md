# Phase 2 — Typy a deska (rules)

## Intent
Položit základní slovník knihovny `rules`, na kterém stojí všechny další fáze M1: typy (Color, Cell, Position, Move), standardní číslování hracích polí 1-32, převody číslo pole ↔ souřadnice řádek/sloupec a předpočítané tabulky NEIGHBORS[32][4] a JUMPS[32][4] pro 4 diagonální směry. Generátory tahů v dalších fázích budou z těchto tabulek jen číst.

## Key decisions
- **Jednoduchá reprezentace pozice, ne bitboardy:** pozice = pole 32 políček (prázdno / bílý muž / bílá dáma / …). Čitelné, testovatelné. Bitboardy jsou vědomě odložené do M6 a jen podmíněně (pokud engine nestíhá hloubku v limitu). Uživatel souhlasil s trade-offem: případný pozdější přepis vnitřku rules = práce navíc, ale rozhraní a testy zůstanou.
- **Standardní číslování americké dámy (PDN):** pole 1-4 nahoře (strana černého), 29-32 dole (strana bílého), černý táhne první. Potvrzeno uživatelem — tchán zná standardní zápis, žádná odchylka.
- Tabulky NEIGHBORS/JUMPS jsou předpočítané (ne počítané za běhu) — jednodušší testování a rychlost, za cenu toho, že chyba v generátoru tabulek se zafixuje.

## Watch out for
- Chyba v číslování/tabulkách se neprojeví hned, ale až za několik fází jako nesedící perft. Brána proto vyžaduje testy proti **ručně spočítaným** hodnotám (konkrétní pole a jejich sousedé), ne proti hodnotám vygenerovaným tímtéž kódem.
- Liché a sudé řady mají v číslování 1-32 posunutý vzor tmavých polí — nejčastější místo chyby v převodu souřadnic.
- Indexy směrů v NEIGHBORS a JUMPS musí používat stejnou konvenci (stejný index = stejný směr) — JUMPS[pole][směr] je „dopad za NEIGHBORS[pole][směr]".
- Návrh typu Move musí už teď počítat s vícenásobnými skoky (sekvence dopadů + seznam přeskočených kamenů), i když se generují až v pozdější fázi.

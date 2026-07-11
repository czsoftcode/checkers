# Ověření pool perftu: druhá implementace místo publikovaných čísel + bezpodmínečná zarážka proměny

## Decision
Brána (a) se opírá o nezávislou druhou implementaci generátoru, ne o publikovaná ruská perft čísla. Zarážka „muž braním na dámské řadě končí" je v moves.ts bezpodmínečná (bez pole v Ruleset). Chybu v pool generátoru (muž nelegálně pokračoval přes dámskou řadu) jsem opravil v rámci této fáze, ne odložil jako blokaci.

## Why
- Druhá impl místo publikovaných čísel: plán preferoval publikovaná ruská 8×8 perft čísla (nezávislá na mém výkladu pravidel). Rešerše je nenašla — veřejně existují jen 10×10 mezinárodní. Zvolena dokumentovaná záloha z discuss. Trade-off: cross-check dvou vlastních implementací nedokazuje správnost pravidel (sdílený výklad autora), jen vzájemnou shodu; správnost drží jen externě ověřené zdroje (APCA/Wikipedia). Odmítnuto: čekat na neexistující zdroj / stavět ruskou variantu jen kvůli číslům.
- Bezpodmínečná zarážka: alternativa — zavést hned promoteMidCapture do Ruleset — odmítnuta jako dead config (ruská proměna-pokračuj-jako-dáma je mimo řez). Stop je správný pro pool i americkou. Cena: budoucí RUSSIAN_RULESET bude mít stejnou konfiguraci jako POOL_RULESET a tiše dostane pool chování, dokud se to pole nepřidá (zdokumentováno v komentářích).
- Oprava v rámci fáze: premisa „pool kompletní po fázi 95" neplatila; oprava je malá, lokální a americká čísla nechává bajt-identická. Odmítnuto blokovat — bez opravy nešlo vytvořit pravdivou pool fixturu, což byl cíl fáze.

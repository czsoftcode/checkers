# Phase 114 — Italská: FID kvalitativní priorita

## Intent
Přidat do `legalMoves` (packages/rules/src/moves.ts) kvalitativní kaskádu FID pravidla 7 pro `capturePriority='italianFull'`, aplikovanou NAD max-množinou z IT-3. Zúží `legalMoves` na přeživší množinu podle uspořádaných tie-breaků. Po této fázi je italská braní kompletní na úrovni legalMoves (IT-2 muž nebere dámu + IT-3 maximum + IT-4 kvalita); definitivní ověření je až perft v IT-5.

## FID pravidlo 7 (doslova, zafixovaný zdroj = fid.it/corsi/10regoleita.asp)
"Avendo più possibilità di presa si debbono rispettare NELL'ORDINE le seguenti priorità:
1. è obbligatorio mangiare dove ci sono più pezzi;   (nejvíc kamenů — IT-3, HOTOVO)
2. a parità di pezzi tra pedina e dama, quest'ultima è obbligata a mangiare;   (dáma > muž)
3. la dama sceglie la presa dove si mangiano più dame;   (nejvíc braných dam)
4. a parità di condizioni si mangia dove s'incontra prima la dama avversaria."   (nejdřív braná dáma)
Ověřeno z FID: "s'incontra prima" = POŘADÍ V SEKVENCI BRANÍ, NE číslování polí.

## Key decisions
- **3-stupňový filtr-řetěz nad max-množinou, výstup = MNOŽINA všech plně shodných přeživších** (ne jeden tah). Potvrzeno uživatelem. Uspořádaná kaskáda: další stupeň rozhoduje jen při rovnosti předchozího.
- **Zjednodušení z IT-2:** protože muž NIKDY nebere dámu, mužova sekvence neobsahuje dámu → klauzule 3 a 4 mají smysl jen mezi tahy beroucími DÁMOU (muž = 0 dam, žádnou nepotká). Filtr-řetěz to řeší přirozeně bez speciálního casování:
  - stupeň 2: existuje-li v max-množině tah, kde bere dáma (`kind` na `move.from === 'king'`), vypustit všechny mužovy tahy; jinak nechat vše.
  - stupeň 3: mezi přeživšími nechat ty s NEJVÍC branými dámami (count kingů v `move.captures`).
  - stupeň 4: mezi přeživšími nechat ty, kde první braná dáma má NEJMENŠÍ index v `move.captures`.
- **Metriky (čtené z pozice PŘED tahem = `position` předané do legalMoves; braní ještě na desce):**
  - kdo bere = `position.board[move.from-1].kind` (italská nemá proměnu uprostřed braní → konstantní po celou sekvenci).
  - kolik dam = počet polí v `move.captures`, kde `position.board[sq-1].kind === 'king'`.
  - kdy vzal první dámu = nejmenší index `i`, kde `move.captures[i]` drží dámu.
- **Konkrétní pojmenovaná funkce `italianQualityFilter(maxSet, position)`** kvůli testovatelnosti; ŽÁDNÝ obecný komparátor/framework pro budoucí varianty (non-goal).
- **Umístění:** uvnitř stávajícího bloku `if (ruleset.mustCaptureMaximum)` (moves.ts ř. ~432-435). Změnit z `return jumps.filter(...)` na: spočítat `maxSet`, a `if (ruleset.capturePriority === 'italianFull') return italianQualityFilter(maxSet, position);` jinak `return maxSet`. Kvalita běží AŽ ZA maximem.

## Watch out for
- **`move.captures` MUSÍ být v pořadí sekvence braní** — klauzule 4 (nejmenší index dámy) na tom stojí. V `extendJumps` se `captures.push(over)` děje v DFS pořadí a list kopíruje `[...captures]`, takže captures[0] = první brané pole. Kdyby se pořadí kdy obrátilo, klauzule 4 se tiše rozbije. Fixture pro stupeň 4 to musí prokázat na sekvenci, kde záleží na pořadí.
- **Coupling italianFull ↔ mustCaptureMaximum:** kvalita běží UVNITŘ max-bloku, takže italianFull BEZ mustCaptureMaximum by se tiše nespustil vůbec. Italská nastavuje OBA flagy, takže OK; nezavádět guard na nesmyslnou kombinaci (YAGNI), ale okomentovat předpoklad.
- **Regrese:** kvalita je vázaná na `capturePriority === 'italianFull'`; ostatní varianty ('none') se jí netknou. Česká `kingCapturePriority` je oddělený blok výš — NEsahat na něj, czech testy zelené. Perft 1-6 american/pool/russian/czech beze změny čísel.
- **Fixture se zuby na KAŽDÝ stupeň zvlášť:** (2) dáma i muž berou stejný max počet → mužův tah zmizí, dámin zůstane; (3) dva dámou-tahy stejného počtu, jeden bere víc dam → zůstane ten s víc dámami; (4) dva dámou-tahy stejného počtu i stejného počtu dam, liší se KDY přijde první dáma → zůstane ten s dřívější dámou; plus kontrola, že plná shoda nechá množinu (víc tahů). Kontrola flag-vázanosti: stejná pozice s AMERICAN_RULESET kvalitu neuplatní.
- **IT-5 = definitivní razítko.** Tato fáze je „správně podle fixture"; subtilní chybu v klauzuli 4 chytne až nezávislý FID perft v IT-5. Uživatel to bere na vědomí.
- **Tato fáze NESAHÁ na generátor** (extendJumps atd.) ani na applyMove — jen `legalMoves` + nová funkce.

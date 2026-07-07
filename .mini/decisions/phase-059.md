# Testy enginu s prázdnou knihou místo mimo-knižního tahu

## Decision
Engine-mechanické testy (engine-move, resign, offer-draw, hint, gate, archive) stavějí server s PRÁZDNOU knihou zahájení (buildApp({ openingBook: new Map() }) přes lokální wrapper build()), místo aby hrály první tah mimo knihu. Kniha se konzultuje jen uvnitř runEngineMove na úrovni Profesionál; prázdná kniha vrátí u každé pozice undefined, takže se vždy zavolá engine – chování je identické jako před naplněním knihy.

## Why
Fáze 59 přidala 9-13 do knihy a tím tiše rozbila 9 engine testů: hrály legalMoves[0] (= 9-13), server zahrál knižní 21-17 místo injektovaného stubu → timeouty u visících/chybujících stubů a FALEŠNÉ úspěchy u legálních (test prošel přes knihu, ne engine).

Zvážené a zamítnuté alternativy:
- Hrát první tah mimo knihu (např. 12-16): menší diff, ale jen odklad – v pozdější fázi (12-16 je poslední komplex) se zabookuje a testy padnou znovu; navíc by rozbilo board-asserty v gate.test (očekává engine 23-18 po 9-13).
- Partie na úrovni bez knihy (beginner): mění cestu síly enginu a některé testy explicitně ověřují default Profesionál.

Prázdná kniha vyhrála, protože je budoucnost-odolná: fáze 60-63 přidají zbývající první tahy (9-14, 10-14, 10-15, 11-16, 12-16) a tyto testy už kolizi s knihou řešit nebudou. Kniha je injektovatelná právě kvůli tomuto (option existuje od fáze 56).

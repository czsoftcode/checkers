# applyMove validuje strukturu, ne legalitu

## Decision
applyMove ověřuje jen strukturu tahu (kámen strany na tahu na from, geometrie kroků bez teleportů, volné dopady, soupeř na braných polích, captures bez duplicit) a při porušení vyhazuje RangeError. Plnou legalitu (povinnost braní, směr muže, úplnost skokové sekvence) nekontroluje – každý tah zvenčí musí projít bránou členství v legalMoves, kterou drží server.

## Why
Zvažovaná a odmítnutá alternativa: plná validace uvnitř applyMove (tah je legální ⇔ je v legalMoves). Odmítnuto kvůli enginu – v prohledávání volá applyMove milionkrát na tahy, které právě sám vygeneroval, a plná validace by pokaždé znovu generovala všechny tahy (zdvojnásobení nejdražší operace bez přínosu). Server naopak seznam legalMoves potřebuje tak jako tak (odpověď 409 s legálními tahy), takže brána členství je tam zadarmo. Trade-off přijatý vědomě: strukturálně korektní nelegální tah applyMove aplikuje a pokazí partii pravidlově (např. „pokračování po proměně“ vyrobí muže místo dámy) – proto je brána na serveru POVINNÁ, což hlídá docstring i test kontraktu. Geometrická kontrola (soused/skoková čára) se do struktury vzala, protože je O(délka tahu) a chrání desku před datovou korupcí.

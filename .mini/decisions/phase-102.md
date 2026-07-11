# Varianta vázaná na instanci LocalClient, ne přes createGame

## Decision
Varianta partie se v AIvP váže pevně na instanci LocalClient (LocalClientOptions.variant, default 'american'). main.ts drží Web Worker jako singleton, ale při každém vstupu do sóla zakládá čerstvý LocalClient podle volby z lobby. Sdílené rozhraní ServerClient.createGame zůstalo beze změny; variantu zpět nese nové volitelné pole GameDto.variant (default american), ze kterého ji controller/selection čtou.

Vedlejší rozhodnutí: preferenci úrovně (LocalStorage klíč checkers.level) ukládá JEN americká varianta; ne-americká ji čte jako default, ale nikdy nezapisuje.

## Why
Zvažoval jsem protáhnout variantu jako parametr createGame(level, humanColor, ballotIndex?, variant?). Zamítnuto: ServerClient je sdílený kontrakt s HTTP/PvP cestou (server je autorita, jeho DTO v tomto řezu zůstává na D3) - přidání parametru by rozšířilo rozhraní, které PvP variantu nemá, a svádělo by k přepínání varianty za běhu nad jedním klientem. Vázání na instanci naopak dělá 'přepnutí varianty zahodí partii a začne novou' strukturálně vynuceným (nová varianta = nový klient = nová hra, žádný discard dialog ani mutace stavu), drží createGame čistý a nechává server DTO nedotčené.

American-only ukládání úrovně: klíč checkers.level je sdílený mezi variantami a Mistrovství je americké. Kdyby ho přepsala ne-americká partie (kde championship není v nabídce a level spadne na professional), tiše by smázla uloženou volbu Mistrovství z americké cesty. Zamítnut per-varianta klíč (vrstva navíc, ne požadavek fáze) i bezpodmínečné ukládání (kontaminuje americkou preferenci). Trade-off: ne-americká úroveň se mezi spuštěními nepamatuje.

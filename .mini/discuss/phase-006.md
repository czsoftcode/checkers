# Phase 6 — applyMove a proměna

## Intent
Knihovna rules umí tah PROVÉST: `applyMove(position, move)` vrátí novou pozici (kámen na konci path, captures odebrané, na tahu soupeř). Součástí je proměna: muž končící na poslední řadě soupeře (černý na řadě 29-32, bílý na 1-4) se stává dámou. Past z GDD 2.7: proměna ukončuje tah - proměněný muž v tomtéž tahu nepokračuje v braní jako dáma (generátor to už dodržuje, applyMove to nesmí rozbít). Detekce konce hry zůstává v todo 7.

## Key decisions
- **Validace: střední cesta (potvrzeno uživatelem).** applyMove ověřuje levné strukturální podmínky - na `from` kámen strany na tahu, pole path volná, na captures soupeřovy kameny - a při porušení vyhazuje (hlasitě, žádná tichá korupce). Plnou legalitu (povinnost braní, úplnost sekvence) NEkontroluje: server v M4 validuje členstvím v legalMoves (ten seznam stejně potřebuje pro 409), engine tahá tahy z právě vygenerovaného seznamu. Odmítnutá alternativa: plná validace uvnitř applyMove = dvojnásobná cena v enginu (miliony volání).
- **Imutabilita (potvrzeno uživatelem).** applyMove vrací NOVOU pozici, vstup nemutuje. Odmítnutá alternativa: mutace in-place - rychlejší pro engine, ale sdílené mutace mezi serverem/UI/enginem jsou riziko. Kdyby engine v M3 narazil na výkon, přidá se interní rychlá varianta s undo přibitá testem ekvivalence proti této referenční implementaci - NE teď (vrstva pro budoucnost).

## Watch out for
- Proměna se vyhodnocuje podle POSLEDNÍHO pole path (kde kámen skončil), ne podle mezidopadů: černý muž končící na řadě 7 (pole 29-32), bílý na řadě 0 (pole 1-4).
- Proměněný kámen je v NOVÉ pozici dáma, ale tah, který proměnu způsobil, se aplikuje jako tah muže - applyMove nesmí „doskákat" nic navíc.
- Dáma končící na poslední řadě zůstává dámou (žádná dvojitá proměna, žádná výjimka).
- Structural checks musí pokrýt i vícenásobný skok: VŠECHNA pole path kromě... pozor - path se může vracet na from (kruh dámy) a pole uvnitř path se uvolňují/obsazují postupně; kontrola „path volná" musí brát v úvahu, že from se uvolní (dopad na from je legální). Nejjednodušší: přehrát tah krok po kroku nad kopií desky a kontrolovat průběžně (stejná logika jako generátor).
- Kontrakt Move z types.ts: captures bez duplicit, path duplicity mít smí; captures.length === path.length jen u skoků (prostý tah 0/1).
- applyMove je referenční implementace - budoucí rychlá varianta v enginu se proti ní bude přibíjet testem ekvivalence; testy proto musí pokrýt i exotické případy (kruhový skok s návratem na from).

# Rozpracované braní: kámen zůstává na posledním dopadu (i pro klikání)

## Decision
Během nedokončeného vícenásobného braní se pohyblivý kámen zobrazuje opticky na posledním dopadu a dosud sebrané kameny se schovají – odvozeno čistě z výběru (`effectivePosition`), takže žádné překreslení (poll ani další tah) stav „nevzkřísí". Platí to jednotně pro tažení i klikání (tap).

## Why
Zvažovaná a zamítnutá varianta: kámen se po meziskoku vrací na výchozí pole a jen se zvýrazní další cíl (zachovalo by dnešní plynulou animaci celého řetězce u tapu a byl by to menší zásah). Zamítnuto, protože uživatel explicitně chtěl, aby kámen u meziskoku zůstal tam, kam ho položil, a čekal na další skok. Optimistické zobrazení navíc muselo být jednotné pro tap i drag – jinak by míchání obou ovládání v jednom braní rozhodilo desku (nekonzistentní poloha kamene). Cena rozhodnutí: zrušila se plynulá animace tapového víceskoku (kámen teď „doskáče" po dopadech); přijato vědomě, protože jde o vlastní tah člověka (ne enginu, který se animuje dál) a konzistence uchopení převážila nad efektem. První verze s návratem na výchozí pole navíc měla latentní chybu (sebraný kámen se „křísil" pollem), kterou optimistické zobrazení řeší systémově.

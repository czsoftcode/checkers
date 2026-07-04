# Server píše PDN na disk (jednosměrně), ne klientský LocalStorage

## Decision
Dokončené partie archivuje SERVER zápisem <id>.pdn na disk (atomicky, po skončení partie), ne klient do LocalStorage. Je to jednosměrný best-effort výstup pro rozbor ve vnějším nástroji: zpět do hry se nenačítá, stav dál žije v paměti serveru (server zůstává jedinou autoritou). Nahrazuje backlog-21 (klientský LocalStorage archiv), který tím padá. Zápis se odčeká (await) a chyba se jen zaloguje, ne fire-and-forget.

## Why
Proti LocalStorage: prohlížeč neumí tiše zapsat id.pdn na disk - buď stahování přes <a download>, nebo File System Access API (kliknutí u každého uložení, jen Chromium). Automatické soubory na disk pro externí nástroj umí jedině server. Cena: vědomé porušení non-goalu 'partie žijí v paměti serveru; LocalStorage je jediná výjimka'. Přijato, protože zápis je jednosměrný (není to perzistence stavu ani zdroj pravdy) a autoritu serveru nemění.

Proti fire-and-forget: await je jednodušší na uvažování i test (po odpovědi na terminální tah člověka soubor prokazatelně existuje). Cena: writeGamePdn nemá timeout, takže zaseknutý filesystem (stuck NFS mount) by zablokoval odpověď na poslední tah. Pro lokální .pdn/ prakticky nenastane; kdyby CHECKERS_PDN_DIR mířil na síťový svazek, je to reálná díra - vědomě nezavíráme timeoutem (gold-plating lokálního nástroje).

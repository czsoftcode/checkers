# Rozmýšlecí pauza AI patří na klienta, ne na server

## Decision
Minimální „rozmýšlecí" pauzu před zobrazením tahu enginu vynucuje KLIENT (controller.ts): po tahu člověka počká, až doanimuje jeho tah, a od toho okamžiku nechá uplynout aspoň ~700 ms (podlaha, ne přičtení). Původně implementovaná serverová varianta (runEngineMove dospí do 300 ms před aplikací tahu) byla celá revertována.

## Why
Serverová pauza běží souběžně s animací tahu člověka na klientovi (~300 ms) a s dotazováním po 250 ms – než animace tvého tahu doběhne, serverový práh je pryč, takže tah AI naskočí prakticky hned. Serverový práh je páka na dobu ODPOVĚDI, ne na VNÍMANOU pauzu po dopadu tvého kamene; navíc ho kvantuje poll (250 ms) a zdržuje i tahy uprostřed hry. Časování zobrazení je čistě prezentační věc → patří tam, kde se pauza vnímá (klient). Autorita serveru nad pravidly zůstává nedotčená. Zvolena podlaha (ne přičtení), protože engine má soft budget ~1 s a přičítání by zpomalilo celou hru.

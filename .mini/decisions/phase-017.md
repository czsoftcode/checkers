# TT přebírá skóre jen při shodné hloubce (=== depth), ne >= depth

## Decision
Transpoziční tabulka vrací uložené skóre (a spouští cutoff) jen když má záznam přesně stejnou zbývající hloubku jako aktuální uzel (entry.depth === depth). Řazení tahů uloženým nejlepším tahem se naopak bere z libovolné hloubky. Kořen rootSearch TT nesahá vůbec.

## Why
Standardní TT používá entry.depth >= depth (hlubší záznam se považuje za dost dobrý i pro mělčí potřebu) - vědomě zamítnuto. >= by do mělčího uzlu vneslo hlubší, přesnější výsledek, takže searchRoot s TT by na fixní hloubce vrátil jiné skóre/tahy než běh bez TT. Tím by se rozbil tvrdý kontrakt projektu: kořen musí vracet identickou množinu všech shodně nejlepších tahů jako bez TT - na tom stojí kalibrace remíz (engine má remízovat dobré pozice, ne vybrat jeden vítězný tah). === vrací pravdivou hodnotu právě té hloubky = totéž, co spočte search bez TT. Cena je menší reuse skóre; hlavní zisk (řazení TT-tahem, méně prohledaných uzlů) zůstává, protože řazení výsledek nikdy nemění. Trade-off: === je konzervativní a zpomaluje reuse; navíc současné testy tuhle konkrétní divergenci >= nespustí (fixtures nevytvářejí transpozice na různé zbývající hloubce), takže volba stojí na důkazu, ne na červeném testu.

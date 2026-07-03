- Výstupy do chatu dělej striktně v češtině.

Sebekontrola na konci mini:do (než napíšu report):
1. Exit kódy: projdi KAŽDOU chybovou větev – vrací nenulový kód? Žádná cesta nesmí skončit exit 0 bez reálného výsledku (tichý falešný úspěch = opakovaný nález).
2. Rozsah catch: obaluje try jen to, co má v odůvodnění? Nemaskuje programovou chybu (TypeError) jako I/O? Zachová stack u nečekané chyby?
3. Testy mají zuby: když odpovídající kód dočasně rozbiju, padne test? Netestuju jen mock/kopii místo reálného kódu?
4. Cross-module kontrakt: sdílí dva moduly literál/tvar dat? → konstanta + test reálného kódu, ne jen mock s natvrdo zadanou hodnotou.
5. Vedlejší efekty při selhání: nechává chybová cesta po sobě soubory/složky/ polovičatý stav?
6. Změněná funkce: prošel jsem unhappy path TOHO, co jsem teď změnil (prázdný/null/timeout/exotický runtime/import)?
7. Dosažitelnost: je každá nová větev dosažitelná? Umím popsat vstup, co ji spustí?

U fází, které sahají na chybové cesty, vstupní body procesu nebo kontrakty mezi moduly, navíc před reportem pusť nezávislého sub-agenta (čerstvý kontext, ať nesdílí můj blind spot) jako self-review – checklist výš dělá stejný mozek, co kód psal, takže návrhové a slepé chyby nechytne. Cíl není nula nálezů v adversarialu, ale nepouštět do něj self-catchable chyby.

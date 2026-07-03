# CLI běží přes tsx, ne přes build krok

## Decision
Balíček @checkers/cli se spouští přes tsx (devDependency jen v cli): pnpm --filter @checkers/cli start. Žádný build krok, žádné emitované JS - stejně jako zbytek monorepa, kde balíčky exportují přímo TS zdrojáky.

## Why
Zvažované alternativy: (a) nativní type stripping Node 24 (node src/main.ts bez závislosti navíc) - zamítnuto, protože rules používá importy s .js specifikátory (./apply.js pro soubor apply.ts), které Node nerozřeší; přepsat specifikátory na .ts by rozbilo konvenci celého repa a budoucí kompilaci. (b) Build krok (tsc emit + spouštění JS) - zamítnuto, protože by zavedl dist artefakty a dvoufázové spouštění jen kvůli CLI, zatímco všechny ostatní balíčky žijí bez buildů. tsx řeší .js -> .ts rozřešení za hubičku; trade-off je runtime závislost navíc a to, že produkční spouštění serveru (M4) bude potřebovat stejné rozhodnutí zopakovat nebo přehodnotit.

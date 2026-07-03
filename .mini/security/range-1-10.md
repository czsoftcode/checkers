# Security review — range 1-10

- **Range:** `git diff 875e9d459a77ee35ee6e2af211bfc57b2c327bf4..a09a9b7d09c69493bb309057b96d803a197f84c9`
- **Reviewed at:** HEAD `a09a9b7` (VERSION 0.9.0)
- **Method:** Průchod celým diffem rozsahu (fáze 1–10) zaměřený na bezpečnostní sinky: spouštění procesů, přístupy na souborový systém, parsování nedůvěryhodného vstupu, tok obsahu `.mini/` do promptů a závislostní povrch (lockfile diff + CI workflow). Doplněno grepem na `child_process`/`spawn`/`exec`/`eval`/`new Function`/`process.env`/`fetch`/`http` přes celý `packages/`. Nejde o řádkový audit herní logiky – korektnost pravidel řeší samostatný adversarial pass.
- **Threat model:** Rozsah přidává čistou TS knihovnu pravidel (`packages/rules`, nulové I/O), její testy (jediné I/O: loader `fixtures/*.json` v test kódu), CI workflow a jednu dev závislost. Neexistuje síťový listener, autentizace ani práce se secrets. Realisticky nedůvěryhodný vstup v tomto rozsahu: (a) obsah repozitáře při spuštění testů/CI (fixtures, konfigurace), (b) do budoucna řetězce PDN a JSON pozice, které knihovna zparsuje, až ji server (M4) vystaví hráči a enginu – tahle hranice se navrhuje teď, proto je posouzená už v tomhle rozsahu.

## Verdict
Žádný blocker ani should-know. Dva informativní nálezy (nit) – defense-in-depth v CI a DoS poznámka k budoucímu vystavení `perft`.

## Findings
### SEC-1 · nit · GitHub Actions přišpendlené na tag, ne na commit SHA
**Where:** .github/workflows/ci.yml:10–15

`actions/checkout@v7`, `pnpm/action-setup@v6` a `actions/setup-node@v6` jsou odkazované pohyblivým major tagem. Kompromitace repozitáře akce (tag lze přepsat) znamená spuštění cizího kódu v CI runneru tohoto repa. Dopad je tu nízký – workflow nepoužívá žádné secrets a repo je veřejný kód – ale zvyk přišpendlit akce na plný commit SHA (`actions/checkout@<sha> # v7`) je levná pojistka, a až CI někdy dostane secrets (deploy, npm publish), bude už na místě. Neopravovat v rámci review – rozhodnutí pro údržbu.

### SEC-2 · nit · `perft` je ve veřejném API a je exponenciální – nesmí nikdy dostat nedůvěryhodnou hloubku
**Where:** packages/rules/src/perft.ts:16 (export přes packages/rules/src/index.ts:36)

`perft(position, depth)` validuje jen tvar (`Number.isInteger`, `>= 0`), horní mez nemá – `perft(initialPosition(), 30)` běží prakticky navždy (jednovláknový Node = zamrzlý proces). Dnes je volaný jen z testů s konstantami 1–6, takže to není zranitelnost. Je to ale nabitá zbraň ve veřejném API: až vznikne server (M4) nebo CLI (M2), nesmí `depth` nikdy přijít z requestu/argumentu bez tvrdého stropu. Poznámka pro budoucí fáze, ne oprava teď.

## Checked and clean
- **Spouštění procesů:** V celém `packages/` není žádné `child_process`/`spawn`/`exec`/`eval`/`new Function` (ověřeno grepem). CI spouští jen `pnpm install --frozen-lockfile`, `pnpm lint|typecheck|test` – žádná interpolace `${{ }}` z nedůvěryhodných dat (názvy PR, větví apod. se ve workflow nepoužívají), žádný `pull_request_target`, žádné secrets.
- **Souborový systém:** Jediné I/O v rozsahu je test loader `packages/rules/test/support/fixtures.ts` – čte výhradně `fixtures/*.json` přes `readdirSync` + `join` s pevným `FIXTURES_DIR`; názvy souborů pocházejí z výpisu téhož adresáře (nemohou obsahovat `/`), path traversal nevede. Symlink ve `fixtures/` by se přečetl, ale běží to jen při testech nad vlastním repem – kdo podstrčí hostilní repo, spouští přes vitest config libovolný kód tak jako tak.
- **Parsování nedůvěryhodného vstupu (budoucí serverová hranice):** `parseMove` (notation.ts) – kotvený konstantní regex `^[1-9]\d?$` (žádný ReDoS), lineární průchod, každý nesmysl (cizí znaky, smíšené oddělovače, pole mimo 1–32, neskoková geometrie, duplicitní braní) končí RangeError; žádný stav se nemutuje. `cellAt`/`positionKey`/`applyMove` odmítají poškozenou desku (délka ≠ 32, díra, cizí `turn`/`color`/`kind`) hlasitě místo tiché korupce – přesně to, co serverová hranice později potřebuje. Loader fixtures odmítá neznámé klíče, špatné typy i nevalidní JSON s výjimkou (žádné tiché přeskočení).
- **Prompt injection / `.mini/`:** Rozsah přidává jen vlastní vygenerované reporty/paměti fází (markdown, JSON) – žádný kód, který by obsah `.mini/` skládal do promptů nebo příkazů; tahle plocha patří nástroji `mini`, ne tomuto repu. Obsah jsem prošel, nic ve stylu instrukcí pro agenta v datech.
- **Závislostní povrch:** Jediná nová závislost v rozsahu je `@types/node` 22.20.0 (+ tranzitivní `undici-types`) – čistě typové balíčky, žádné install skripty, žádný runtime kód. Lockfile je pinovaný a CI instaluje s `--frozen-lockfile`. Knihovna `rules` sama nemá žádné runtime závislosti (jen devDependencies) – nulový dodavatelský povrch pro sdílený kód pravidel.
- **Úniky informací:** Chybové zprávy nesou jen čísla polí / délky desky – žádná citlivá data, žádné logování.

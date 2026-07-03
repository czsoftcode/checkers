# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 10-1 · should-know · resolved
**Where:** pnpm-workspace.yaml:6
**Reviewed-at:** a09a9b7d09c69493bb309057b96d803a197f84c9
**Source:** project
**Range:** 1-10
Drift Node verze: projekt přibíjí Node 22 LTS, repo běží na Node 24 a typy jsou pro Node 22

Projektové omezení (Approach/Main constraints) říká 'Node 22 LTS', ale repo je celé na Node 24: .nvmrc=24, package.json engines '>=24', CI setup-node node-version 24. Žádná fáze tuhle odchylku nezdokumentovala jako vědomé rozhodnutí (report fáze 1 zmiňuje 'CI na Node 24' jen jako fakt, novější verze nástrojů komentuje jen u TS/ESLint/Vitest). Navíc vnitřní nesoulad: catalog v pnpm-workspace.yaml přibíjí @types/node ^22.10.0, takže typy popisují jiný runtime, než na jakém kód reálně běží (API nová v Node 23/24 typům chybí, a naopak typy slibují chování Node 22). Jak se to projeví: (a) vývojář s Node 22 LTS dle dokumentace projektu narazí na engines '>=24'; (b) až server/engine sáhnou na novější Node API, typecheck bude lhát. Náprava je rozhodnutí, ne oprava kódu: buď aktualizovat projektový dokument na Node 24 + zvednout @types/node na ^24, nebo shodit repo na Node 22.

## 10-2 · nit · resolved
**Where:** packages/rules/src/moves.ts:25
**Reviewed-at:** a09a9b7d09c69493bb309057b96d803a197f84c9
**Source:** project
**Range:** 1-10
ALL_DIRS existuje ve třech nezávislých kopiích

board.ts:124 exportuje ALL_DIRS, ale moves.ts:25 si místo importu definuje vlastní lokální kopii a invariants.test.ts:6 třetí. Všechny tři musí souhlasit s indexy DIR (pořadí NW, NE, SW, SE sdílejí tabulky NEIGHBORS/JUMPS i MAN_DIRS). Dnes jsou identické; kdyby se ale jedna kopie někdy změnila (přidání směru, přerovnání), ostatní se nerozbijí kompilací – rozjetí je tiché a projeví se až špatně vygenerovanými tahy. Stačí v moves.ts (a ideálně i v testu) importovat ALL_DIRS z board.ts, ať existuje jediný zdroj pravdy.

# Phase 116 — Italská: v nabídce + labely

## Intent
Zapnout italskou pro uživatele: přidat `'italian'` do `VARIANT_IDS` (pole v packages/rules/src/variant.ts), což ji rozsvítí v AIvP pickeru, PvP accordionu i server presence (místnost na variantu) NARÁZ. Fáze 111 ji do VARIANT_IDS záměrně nedala; teď smí, protože jádro pravidel je perft-ověřené (IT-5). Vedlejší efekt: PvP italská tím naskočí; IT-10 se posouvá na OVĚŘENÍ PvP autority + dvouklientské E2E, ne na zapnutí.

## Key decisions
- **Labely UŽ EXISTUJÍ (fáze 111 je vynutila).** `VARIANT_LABEL_KEYS` (packages/web/src/i18n.ts) i `EVENT_NAME` (packages/server/src/archive.ts) jsou `Record<VariantId, ...>`, takže přidání `'italian'` do typu VariantId v 111 kompilátorem vynutilo doplnit italské položky. Reálně existují: `variant.italian` = „Italská dáma"/„Italian checkers", `EVENT_NAME.italian` = „Italian Draughts". → Z todo „doplnit labely" zbývá jen OVĚŘIT, ne psát.
- **Reálná změna v src/ = jeden řádek:** přidat `'italian'` do pole `VARIANT_IDS`. Hlavní práce fáze je NE tenhle řádek, ale TEST BLAST RADIUS (viz níže).
- **AIvP klientský PDN: rozhodnuto (a) = jen OVĚŘIT.** Grep nenašel na webu žádné stavění `[Event]`/názvu varianty pro klientský (AIvP) archiv - jen serverový `EVENT_NAME` (PvP). V `do` OVĚŘIT, zda AIvP archivované PDN nese variantu. Pokud NE → je to pre-existující mezera pro VŠECHNY varianty (ne italská specialita) → NEOPRAVOVAT v této fázi, jen ZALOŽIT `mini todo` a nechat. NEzaplétat do „zapnout italskou" opravu týkající se všech variant.
- **NEROZDĚLOVAT VARIANT_IDS** na AIvP vs PvP seznamy (nová vrstva, kterou projekt nechce). Vedlejší efekt (italská i v PvP) je vědomě přijatý.

## Watch out for
- **TEST BLAST RADIUS = hlavní práce.** Přidání páté varianty rozbije KAŽDÝ test/komentář, který enumeruje nebo počítá varianty. V `do` proženeš celou suitu a opravíš očekávání na PĚT (žádná chytrost). Konkrétní kandidáti:
  - `packages/rules/test/variant.test.ts`: aserce „VARIANT_IDS = přesně 4 … NEobsahuje italian" (`toEqual(['american','czech','pool','russian'])` + `not.toContain('italian')`) → přepsat na 5 seřazených VČETNĚ 'italian' + `toContain('italian')`. POZOR: test mapování s polem `cases` UŽ italskou obsahuje (z 111) a ZŮSTÁVÁ beze změny - italská má správně mapovaný ITALIAN_RULESET.
  - `packages/web/test/i18n-variant.test.ts` (iteruje VARIANT_IDS, čeká label pro každou) - projde, label existuje; jen ověřit.
  - `packages/web/test/lobby-variant.test.ts` („nabízí varianty registru, výchozí americká"), `packages/web/test/local/local-client-variant.test.ts` („všechny varianty protečou") - pokud čekají přesně 4 / konkrétní seznam, doplnit italskou.
  - Server presence/room snapshot testy (`presence.test.ts`, `variant-lobby-ws.test.ts`, `room-client.test.ts`) - pokud čekají přesně 4 lobby/rostery, upravit na 5. Komentář „všech 4 lobby" v `presence.ts` (a fráze fáze 104) aktualizovat na 5.
- **Regrese jádra:** perft american/pool/russian/czech beze změny čísel; do rules/src se sahá jen `VARIANT_IDS` (pole), ne pravidla. Italská hratelnost přes LocalClient AI funguje (rulesetForVariant→ITALIAN_RULESET; evaluate king='short'→KING_VALUE), jen váhy nedoladěné (IT-9).
- **Vědomý „syrový" stav po IT-6:** italská bude vybíratelná a hratelná, ale bez otočené desky/red-white assetů (IT-7), bez UI ověření multi-skoku pod maximem (IT-8), bez doladěné AI (IT-9), bez ověřené PvP autority (IT-10). Na dev OK - nic se nepublikuje před IT-11.
- **Brána:** italská volitelná v AIvP lobby; i18n-variant test zelený; celá vitest suita (rules+web+server) zelená po opravě enumerujících testů; tsc čistý; perft ostatních variant beze změny.

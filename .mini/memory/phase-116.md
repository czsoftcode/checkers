# Phase 116 — Italská: v nabídce + labely

**Goal:** Zapnout italskou v nabídce: přidat 'italian' do VARIANT_IDS (to, co fáze 111 záměrně NEudělala - teď smí, jádro je perft-ověřené v IT-5). VEDLEJŠÍ EFEKT (vědomě přijatý): VARIANT_IDS řídí zároveň AIvP picker (lobby.ts:95) I PvP accordion (lobby.ts:776) I server presence (presence.ts:336/490 zakládá PvP místnost na variantu), takže italská naskočí NARÁZ do AIvP i PvP. Samotné zapnutí PvP je tím vedlejší efekt; IT-10 se posune na OVĚŘENÍ PvP autority + dvouklientské E2E. Doplnit labely napříč: variantLabel (packages/web/src/i18n.ts, cs/en), server EVENT_NAME pro PDN (packages/server/src/archive.ts), klientský PDN archiv (pokud má vlastní název varianty). Upravit variant.test.ts: přepsat aserci known ⊋ offered z fáze 111 (italská je teď NABÍZENÁ; exhaustivní VARIANT_IDS = pět; italská už není 'known ale ne offered'). NEROZDĚLOVAT VARIANT_IDS na AIvP vs PvP seznamy (nová vrstva, kterou projekt nechce) - jen být vědom vedlejšího efektu. Po IT-6 je italská hratelná, ale bez otočené desky/red-white assetů (IT-7), bez doladěné AI (IT-9), bez ověřené PvP autority (IT-10) - na dev OK, nic se nepublikuje před IT-11. Brána: italská volitelná v AIvP lobby; PDN dokončené italské partie nese správný název varianty; i18n-variant test (iteruje VARIANT_IDS, čeká label pro každou) zelený; perft ostatních variant beze změny; celá suita zelená; tsc čistý.

## Steps
- [done] Přidat italian do VARIANT_IDS + ověřit labely
- [done] Opravit enumerující testy na pět
- [done] Ověřit AIvP klientský PDN + případné todo
- [done] Brána

## Auto-commit
- Phase 116: Italská: v nabídce + labely

## Discussion
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

## Run report
---
phase: 116
verdict: done
steps:
  - title: "Přidat italian do VARIANT_IDS + ověřit labely"
    status: done
  - title: "Opravit enumerující testy na pět"
    status: done
  - title: "Ověřit AIvP klientský PDN + případné todo"
    status: done
  - title: "Brána"
    status: done
verify:
  - title: "Italská reálně v běžícím UI (AIvP picker + PvP akordeon) a partie se rozjede"
    detail: "Ověřeno jen na úrovni testů (lobby-variant: 5 options vč. italian; local-client-variant: italská protéká přes LocalClient AI; server presence/snapshot: 5 lobby). NEspouštěl jsem reálný prohlížeč. Stav po IT-6 je vědomě SYROVÝ: bez otočené desky/red-white assetů (IT-7), bez doladěné AI (IT-9), bez ověřené PvP autority (IT-10). Na dev OK, nic se nepublikuje před IT-11."
---

# Phase 116 — report z auto session

## Co se povedlo

**Reálná změna v `src/` = jeden řádek pole:** `'italian'` přidán do `VARIANT_IDS`
(packages/rules/src/variant.ts). Tím se italská rozsvítila NARÁZ v AIvP pickeru,
PvP akordeonu i server presence (místnost na variantu) – vědomě přijatý vedlejší
efekt dle discuss.

**Labely už existovaly** (fáze 111 je vynutila přes `Record<VariantId, …>`):
`variant.italian` = „Italská dáma"/„Italian checkers" (i18n.ts), `EVENT_NAME.italian`
= „Italian Draughts" (archive.ts). Jen ověřeno, nic nového se nepsalo.

## Test blast radius (hlavní práce fáze)

Přidání páté varianty rozbilo enumerující testy. Opraveno na PĚT (žádná chytrost):
- `variant.test.ts`: aserce „přesně 4, NEobsahuje italian" → „5 seřazených VČETNĚ
  italian" + `toContain`. Test mapování (pole `cases`) beze změny (italská tam byla z 111).
- Padaly a opraveny: `lobby-connect-ws.test.ts`, `variant-lobby-ws.test.ts`,
  `lobby.test.ts` (akordeon 4→5 sekcí + helper snapshotu), `lobby-variant.test.ts`
  (picker 4→5 options), `i18n-variant.test.ts` (lokální mapa `VARIANT_KEYS` neměla
  italian – doplněno).
- Zpřísněno (nepadalo, ale bylo neúplné): `presence.test.ts`, `variant-lobby-ws.test.ts:297`
  (loop room-count 0 i pro italskou), `room-client.test.ts` (mock snapshot 4→5),
  `local-client-variant.test.ts` (loop 4→5 – teď reálně protahuje italskou AI přes LocalClient).
- Zastaralé komentáře „4 lobby / čtyř varianta" v src (presence.ts, app.ts, lobby.ts,
  room-client.ts, i18n.ts) aktualizovány na 5 (byly by fakticky lživé).

## Ověření AIvP klientského PDN (krok 3)

Zjištění: **AIvP (lokální) hry se nearchivují do PDN VŮBEC** – `local-client.ts` má
explicitně „bez archivace". Žádný klientský export dokončené partie neexistuje;
serverový PDN archiv (`archive.ts`, `[Event]`=`EVENT_NAME`, `[Variant]`) je jen PvP.
Není to italská specialita ani „varianta se neukládá" – celý AIvP archiv chybí, pro
VŠECHNY varianty (vědomý minimalismus LocalClientu). Dle rozhodnutí (a) z discuss
NEOPRAVOVÁNO v této fázi, jen **založeno mini todo** (`.mini/todo.md`).

## Nad rámec: zuby na serverový [Event]

Bránový požadavek „PDN dokončené italské partie nese správný název varianty" byl
netestovaný (`pvp-archive-ws.test.ts` jede jen americkou). Přidán **nový unit test**
`packages/server/test/archive-variant.test.ts` (7 testů): iteruje `VARIANT_IDS` a
ověřuje `[Event]`/`[Variant]` pro každou variantu proti ručnímu oraclu; explicitně,
že italská NEspadne na americký `[Event]`. Cross-module zub: prohození `EVENT_NAME`
by test shodil.

## Poznámka k pre-existující latentní mezeře (mimo scope, teď zavřená)

Server `enter` gate používá `isVariantId` (registr), ne `VARIANT_IDS`. Před touto fází
byl `isVariantId('italian')` true, ale místnost pro italskou NEEXISTOVALA (zakládá se
z `VARIANT_IDS`) → `enter: italian` mohl teoreticky spadnout na `room('italian')`=undefined.
Přidáním do `VARIANT_IDS` teď místnost vzniká, seznamy se kryjí a okno se zavřelo.
Neřešeno zvlášť – vyřešeno jako vedlejší efekt této fáze.

## Stav brány (vše ověřeno mechanicky)

- Celá vitest suita zelená: rules 435, cli 24, engine 268, ai 57, server **206**
  (+7 nový archive-variant), web 629.
- `pnpm -r typecheck` čistý; eslint změněných souborů čistý.
- Perft american/pool/russian/czech BEZE ZMĚNY (do rules/src se sáhlo jen na pole
  `VARIANT_IDS`, žádná pravidla/čísla).
- Italská vybíratelná v AIvP lobby (test-úroveň).

Žádné rozhodnutí typu ADR (strategie určena v discuss, ne nově zde).

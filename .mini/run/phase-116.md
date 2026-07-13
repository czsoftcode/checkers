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

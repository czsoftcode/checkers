# Phase 60 — Kniha: reálný komplex 9-14

**Goal:** Naplnit knihu zahájení ověřenými hlavními liniemi komplexu prvního tahu černého 9-14 z Pask 'Complete Checkers' (Část 1) do ~8 půltahů, pro obě barvy enginu, s deterministickým výběrem; legalitu každého půltahu vynutí buildBook, zásah na klíčových pozicích ověří testy proti reálným Position. Mimo rozsah: ostatní zbývající první tahy (10-14, 10-15, 11-16, 12-16), zrcadlová symetrie/transpozice, náhodný výběr.

## Steps
- [done] Ověřit číslování a orientaci 9-14 vůči Pask
- [done] Extrahovat hlavní linie komplexu 9-14 z Pask
- [done] Zakódovat linie 9-14 do SEED_LINES
- [done] Aktualizovat kanárek a miss test na tři první tahy
- [done] Testy: reálné pozice 9-14 → knižní tah
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 60: Kniha: reálný komplex 9-14

## Run report
---
phase: 60
verdict: done
steps:
  - title: "Ověřit číslování a orientaci 9-14 vůči Pask"
    status: done
  - title: "Extrahovat hlavní linie komplexu 9-14 z Pask"
    status: done
  - title: "Zakódovat linie 9-14 do SEED_LINES"
    status: done
  - title: "Aktualizovat kanárek a miss test na tři první tahy"
    status: done
  - title: "Testy: reálné pozice 9-14 → knižní tah"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Phase 60 — report z auto session

## Co se udělalo
Kniha zahájení (`packages/server/src/opening-book.ts`) dostala třetí první tah
černého — **9-14** — se šesti hlavními odpověďmi bílého (22-17, 22-18, 23-18,
23-19, 24-19, 24-20) do 8 půltahů. Zdroj: Pask „Complete Checkers", Část 2
(9-14s), Trunky ballotů 26/30/34/35/39/42.

Výchozí pozice má nově **3 kandidáty** prvního tahu (11-15, 9-13, 9-14);
deterministický výběr dál vrací 11-15. Pozice po 9-14 (engine = bílý) má 6
kandidátů.

## Klíčový nález při práci
Zdrojový text Pask **není v repu** — komentáře „řádek XXXXX" odkazují na
`pask.txt` (22786 řádků), který si předchozí fáze uložily do scratchpadu jiné
session (`…/52aa9674-…/scratchpad/pask.txt`). Bez něj by šlo linie jen vymýšlet
zpaměti (fabrikace), což jsem odmítl. Text se naštěstí našel; mapování řádků
sedí (13757 = 11-15 22-18, 14191 = 11-15 23-18). **Pro budoucí fáze knihy
(10-14, 10-15, 11-16, 12-16) je tento soubor nutný vstup** — pokud zmizí ze
scratchpadu, další fáze se bez něj nedá poctivě udělat a je třeba si ho vyžádat.

## Rozhodnutí
- Balloty 38 (24-19; 5-9) a 41 (24-20; 5-9) mají v Trunku čistou transpozici
  „INTO 9-14 22-18" — vynechal jsem je a pro 24-19/24-20 vzal balloty 39/42
  s reálným Trunkem, ať kniha nese distinktivní linie, ne duplikát pozice.

## Ověření (mechanicky, sám)
- `buildBook` při načtení modulu nepustí nelegální/dvojznačný půltah → všech 48
  půltahů (6×8) je legálních (jinak by testy nenačetly modul).
- `pnpm -r test` zelené: rules 266, cli 24, web 244, engine 250, server 177.
- `pnpm -r typecheck` čistý. (Lint skript v repu není.)
- Testy knihy: 29 passed. Nový `describe` blok 9-14 (první kandidát, pokrytá
  ne-první odpověď 24-19→11-15, braní 14x23 s `captures.length===1`, miss na
  nepokryté 21-17, regresní zámek všech 6 linií). Kanárek (f) rozšířen na 3/6/6/6.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Ověřil všech 6 linií znak po znaku proti pask.txt — **6/6 souhlasí**, žádný
nesoulad. Potvrdil vyhnutí se transpozicím a pokrytí (miss = 21-17). Empiricky
otestoval zuby: dočasná záměna posledního půltahu ballotu 42 na legální
`[30,25]` (buildBook ji propustí) → regresní zámek `REFERENCE_LINES` spadl.
Po revertu zelené, pracovní strom čistý.

## Přiznaná slabina (stejná jako fáze 59, poctivě v kódu)
`REFERENCE_LINES` v testu je ruční KOPIE `SEED_LINES` ve stejném souboru.
Chytí budoucí SEED-only divergenci (překlep zanesený jen do seedu), ale
NEchytí souběžný překlep zapsaný stejně do seedu i reference. Jediná pojistka
proti zdroji je nezávislé čtení proti Pask (výše provedeno), ne test. Komentář
u REFERENCE_LINES to říká na rovinu.

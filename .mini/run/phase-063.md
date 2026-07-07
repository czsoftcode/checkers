---
phase: 63
verdict: done
steps:
  - title: "Ověřit číslování a orientaci 11-16 vůči Pask"
    status: done
  - title: "Extrahovat hlavní linie komplexu 11-16 z Pask"
    status: done
  - title: "Zakódovat linie 11-16 do SEED_LINES"
    status: done
  - title: "Aktualizovat kanárek a miss test na šest prvních tahů"
    status: done
  - title: "Testy: reálné pozice 11-16 → knižní tah"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Phase 63 — report z auto session

## Co se udělalo
Kniha zahájení (`packages/server/src/opening-book.ts`) dostala šestý první tah
černého — **11-16** — se **7 hlavními odpověďmi bílého** (21-17, 22-17, 22-18,
23-18, 23-19, 24-19, 24-20) do ~8 půltahů. Zdroj: Pask „Complete Checkers", Část 6
(11-16s), extrahovaná z `packages/docs/ccheck1.pdf` přes `pdftotext -layout`. Vzato
trunk prvních ballotů 105/110/113/117/121A/122/125.

Jako u 10-15 (fáze 62) má i 11-16 přesně **7 legálních odpovědí bílého a seed
pokrývá všechny** → po 11-16 z knihy žádná bílá odpověď nevypadne. Výchozí pozice
má teď 6 kandidátů prvního tahu (11-15 stále první/deterministický), pozice po
11-16 má 7 kandidátů.

## Dvě odchylky od „prostě první ballot" (zdokumentované v komentáři)
- **24-20:** první ballot 124A je transpoziční stub (trunk „INTO 12-16 24-20;
  8-12" po 5 půltazích, do mimorozsahového 12-16), proto vzat první 24-20 ballot
  s vlastním trunkem = **125** (stejný postup jako fáze 61 s 50B/58).
- **21-17 (ballot 105):** trunk transponuje do 10-15 už po 7 půltazích, takže
  tato **jediná** linie má 7 (ne 8) půltahů. Nepadovalo se — 7 ověřených půltahů
  je lepší než 8 s dohádaným pokračováním.
- **23-19 (ballot 121A):** černého třetí půltah 16-23 je **vynucené braní**
  (bílý 23-19 dá kámen na 19, černý ho musí sebrat) — pokryto vlastním testem.

## Testy (mají zuby — ověřeno mutací)
- Kanárek posunut: výchozí pozice 5→6 kandidátů (přidán 11-16 jako 6.), nový bod
  „po 11-16 = 7 kandidátů".
- Miss test: `bookFirst` rozšířen o 11-16, nepokrytý zůstává jen 12-16.
- Nový `describe` blok 11-16: engine=bílý první kandidát 21-17; engine=černý na
  ne-první odpověď 24-19 → 7-11; vynucené braní 16x23 (23-19); „všech 7 odpovědí
  pokryto"; miss na deviaci černého; regresní zámek všech 7 referenčních linií.
- **Ověření zubů:** dočasně jsem změnil jeden SEED půltah na jiný LEGÁLNÍ tah
  (3-7 → 9-13). buildBook ho přijal (je legální), ale regresní zámek REFERENCE_LINES
  spadl („chybí knižní tah 3->7"). To je přesně ochrana proti „legální, ale špatně
  opsané linii", kterou buildBook sám nechytí. Poté obnoveno, vše zelené.

## Nezávislý self-review (povinný, čerstvý kontext)
Pustil jsem nezávislého sub-agenta (general-purpose, čerstvý kontext), který
porovnal všech 7 zakódovaných linií půltah po půltahu proti `pdftotext` extrakci
Pask. Verdikt **PROŠLO**: všech 7 linií se shoduje se zdrojem včetně dopadových
polí u braní; potvrdil transpozice (105 → 10-15 po 7 tazích, 124A → 12-16 stub),
vynucené braní 121A a úplnost/bezpřebytečnost množiny 7 bílých odpovědí. Žádná
špatně opsaná (ale legální) linie nenalezena. Jediná výhrada byla k rozsahu (jen
zakódovaných 7-8 půltahů) — což je přesně to, co se kóduje, hlubší tahy tu nejsou.

## Kontrola
- `pnpm --filter @checkers/server test`: 194/194 zelených (18 souborů).
- `pnpm -r test`: rules/cli(24)/web(244)/engine(250, vč. perft + M3 brány)/server(194)
  vše zelené.
- `pnpm --filter @checkers/server typecheck`: čistý (tsc --noEmit).
- `pnpm lint` (eslint .): bez chyb.
- CHANGELOG: přidána verze `[0.50.0]` (minor bump ve stylu předchozích fází).

## Na co si dát pozor / otevřené
- Vydání s minor bumpem: dle poznámky v paměti po releasu zkontroluj, že hlavička
  `[0.50.0]` nespolkla hlavičku předchozí verze.
- Rozsah „~8 půltahů" je vědomě mělký (kniha 3-move, trunk). Hlubší varianty
  (V1, V2…) ani zbývající první tah **12-16** tu nejsou — 12-16 přijde v další fázi.

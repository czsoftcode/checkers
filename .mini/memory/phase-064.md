# Phase 64 — Kniha: reálný komplex 12-16

**Goal:** Naplnit knihu zahájení ověřenými hlavními liniemi komplexu prvního tahu černého 12-16 z Pask „Complete Checkers" do ~8 půltahů, pro obě barvy enginu, s deterministickým výběrem; legalitu každého půltahu vynutí buildBook, zásah na klíčových pozicích ověří testy proti reálným Position. Mimo rozsah: zrcadlová symetrie/transpozice a náhodný výběr; tím se sedmka prvních tahů černého uzavírá.

## Steps
- [done] Ověřit číslování a orientaci 12-16 vůči Pask
- [done] Extrahovat hlavní linie komplexu 12-16 z Pask
- [done] Zakódovat linie 12-16 do SEED_LINES
- [done] Aktualizovat kanárek a miss test na sedm prvních tahů
- [done] Testy: reálné pozice 12-16 → knižní tah
- [done] CHANGELOG + nezávislý self-review sub-agentem

## Auto-commit
- Phase 64: Kniha: reálný komplex 12-16

## Run report
---
phase: 64
verdict: done
steps:
  - title: "Ověřit číslování a orientaci 12-16 vůči Pask"
    status: done
  - title: "Extrahovat hlavní linie komplexu 12-16 z Pask"
    status: done
  - title: "Zakódovat linie 12-16 do SEED_LINES"
    status: done
  - title: "Aktualizovat kanárek a miss test na sedm prvních tahů"
    status: done
  - title: "Testy: reálné pozice 12-16 → knižní tah"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Phase 64 — report z auto session

Přidán KOMPLEX 12-16 do knihy zahájení — **sedmý a poslední** první tah černého.
Tím je v knize pokryto všech 7 legálních prvních tahů černého.

## Co se udělalo

- **Zdroj.** Extrakce Pask „Complete Checkers" (`pask.txt`) NENÍ v repu — leží
  ve scratchpadu předchozí session
  (`/tmp/claude-1000/.../355d7536-.../scratchpad/pask.txt`, 1,1 MB). Byla to ta
  samá extrakce, kterou používaly fáze 58-63 (řádkové odkazy „Pask řádek NNNN"
  sedí). Bez ní by fáze byla blokovaná — vymýšlet linie od stolu by porušilo celý
  smysl (věrnost reálnému zdroji). **Pokud se scratchpad smaže, další práce s
  knihou tento zdroj nebude mít.**
- **6 linií, ne 7.** Pask 3-move deck má pro 12-16 balloty 126-138, ale bílá
  odpověď **23-19 v decku CHYBÍ** (žádný ballot). 12-16 tedy pokrývá jen 6 ze 7
  legálních odpovědí bílého (21-17, 22-17, 22-18, 23-18, 24-19, 24-20) — jako
  9-13/9-14/10-14, NE jako 10-15/11-16 (které měly všech 7). To je věcný rozdíl
  oproti plánu, který předpokládal „všech 7 pokryto, miss zaniká". Realita:
  miss se posunul o půltah — 12-16 23-19 je legální, ale mimo knihu → miss.
- **Vzaty trunky prvních ballotů** 126/130/132/134/136/137 do ~8 půltahů. Linie
  24-19 (ballot 136) má jen 7 půltahů — po `8-12` trunk transponuje do
  11-16 24-19; 8-11 (obdoba 21-17/ballot 105 z fáze 63).
- **Testy.** Kanárek: výchozí pozice 6→7 kandidátů (+12-16 jako 7.), po 12-16 = 6
  kandidátů (ne 7). Původní miss test (jiný první tah než knižní) po pokrytí všech
  7 zanikl — nahrazen dvěma testy: (a) pozitivní pokrytí všech 7 prvních tahů, (b)
  nový miss 12-16 23-19. Přidán describe blok „reálný komplex 12-16" (první
  kandidát, pokrytá ne-první odpověď, braní 10x19, 6-ze-7 pokrytí + 23-19 chybí,
  deviace černého, regresní zámek 6 referenčních linií).
- **CHANGELOG** pod `[Unreleased]`.

## Ověření

- Server testy: 201 passed (bylo 194). Engine: 250 passed. Typecheck všech balíčků
  Done. `pnpm lint` (eslint) clean.
- **Nezávislý self-review** (sub-agent, čerstvý kontext): znak po znaku porovnal
  všech 6 seed linií proti Pask trunkům — **PROŠLO**, žádný nesoulad. Potvrdil
  absenci 23-19 v decku, legitimní 7-půltahovou hranici u 136, konzistenci
  komentářů i CHANGELOGu.

## Otevřené / na co si dát pozor

- **Známé omezení (ne nový nález):** `REFERENCE_LINES` v testu je kopie
  `SEED_LINES`, takže „regresní zámek" hlídá jen budoucí divergenci seedu proti
  sobě, NE věrnost proti Pask. Skutečnou pojistkou věrnosti je právě nezávislé
  čtení sub-agentem (proběhlo). Stejné omezení má každý komplex 58-63 a je v
  komentáři testu přiznané. Sub-agent to označil jako jediný (nízký, procesní)
  nález.
- **Vydání:** až `mini done` bumpne verzi, zkontrolovat, že hlavička nové verze
  nespolkla `[0.50.0]` (poznámka z paměti — týká se releasu, ne této `do` fáze).
- Komplex prvních tahů černého je teď KOMPLETNÍ (všech 7). Hlubší varianty
  (V1, V2…) mimo trunk ani transpoziční linie v knize nejsou (vědomě mimo rozsah).

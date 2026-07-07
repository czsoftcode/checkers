---
phase: 61
verdict: done
steps:
  - title: "Ověřit číslování a orientaci 10-14 vůči Pask"
    status: done
  - title: "Extrahovat hlavní linie komplexu 10-14 z Pask"
    status: done
  - title: "Zakódovat linie 10-14 do SEED_LINES"
    status: done
  - title: "Aktualizovat kanárek a miss test na čtyři první tahy"
    status: done
  - title: "Testy: reálné pozice 10-14 → knižní tah"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Fáze 61 — report z auto session

## Co se udělalo

Kniha zahájení (`packages/server/src/opening-book.ts`) dostala čtvrtý první tah
černého — **10-14** — se šesti hlavními odpověďmi bílého (22-17, 22-18, 23-18,
23-19, 24-19, 24-20), každá do 8 půltahů. Zdroj: Pask „Complete Checkers",
Část 3 (10-14s), balloty 45/47/50/50B/53/58.

Výběr ballotů: pro každou bílou odpověď jsem vzal první ballot s **vlastním
samostatným trunkem**. U 23-19 a 24-20 první ballot (50A, resp. 57) trunkem
transponuje do jiného pořadí tahů, takže padla volba na 50B, resp. 58 — stejný
princip „přeskoč transpoziční linie", jaký použila fáze 60.

## Jak jsem hlídal správnost (dva nezávislé filtry)

1. **Legalita + jednoznačnost:** než jsem cokoli zapsal do produkce, pustil jsem
   všech 6 linií přes reálný `buildBook` v dočasném skriptu. Prošly (38 unikátních
   pozic po dedupu, 10-14 sdílené na výchozí pozici). Heavy výměny (50B, 53, 58)
   nesly riziko dvojznačného dopadu → Error, ale žádná ho neměla. Skript smazán.
2. **Věrnost zdroji:** prvních 8 půltahů každého trunku jsem opsal ručně a pak
   nezávislý sub-agent (čerstvý kontext) porovnal seed půltah po půltahu proti
   `pask.txt`. Verdikt PROŠLO — 0 nesouladů v datech.

## Nález sub-agenta (opraveno)

Sub-agent správně upozornil, že inline i hlavičkový komentář označoval ballot
**50A** za „transpoziční stub". To je nepřesné: 50A je dlouhá linie, která
transponuje až na konci (na rozdíl od 57, což je opravdu krátký stub). Komentáře
jsem přeformuloval, aby 50A a 57 nemíchaly do jednoho pytle. Jde o dokumentaci,
ne o data — seed byl věrný i předtím.

## Testy

- `opening-book.test.ts`: kanárek zvednut ze 3 na 4 kandidáty výchozí pozice
  (+ ověření `firstCandidates[3]` = 10-14) a nový blok „6 kandidátů po 10-14";
  miss test má v `bookFirst` Setu i '10-14'; nový describe blok pro komplex 10-14
  (první kandidát 22-17, pokrytá ne-první odpověď 24-19 → 6-10, braní 23-18 →
  14x23, miss na nepokryté 21-17, regresní zámek 6 referenčních linií).
- Celá sada serveru: **182 testů zelených**, typecheck čistý.

## Poznámka pro budoucí fáze knihy

Zbývají první tahy **10-15, 11-16, 12-16** (Part 4/5/6/7 v Pask). Vstupem je dál
`pask.txt` ve scratchpadu jiné session
(`…/52aa9674-…/scratchpad/pask.txt`) — pokud zmizí, další fáze se bez něj nedá
poctivě udělat a je nutné si ho vyžádat. Kotva řádků platí (Part 3: 10-14s =
řádky ~6983–9860).

---
phase: 59
verdict: done
steps:
  - title: "Ověřit číslování a orientaci 9-13 vůči Pask"
    status: done
  - title: "Extrahovat 6 hlavních linií komplexu 9-13 z Pask"
    status: done
  - title: "Zakódovat linie 9-13 do SEED_LINES"
    status: done
  - title: "Opravit stávající 11-15 testy na dva první tahy"
    status: done
  - title: "Testy: reálné pozice 9-13 → knižní tah"
    status: done
  - title: "CHANGELOG + nezávislý self-review sub-agentem"
    status: done
---

# Fáze 59 — report z auto session

## Co se udělalo
Kniha zahájení (`packages/server/src/opening-book.ts`) dostala druhý první tah
černého — **9-13** — se 6 hlavními odpověďmi bílého (21-17, 22-17, 22-18, 23-18,
24-19, 23-19), každou trunkem z Pask „Complete Checkers", Část 1, do ~8 půltahů.
11-15 linie zůstaly první, takže deterministický první kandidát na výchozí pozici
je dál 11-15; 9-13 je druhý. Legalitu každého půltahu vynutil `buildBook` (žádný
nevyhodil Error → všech 6 linií legálních). Nové testy v `opening-book.test.ts`
pinují reálné pozice → knižní tah pro obě barvy enginu + „mimo pokryté → undefined"
(nepokrytý 7. tah 24-20) + regresní zámek 6 referenčních linií.

## Co se NEČEKALO — reálná regrese (ne flakiness)
Přidání 9-13 do knihy **rozbilo 9 dřív zelených engine testů** napříč 6 soubory
(engine-move, resign, offer-draw, hint, gate, archive). Příčina je cross-module
kontrakt: tyto testy hrály jako první lidský tah `legalMoves[0]`, což je shodou
okolností **9-13**. Kniha se konzultuje uvnitř `runEngineMove` na úrovni
Profesionál, takže server po 9-13 zahrál knižní 21-17 **místo volání injektovaného
engine stubu**. Důsledek: stuby, co mají viset/chybovat, se nezavolaly → timeouty;
a `legalStub` testy tiše prošly přes knihu místo enginu (ztráta zubů).

Ověřeno stashnutím změny: bez ní 166/166 zelených, s ní 9 padá → deterministická
regrese z mé změny, ne zátěžová flakiness.

**Oprava:** všech 6 souborů dostalo lokální wrapper `build()`, který do `buildApp`
injektuje **prázdnou knihu** (`OpeningBook = new Map()`). Tyto testy cvičí engine,
ne knihu — s prázdnou knihou se chovají identicky jako před jejím naplněním a jsou
**nezávislé na dalším růstu knihy** (fáze 60-63 přidají další první tahy, tohle už
nebudou muset řešit). Kniha je injektovatelná přesně kvůli tomuto (option existuje
od fáze 56). Po opravě 171/171 zelených a čas testů spadl z ~27 s na ~7 s (zmizely
5s timeouty).

## Zvážené a zamítnuté alternativy (kandidát na /mini:decision)
- **Změnit první lidský tah na mimo-knižní (např. 12-16):** menší diff, ALE jen
  odklad — v pozdější fázi se 12-16 zabookuje a testy padnou znovu; navíc by
  rozbilo board-asserty v gate.test (očekává engine 23-18 po 9-13).
- **Vytvořit partie na úrovni bez knihy (beginner):** mění cestu síly enginu a
  některé testy explicitně ověřují default Profesionál.
- **Zvoleno: injektovat prázdnou knihu** — chování == baseline, budoucnost-odolné,
  konzistentní. Doporučuju zvážit `/mini:decision` na zaznamenání tohoto „proč".

## Self-review nezávislým sub-agentem (čerstvý kontext)
Chytil 3 věci, všechny vyřešeny:
1. **KRITICKÉ (recidiv z MEMORY.md):** moje editace CHANGELOGu omylem smazala
   hlavičku `## [0.45.0]` a slila vydaný obsah 11-15 pod `[Unreleased]`. Vráceno.
   Ověřeno `git diff` — žádná hlavička verze se už nemaže.
2. **STŘEDNÍ:** komentář u REFERENCE_LINES přeháněl ochranu (je to kopie SEED_LINES,
   souběžný překlep nechytí — chytilo ho až nezávislé čtení proti Pask). Komentář
   zpřesněn na reálnou hranici ochrany (budoucí divergence).
3. **DROBNÉ:** křehká čísla řádků pdftotext v komentářích nahrazena stabilními
   odkazy na Ballot čísla.
   Data samotná sub-agent ověřil proti Pask jako **přesná** (žádná záměna polí,
   žádný legální-ale-špatný tah).

## Stav bran
- `pnpm --filter @checkers/server exec vitest run` → 18 souborů, 171 testů zelených.
- `pnpm test` (celé monorepo) → cli, web (244), engine (250), server (171) zelené.
- `pnpm -r typecheck` a `pnpm lint` → čisté.

## Rozsah / vědomě odloženo
Zbývající první tahy černého (9-14, 10-14, 10-15, 11-16, 12-16) — po jednom komplexu
za fázi, jak si přál uživatel („postupně vsech 6 … podle knihy"). Zrcadlová
symetrie, náhodný výběr pro variabilitu — dál mimo rozsah.

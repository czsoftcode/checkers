---
phase: 11
verdict: done
steps:
  - title: "ALL_DIRS má jediný zdroj pravdy"
    status: done
  - title: "Tvrdý strop hloubky perft"
    status: done
  - title: "@types/node ^24 v catalogu"
    status: done
  - title: "GitHub Actions přišpendlené na commit SHA"
    status: done
  - title: "Projektový dokument a ADR: Node 24"
    status: done
verify:
  - title: "CI po pushi zelené s akcemi přišpendlenými na SHA"
    detail: "Lokálně ověřeno: YAML validní, SHA sedí na tagy v7.0.0 / v6.0.9 / v6.4.0 (dohledáno přes gh api, anotovaný tag pnpm/action-setup dereferencován). Reálný běh workflow jde ověřit až na GitHubu po pushi."
---

# Phase 11 — report z auto session

## Co se udělalo

1. **ALL_DIRS jediný zdroj pravdy** – lokální kopie v `moves.ts` a `invariants.test.ts` smazané, obě místa importují export z `board.ts` (nově re-exportovaný i z `index.ts`). Grep potvrzuje jedinou definici (`board.ts:124`). Navíc přibyl test přibíjející obsah konstanty (`[NW, NE, SW, SE]`) – dedup totiž vzal testu nezávislou kopii, takže vypuštěný směr by jinak invarianty tiše zúžil místo shození.
2. **Strop perft** – `MAX_PERFT_DEPTH = 12` v `perft.ts`, hloubka nad strop hodí RangeError; exportováno i z `index.ts`. Testy: hloubka MAX+1 a MAX_SAFE_INTEGER odmítnuty, hraniční MAX projde validací. Nad-stropní testy záměrně používají pozici bez tahů, ne výchozí – kdyby strop někdo odstranil, exponenciální perft z výchozí pozice by test zavěsil (synchronní rekurzi vitest timeout nepřeruší); takhle čistě spadne `toThrow`.
3. **@types/node ^24.0.0** v catalogu, lockfile resolvuje 24.13.2 – typy konečně popisují runtime, na kterém repo běží. Instalace, typecheck i testy zelené.
4. **CI akce na commit SHA** – `actions/checkout@9c091bb2… # v7.0.0`, `pnpm/action-setup@0ebf4713… # v6.0.9`, `actions/setup-node@48b55a01… # v6.4.0` + komentář, jak SHA při updatu dohledat. Trade-off: updaty akcí jsou teď ruční (žádný Dependabot v repu není).
5. **Projektový dokument** – Main constraints v `.mini/project.md` říká Node 24 LTS včetně zdůvodnění (repo na 24 běželo od začátku, Node 24 je aktivní LTS, srovnání dokumentu s realitou místo downgrade).

## Nezávislý self-review (sub-agent, čerstvý kontext)

Podle pravidel projektu proběhl před reportem – fáze sahá na cross-module kontrakt a chybovou cestu. Chytil 2 reálné nálezy, oba opravené ještě v této fázi: (a) test stropu by při odstranění stropu zavěsil CI místo pádu, (b) obsah ALL_DIRS po dedupu nic nepřibíjelo. Třetí poznámka (readonly je jen typová ochrana, pole není `Object.freeze`) je konzistentní s existujícími exporty NEIGHBORS/JUMPS/DIR – neřešeno, jen zaznamenáno. Mutační testy potvrzeny: `>` → `>=` shodí hraniční test, odstranění stropu shodí toThrow.

## Sebekontrola (checklist z CLAUDE.md)

Nová chybová větev (perft strop) je dosažitelná (`perft(p, 13)`), testovaná a testy mají zuby (ověřeno mutací). Žádné nové exit kódy, catch bloky ani I/O. Kontrakt ALL_DIRS je teď konstanta + test reálného kódu.

## Otevřené / pro člověka

- **ADR**: rozhodnutí Node 24 vs. Node 22 je zapsané v project.md, ale formální ADR záznam patří do `/mini:decision` – doporučuji spustit před `/mini:done` (rozhodnutí: srovnat dokumentaci na Node 24 místo downgrade repa; zvažovaná a zamítnutá alternativa: shodit repo na Node 22 kvůli souladu s původním dokumentem).
- **CI**: reálný běh s pinovanými akcemi ověří až push (viz verify).
- Lint po dedupu chytil nepoužívaný import `DIR` v testu – opraveno hned (později se `DIR` vrátil kvůli novému testu obsahu ALL_DIRS).

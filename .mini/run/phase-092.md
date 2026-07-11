---
phase: 92
verdict: done
steps:
  - title: "Přeformátovat formatGamePdn (anonymní, UTC, tahy pod sebou)"
    status: done
  - title: "Napojit archivaci na broadcast choke point (idempotentně)"
    status: done
  - title: "Testy: PvP konec → PDN"
    status: done
verify:
  - title: "Otevřít vygenerovaný .pdn v externím nástroji na dámu a zkusit ho přehrát"
    detail: "Formát i parseovatelnost jsou ověřené testy (tagy, UTC, tahy pod sebou, tokeny). Reálné přehrání ve třetím nástroji (např. importér PDN) jsem sám nezkoušel – to je jediná věc, kterou mechanicky neověřím. Default archivní adresář je <repo>/.pdn (nebo CHECKERS_PDN_DIR)."
---

# Fáze 92 — report z auto session

## Co je hotové
PDN archiv (`archive.ts`) je napojený na konec PvP partie. Zápis je jednosměrný, na disk, zpět se nenačítá.

1. **`formatGamePdn` přeformátovaná** (`packages/server/src/archive.ts`):
   - `[Event "American Checkers"]` místo `"Checkers"`,
   - standardní `[UTCDate]` + `[UTCTime]` v UTC místo lokálního `[Date]`,
   - anonymní `[White "?"]` / `[Black "?"]` místo natvrdo `Engine`/`Human` (GDPR – žádná jména, žádné session id),
   - movetext: jeden číslovaný tah (pár půltahů) na SAMOSTATNÉM řádku, výsledkový token na vlastním posledním řádku. PDN zůstává parseovatelný (bílé znaky v movetextu jsou nevýznamné).
   - Test `pdn.test.ts` přepsaný na nový tvar (UTC z `Date.UTC`, kontrola tahů pod sebou přes `split('\n')`, kontrola absence jmen).

2. **Archivace na broadcast choke point** (`packages/server/src/app.ts`):
   - `broadcast(record)` volá novou `maybeArchive(record)`. `broadcast` je společné hrdlo VŠECH tří terminálních konců (vzdání / dohodnutá remíza / přirozený konec po tahu), takže jedno napojení pokryje všechny.
   - Guard přes `store.markArchived(id)` (už existovala) – atomický synchronní check-and-set, zápis PDN proběhne právě jednou. Neterminální tahy padnou na `ongoing` guardu ještě před poznačením.
   - `writeGamePdn` je fire-and-forget a nikdy nevyhazuje → selhání zápisu neshodí konec partie ani WS.
   - Bez `pdnDir` se nearchivuje. Přidán injektovatelný `now` (kvůli determinismu testů), v produkci `() => new Date()`. `main.ts` `pdnDir` už předával, komentář aktualizován.

3. **Integrační testy** (`packages/server/test/pvp-archive-ws.test.ts`): nad reálným room WS tokem + reálným zápisem na disk (dočasný adresář, injektovaný čas). Vzdání, dohodnutá remíza i přirozený konec dle pravidel každý zapíšou právě jeden PDN se správným formátem a výsledkem; rozehraná (ongoing) se NEarchivuje; bez `pdnDir` se nepíše nic; po konci je partie označená archivovanou (guard proti druhému zápisu). Terminální herní linie pro „přirozený konec" se dopočítá za běhu z knihovny `rules`, takže test drží krok se změnami pořadí tahů v enginu (nehardkóduje se).

## Ověřeno mechanicky
- `pnpm --filter @checkers/server test` → 156 passed (15 souborů).
- Celý workspace: `pnpm typecheck` čistý, `pnpm test` → server 156, web 563, ai 54.
- `pnpm lint` (root eslint) čistý.

## Adversariální self-review
Kvůli dotčeným chybovým cestám + vstupnímu bodu + cross-module kontraktu jsem před reportem pustil nezávislého sub-agenta (čerstvý kontext). Závěr: **žádný kritický nález**, testy mají zuby (ověřeno myšlenkovým rozbitím reálného kódu – odebrání `markArchived`, odebrání `pdnDir` guardu i přehození result tokenu každé shodí odpovídající test). Idempotence bez race (synchronní check-and-set), snapshot vs. live store konzistentní.

Dvě zmínky nízké závažnosti (ne defekty):
- Záruka „archivace nikdy neshodí" platí pro I/O část (`writeGamePdn`); synchronní `formatGamePdn`/`now` je záměrně neobalená – jediná throw cesta (`'ongoing'`) je odstíněná guardem, cokoli dalšího by byla programová korupce dat, která MÁ padnout hlasitě (v souladu se zásadou nemaskovat TypeError jako I/O). Doplnil jsem to do komentáře `maybeArchive`, kód beze změny.
- Idempotence guardu má zuby jen na úrovni flagu (odebrání `markArchived` shodí test na `archived === true` i na druhé `markArchived() === false`), NE na umístění guardu vůči zápisu (mark-před vs. za). Umístění by rozlišil jen reálný DVOJITÝ terminální broadcast na tutéž partii – ten v tomhle kódu strukturálně nenastane (broadcast na terminál padne jednou; tah/vzdání po konci server odmítne dřív). Testovací seam jen kvůli nedosažitelné cestě jsem vědomě NEpřidával (vrstva „pro budoucnost").

## Trade-off k vědomí
Partie se označí za archivovanou PŘED dokončením asynchronního zápisu. Když zápis selže (plný disk, práva), PDN se už nezkusí zapsat podruhé – garance je „nejvýš jednou", ne „garantovaně na disku". Pro best-effort anonymní archiv je to přijaté; opačné pořadí (mark až po úspěchu) by otevřelo dvojí zápis při rychlém druhém broadcastu, což je horší.

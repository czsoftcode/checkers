# Phase 23 — Server ukládá partie na disk

**Goal:** Po skončení partie server atomicky (zápis do .tmp + rename ve stejném adresáři) uloží kompletní PDN partie do konfigurovatelného adresáře (env proměnná, výchozí .pdn/ v rootu repa, přidán do .gitignore) jako <id>.pdn. Jednosměrně: zpět se do hry nenačítá a stav dál žije v paměti serveru (server zůstává autoritou). Selhání zápisu (plný disk, chybějící práva, neexistující adresář) partii NEshodí - jen se zaloguje přes server logger. Mimo rozsah: klientský LocalStorage archiv, tlačítko Export, načítání partií zpět, procházení/analýza v appce.

## Steps
- [done] Store: evidence tahů + příznak archived
- [done] Serializér celé partie do PDN (balík server, čistá funkce) + unit test
- [done] Atomický zápis na disk + konfigurace
- [done] Napojení archivace na terminální stav (právě jednou)
- [done] Integrační a selhací testy
- [done] Sebekontrola unhappy path + nezávislý self-review

## Auto-commit
- Phase 23: Server ukládá partie na disk

## Discussion
# Phase 23 — Server ukládá partie na disk

## Intent
Když partie dojde do terminálního stavu (výhra/prohra/remíza), server z ní vyrobí
kompletní PDN celé partie (hlavička + očíslované tahy + výsledkový token) a atomicky
ho zapíše jako `<id>.pdn`. Jednosměrně: zpět se do hry nenačítá, stav dál žije v
paměti serveru (server zůstává autoritou). Selhání zápisu partii neshodí, jen se
zaloguje. Nahrazuje původní backlog-21 (klientský LocalStorage archiv), který tímto
padá — vědomá změna non-goalu (server se poprvé dotýká disku, jednosměrně).

## Key decisions
- **Evidence tahů ve store (nutné, hlavní rozšíření rozsahu).** `GameStore`/`GameState`
  dnes NEDRŽÍ seznam odehraných tahů — `advanceState` tah zahraje a store ho zahodí;
  `GameState` má jen `position` + `pliesWithoutProgress` + `repetitionHistory` (klíče
  pozic, ne tahy). Z finální pozice tahy zpětně NEJDOU zrekonstruovat. Fáze proto musí
  napřed přidat pole tahů do `StoredGame`/`GameRecord`, plněné v `store.applyMove()`
  na OBOU místech (tah člověka i tah enginu). Bez toho PDN nelze sestavit.
- **Serializér celé partie → do balíku `server`** (ne do rules). Jen server ho
  potřebuje (CLI ne), nezavádět vrstvu „pro budoucnost" do rules. Čistá funkce,
  otestovaná unit testem. Pro jednotlivé tahy použít existující `formatMove()` z rules.
- **Hlavičkové tagy (7 STR):** `[Event "Checkers"]`, `[Site "local"]`,
  `[Date "YYYY.MM.DD"]` (dnešek přes `new Date()` — v serveru povoleno), `[Round "-"]`,
  `[White "Engine"]`, `[Black "Human"]`, `[Result "…"]`. Jména hráčů se neřeší
  (multiplayer je non-goal).
- **Mapování hráčů/výsledku (z app.ts):** člověk = ČERNÝ (Black, začíná), engine =
  BÍLÝ (White; `ENGINE_COLOR = 'white'`). `GameResult` → token: `black-wins` → `0-1`,
  `white-wins` → `1-0`, `draw` → `1/2-1/2`. (`ongoing` se nikdy nezapisuje.)
- **Zápis se odčeká (await), chyba se jen zaloguje.** V cestě `POST /moves` (partii
  ukončí tah člověka) i v `runEngineMove` (ukončí tah enginu) se zápis awaituje;
  jednodušší na uvažování i test než fire-and-forget. Selhání → `console.error`,
  partie pokračuje/zůstává stát.
- **Konfigurace:** env `CHECKERS_PDN_DIR`, výchozí `.pdn` relativně k `process.cwd()`.
  Adresář se vytvoří `fs.mkdir(dir, { recursive: true })`. Cesta se předá do `buildApp`
  jako `pdnDir?` (DI kvůli testovatelnosti, stejně jako engine/port); env čte až
  `main.ts`, ne `app.ts`.
- `.pdn/` přidat do `.gitignore`.

## Watch out for
- **Právě jednou.** Terminální stav se dosáhne jen na dvou `applyMove` místech
  (POST člověk ř. 131, engine ř. 211); polling GET tah neaplikuje, takže sám o sobě
  zápis nespustí. Přesto přidat příznak `archived` do záznamu, aby žádná re-entrantní
  cesta nezapsala partii dvakrát. Kontrola terminality přes `gameResultFromState(state)
  !== 'ongoing'` PO aplikaci tahu.
- **Atomicita + úklid při selhání.** Psát do `<id>.pdn.tmp` v TÉMŽE adresáři, pak
  `fs.rename` na `<id>.pdn` (atomické na stejném FS). Když `rename`/zápis selže,
  `.tmp` po sobě uklidit (`unlink`), ať nezůstává půlka souboru (checklist bod 5).
- **Rozsah catch.** Obalit jen I/O (mkdir/write/rename/unlink). Nemaskovat programovou
  chybu v sestavení PDN (ta ať padne hlasitě — je to chyba serveru, ne I/O).
- **Číslování tahů v movetextu.** Full-move číslování páruje černý+bílý půltah
  (`1. <black> <white> 2. …`). Černý začíná. Ošetřit LICHÝ počet půltahů (partie končí
  po tahu černého → poslední číslo má jen jeden půltah). Otestovat.
- **Ambiguita výchozího adresáře.** `.pdn` relativně k `process.cwd()` = root repa
  jen když se server spouští z rootu (`pnpm dev` z rootu). Z `packages/server` by to
  bylo jinde. Zdokumentovat u env proměnné.
- **Nedohrané partie se nearchivují** (restart serveru mid-game, in-memory) — vědomě
  přijato (jednosměrné, best-effort).
- **Test se zuby.** Přes `mkdtemp` do dočasného adresáře odehrát KRÁTKOU partii do
  reálného konce (ne mock), pak ověřit, že `<id>.pdn` existuje a obsah má hlavičku,
  správný výsledkový token a očíslované tahy. Test na selhání zápisu: neexistující/
  read-only adresář → partie NEspadne, jen se zaloguje, žádný `.tmp` nezůstane.
- **Bez enginu.** `buildApp` běží i bez enginu (`engine === undefined`); archivace
  musí fungovat vždy, když se dosáhne terminálního stavu, nezávisle na přítomnosti
  enginu.

## Run report
---
phase: 23
verdict: done
steps:
  - title: "Store: evidence tahů + příznak archived"
    status: done
  - title: "Serializér celé partie do PDN (balík server, čistá funkce) + unit test"
    status: done
  - title: "Atomický zápis na disk + konfigurace"
    status: done
  - title: "Napojení archivace na terminální stav (právě jednou)"
    status: done
  - title: "Integrační a selhací testy"
    status: done
  - title: "Sebekontrola unhappy path + nezávislý self-review"
    status: done
verify:
  - title: "Načíst exportovaný .pdn ve vnějším nástroji na rozbor partií"
    detail: "Movetext čísluje černý+bílý půltah pod jedno číslo (`1. <černý> <bílý>`), člověk je Black a začíná. To je pro anglickou dámu standardní (černý táhne první), ale neověřoval jsem to proti konkrétnímu externímu parseru. Otevři jeden reálně vygenerovaný soubor v nástroji, který používáš, a zkontroluj, že tahy sedí na správné strany."
---

# Phase 23 — report z auto session

## Co je hotové
Server po skončení partie zapíše kompletní PDN jako `<id>.pdn`. Vše zelené:
lint, typecheck všech balíků, 59 testů serveru (606 v celém repu).

- **`store.ts`**: `GameRecord`/`StoredGame` dostaly `moves: Move[]` (plněné v
  `applyMove`) a `archived: boolean`; nový `markArchived` (atomický check-and-set,
  žádný `await` mezi čtením a zápisem → zápis právě jednou). `GameRecord.moves`
  se vrací jako KOPIE (snímek), ne živý odkaz do store.
- **`archive.ts`** (nový): `formatGamePdn` (čistá funkce – 7 STR tagů, full-move
  číslování, výsledkový token; `ongoing` → RangeError hlasitě) + `writeGamePdn`
  (atomický `.tmp` + `rename`, `mkdir` recursive, nikdy nevyhazuje, při chybě
  loguje a uklidí `.tmp`; `try` obaluje výhradně I/O).
- **`app.ts`**: `maybeArchive` napojená na OBA terminální body – POST tahu člověka
  (await před odpovědí) i `runEngineMove` (po tahu enginu). Funguje i bez enginu.
- **`main.ts`**: env `CHECKERS_PDN_DIR` (relativně ke cwd) NEBO výchozí `.pdn`
  ukotvené na KOŘEN REPA (odvozeno z `import.meta.url`, nezávislé na cwd).
  `.pdn/` v `.gitignore`.
- **Testy**: `store.test.ts`, `pdn.test.ts` (číslování/tokeny/lichý počet/prázdný
  seznam/`ongoing`), `archive.test.ts` (celá partie do konce → validní soubor;
  právě jednou; bez `pdnDir` se nezapisuje; selhání zápisu partii neshodí + žádný
  `.tmp`; partie dohraná ENGINEM se zarchivuje).

## Nezávislý self-review (sub-agent) – co našel a jak jsem to vyřešil
Pustil jsem adversariálního sub-agenta s čerstvým kontextem. Dvě věci jsem podle
něj OPRAVIL:

1. **Engine větev archivace neměla zuby.** Původní integrační testy běžely jen v
   manuálním režimu (bez enginu), takže archivaci po tahu enginu (`runEngineMove`)
   žádný test netrefil – deterministická partie „obě strany první legální tah"
   končí remízou po tahu ČERNÉHO. Přidal jsem test s engine stubem hrajícím
   POSLEDNÍ legální tah (proti prvnímu legálnímu člověku končí partie výhrou
   BÍLÉHO po 38 půltazích) → terminální tah dělá engine. Ověřeno „se zuby":
   s dočasně vypnutou engine archivací test spadne.
2. **`GameRecord.moves` byl živý odkaz na pole, které store dál mutuje.** Teď se
   vrací kopie (snímek) – archivace nemůže vzít jiný seznam tahů, než jaký byl
   v okamžiku konce.

## Lidská verifikace – nalezeno a opraveno
Uživatel dohrál reálnou partii (prohra, `1-0` pro engine) – PDN se zapsalo
správně a je validní, ALE spadlo do `packages/server/.pdn/`, ne do rootu repa.
Příčina: `pnpm --filter @checkers/server start` běží s cwd = `packages/server`,
takže původní cwd-relativní default mířil vedle balíku. OPRAVENO: výchozí `.pdn`
teď ukotveno na kořen repa přes `import.meta.url` (nezávislé na cwd, ověřeno
probem: `repoRoot` = kořen repa z libovolného cwd). `CHECKERS_PDN_DIR` zůstává
relativní ke cwd. Dvě partie z testovacího běhu zůstaly v `packages/server/.pdn/`
(gitem ignorováno) – nové partie už jdou do rootu.

Pozn.: projekt nemá `.env` ani jeho načítání – `CHECKERS_PDN_DIR` se čte přímo
z prostředí procesu.

## Vědomě přijatá omezení (NEopraveno, patří do rozhodnutí / watch)
- **Zápis nemá timeout.** POST tahu člověka `await`uje `writeGamePdn`. Chyby
  odchytí catch, ale ZASEKNUTÝ filesystem (stuck NFS mount) není chyba → odpověď
  na poslední tah by visela. Pro lokální `.pdn/` prakticky nenastane; kdyby
  `CHECKERS_PDN_DIR` mířil na síťový svazek, je to reálné. Nezaváděl jsem
  timeout (gold-plating lokálního nástroje) – ale je to vědomá díra.
- **U tahu ENGINU je soubor na disku až chvíli PO tom, co klient uvidí konec
  partie** (`runEngineMove` je fire-and-forget, zápis doběhne později). U tahu
  člověka se zápis odčeká před odpovědí. Funkčně OK (best-effort archiv), ale
  polling může konec partie zaznamenat dřív než soubor. Test to řeší krátkým
  čekáním na soubor.
- **Žádný retry.** `archived=true` se nastaví PŘED zápisem (kvůli „právě jednou"),
  takže transientní I/O chyba (chvilkově plný disk) = trvalá ztráta z archivu,
  nezkusí se znovu. Odpovídá „jednosměrné best-effort".

## Rozhodnutí k zaznamenání (ADR)
Tahle fáze je VĚDOMÁ ZMĚNA NON-GOALU: server se poprvé dotýká disku. Projektové
non-goals pořád tvrdí „klientský LocalStorage + export je jediná výjimka" a
„partie žijí v paměti serveru". Doporučuju před `/mini:done` spustit
`/mini:decision` a zapsat, PROČ (server-side `<id>.pdn` je jednosměrný best-effort
výstup pro externí rozbor, ne perzistence stavu; nahrazuje backlog-21 LocalStorage;
+ rozhodnutí await-and-log místo fire-and-forget). Zároveň by se měly srovnat
non-goals v `.mini/project.md` s realitou (jako u nálezu 11 / Node 24).

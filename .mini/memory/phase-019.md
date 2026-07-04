# Phase 19 — Orchestrace enginu: podproces + fronta

**Goal:** Modul EngineClient v serveru spustí engine jako podproces za JSON Lines protokolem a žádosti o bestmove řadí do sériové fronty (nikdy synchronně v handleru); hlídá tvrdý timeout timeMs+500 s kill+restart+1 retry na timeMs/2 a uklidí zombie procesy při startu i vypnutí; server napojí endpoint, který engine tah reálně zahraje do partie a ověří ho stejnou cestou přes rules jako tah hráče (server zůstává jedinou autoritou). Brána M4: kill enginu uprostřed přemýšlení — partie přežije, zotaví se a pokračuje přes HTTP.

## Steps
- [done] EngineClient: spawn + protokol + párování
- [done] Sériová fronta + tvrdý timeout + kill/restart/retry
- [done] Pidfile + úklid procesů + close()
- [done] engineStatus ve stavu partie + GameDto
- [done] Napojení na server: tah enginu na pozadí z POST /moves
- [done] Brána M4: kill uprostřed přemýšlení, partie přežije

## Auto-commit
- Phase 19: Orchestrace enginu: podproces + fronta

## Discussion
# Phase 19 — Orchestrace enginu: podproces + fronta

## Intent
Lepidlo mezi serverem (fáze 18, čistě člověk↔REST, in-memory store, žádný
podproces, žádný shutdown hook) a enginem (samostatný proces za JSON Lines,
`bestmove` s měkkým `timeMs`, tvrdý strop nechává na volajícím).

Fáze staví `EngineClient` v serveru: spustí engine jako podproces, mluví s ním
po řádcích (párování požadavek↔odpověď přes `id`), řadí `bestmove` do **sériové
fronty**, hlídá tvrdý timeout `timeMs+500`, při killu/pádu **restart + 1 retry
na `timeMs/2`**, uklidí procesy při startu i vypnutí. A endpoint/cesta, kterou se
tah enginu reálně dostane do partie — ověřený **stejnou cestou přes `rules`
(`findLegalMove`) jako tah člověka**, protože engine je nedůvěryhodný a server
zůstává jedinou autoritou.

Brána M4: kill enginu uprostřed přemýšlení → partie přežije, zotaví se (retry
uspěje) a pokračuje přes HTTP.

## Key decisions
- **Spouštění tahu enginu = polling model** (ne explicitní endpoint). `POST
  /games/:id/moves` aplikuje tah člověka, vrátí OKAMŽITĚ stav po tahu člověka a
  na pozadí (v sériové frontě, **nikdy synchronně v handleru**) spustí výpočet
  enginu. Klient tah enginu uvidí pollingem `GET /games/:id`. Sedí s M5/todo 20
  (optimistický tah + polling ~250 ms).
- **Barvy napevno pro v1:** člověk = černý (začíná), engine = bílý. Engine vždy
  jen odpovídá, nikdy netáhne první → žádná zvláštní logika při založení partie,
  žádná volba barvy.
- **Jeden sdílený proces enginu + jedna globální sériová fronta** přes všechny
  partie. Víc souběžných partií / paralelismus je M6 (todo 22), teď ne.
- **Úklid zombie přes pidfile:** při vypnutí SIGTERM/SIGINT → zabít engine; při
  startu přečíst pidfile a zabít osiřelý proces z minulého (spadlého) běhu.
  Reálné riziko: engine BĚHEM searche nečte stdin, takže po SIGKILL rodiče běží
  dál jako sirotek, dokud nedopočítá — EPIPE ho sám nezabije včas. Pidfile je
  procesní hygiena, ne perzistence partií (výjimka z „žádná perzistence").
- **Trvalé selhání enginu = partie přežije, server nespadne.** Když oba pokusy
  vyprší / engine spadne / vrátí NELEGÁLNÍ tah: tah enginu se nesplní, partie
  zůstane stát na tahu člověka, chyba se zaloguje a **vystaví ve stavu**. UI
  kolem toho řeší M5.
- **Nový stav `engineStatus: 'idle' | 'thinking' | 'error'`** v `GameDto`
  (rozšíření drátového kontraktu → fixují testy). Zdůvodnění TEĎ, ne pro
  budoucnost: bez něj není brána „pokračuje / zotaví se" přes HTTP pozorovatelná
  a trvalé selhání (bod výš) je pro klienta neviditelné.
- **Čas enginu drží server:** konstanta `ENGINE_TIME_MS` (návrh 1000 ms),
  přebíjitelná přes env; klient ji NEposílá. Tvrdý timeout = `ENGINE_TIME_MS +
  500`, retry na `ENGINE_TIME_MS / 2`.
- **Injektovatelný spawn příkaz** (cesta + argumenty) v `EngineClient`, aby test
  brány mohl ukázat na falešný pomalý/nereagující engine a spolehlivě spustit
  větev timeout → kill → restart → retry. Reálný engine se testuje zvlášť v
  happy path.

## Watch out for
- **`tsx` studený start (stovky ms).** Po killu retry na `ENGINE_TIME_MS/2`
  znamená, že část rozpočtu sežere restart procesu → reálný čas na search je
  kratší. Retry zachraňuje partii, ne kvalitu tahu. Zvážit warm proces a
  respawn jen jednou.
- **Nelegální tah od enginu je jiné selhání než timeout/pád.** Retry
  (`timeMs/2`) je pro pád/timeout; nelegální nebo protokolová chyba (engine
  odpoví, ale `findLegalMove` = undefined, nebo `error`/`no_legal_moves`) →
  rovnou `engineStatus: 'error'`, žádné zacyklení retry. Engine je nedůvěryhodný,
  jeho `move` se NIKDY neaplikuje bez `findLegalMove`.
- **Zdvojený tah člověka, než engine odpoví,** odmítne autorita sama (není černý
  na tahu → prázdný seznam legálních tahů → 409 illegal_move). Žádné zvláštní
  `if` navíc.
- **Po hard-killu žádné zpožděné řádky** ze starého procesu (roura se zavře),
  nový proces má čisté pípy → párování přes `id` se nezmate. Hard timeout VŽDY
  killuje, takže nevzniká nejednoznačnost „pozdní odpověď na starý id".
- **Server dnes nemá shutdown hook** — přidat SIGTERM/SIGINT → zavřít engine +
  smazat pidfile → `app.close()`. Bez toho by kill serveru nechal osiřelý engine.
- **Engine se ptá jen když `gameResultFromState === 'ongoing'`.** V pozici bez
  legálních tahů je partie u konce, `bestmove` by vrátil `no_legal_moves` — na to
  se engine vůbec nemá ptát.
- **Fronta drží stav i při chybě.** Když job selže/vyhodí, fronta se nesmí
  zaseknout (další partie musí jít dál) a nesmí zůstat polovičatý stav (proces
  bez pidfile, `engineStatus` viset na `thinking`).
- **Test brány musí mít zuby:** dočasné vypnutí kill/retry logiky musí shodit
  test (partie by po killu uvázla), ne jen „běží to".

## Run report
---
phase: 19
verdict: done
steps:
  - title: "EngineClient: spawn + protokol + párování"
    status: done
  - title: "Sériová fronta + tvrdý timeout + kill/restart/retry"
    status: done
  - title: "Pidfile + úklid procesů + close()"
    status: done
  - title: "engineStatus ve stavu partie + GameDto"
    status: done
  - title: "Napojení na server: tah enginu na pozadí z POST /moves"
    status: done
  - title: "Brána M4: kill uprostřed přemýšlení, partie přežije"
    status: done
verify:
  - title: "Tvrdá pojistka shutdownu při reálně VISÍCÍM app.close()"
    detail: "Kód pro případ, kdy app.close() nikdy nedoběhne (keep-alive spojení), jsem přidal (Promise.race s timeoutem + hard-exit setTimeout + vynucení druhým signálem), ale nešlo mi spolehlivě vyrobit reálné zavěšení app.close(), takže tuhle konkrétní větev jsem NEexekvoval end-to-end. Běžný SIGTERM (i uprostřed přemýšlení) i druhý signál jsem ověřil ručně."
---

# Phase 19 — report z auto session

## Co je hotové
Server nově orchestruje TS engine jako oddělený podproces za JSON Lines protokolem.

- **`EngineClient`** (`src/engine-client.ts`): spawn podprocesu (příkaz injektovatelný),
  párování odpověď↔požadavek přes monotónní `id`, **sériová fronta** (tail-chain, která
  mapuje úspěch i chybu na `undefined`, takže se nezasekne), tvrdý timeout
  `timeMs + 500` → SIGKILL → restart → **1 retry na `timeMs/2`**; protokolová chyba se
  NEopakuje. Pidfile: úklid osiřelého procesu při vzniku klienta, `close()` zabije proces
  a smaže pidfile. Protokolové typy se importují z `@checkers/engine` (neopisují se).
- **`engineStatus`** (`idle`/`thinking`/`error`) ve store i `GameDto`; `gameToDto` má
  parametr POVINNÝ (kompilátor hlídá vynechání – viz níže „co se pokazilo").
- **Napojení** (`src/app.ts`): `POST /moves` po tahu člověka spustí tah enginu NA POZADÍ
  (handler nikdy nečeká), klient ho vidí pollingem `GET`. Engine je nedůvěryhodný – jeho
  tah se aplikuje jen po `findLegalMove`.
- **Shutdown hook** (`src/main.ts`): SIGTERM/SIGINT → app.close() (s timeoutem) →
  engine.close() → exit; druhý signál vynutí tvrdé ukončení.
- **Brána M4** (`test/gate.test.ts`): reálný podproces, kill enginu zvenčí uprostřed
  přemýšlení přes HTTP → orchestrace se zotaví (restart+retry) → tah dorazí. Ověřil jsem
  ZUBY: s vypnutým retry brána spadne (engineStatus uvázne na `error`).

Testy: 39 serverových (reálný i falešný engine), celé repo zelené (rules/cli/engine/server),
typecheck + lint čisté. Reálný end-to-end: server + skutečný engine, tah přes curl, SIGTERM
během přemýšlení opakovaně bez sirotka.

## Co se pokazilo (a chytilo)
- **Tichý default `engineStatus`.** Nejdřív jsem dal `gameToDto(..., engineStatus = 'idle')`.
  Reálný test odhalil, že GET a POST /games ten třetí argument NEpředávaly → GET vždy hlásil
  `idle`, i když engine reálně selhal (`error`). Přesně ten cross-module footgun z CLAUDE.md.
  Oprava: parametr je POVINNÝ, kompilátor teď každé vynechané volání zachytí.

## Nezávislý adversarial review (čerstvý sub-agent) — 2 opravy před reportem
Pustil jsem nezávislou recenzi. Našla dvě self-catchable chyby, obě jsem OPRAVIL:

1. **Díra v autoritě + TOCTOU v `runEngineMove`.** `POST /moves` neměl autoritu barvy:
   klient mohl zahrát legální BÍLÝ tah, zatímco engine přemýšlí, a přepsat mu pozici.
   Defenzivní re-check v `runEngineMove` navíc běžel PŘED awaitem (slepé místo).
   Oprava: (a) `POST /moves` odmítá tah, když je zapojený engine a na tahu je bílý →
   nový kód `not_your_turn` (409); (b) `runEngineMove` po awaitu znovu načte stav a
   ověří/aplikuje tah proti AKTUÁLNÍ pozici, ne proti snímku. Testy: autorita barvy
   (409 not_your_turn) přidána.
2. **Shutdown neubil engine při visícím `app.close()`.** Původní `await app.close()` bez
   timeoutu mohl viset → engine.close() se nikdy neprovede → sirotek. Oprava: race s
   timeoutem, engine.close() se provede vždy, hard-exit pojistka, druhý signál = tvrdý konec.

Recenze potvrdila, že drží: fronta se nezasekne, dvojí reject/resolve po timeout+crash
nenastane, `close()` uprostřed bestmove je bezpečný, `engineStatus` neuvázne na `thinking`,
kontrakt `engineStatus` jde všemi cestami.

Navíc jsem zpřísnil nález č. 4 (nepovinný, hygiena): odpověď nedůvěryhodného enginu se teď
runtime ověřuje na hranici (`isMoveShape`) → pokřivený `move` dá čitelný `EngineProtocolError`
místo náhodného TypeError o dvě vrstvy dál. Test přidán (mode `malformed`).

## Známá omezení (vědomě NEřešeno ve v1)
- **Recyklace PID + fixní pidfile.** `cleanupStaleProcess` zabije PID z pidfile bez ověření,
  že jde opravdu o náš engine (riziko zabití recyklovaného cizího PID; na Linuxu málo
  pravděpodobné). Výchozí pidfile je fixní cesta `tmpdir()/checkers-engine.pid` → dvě
  instance serveru by si engine zabily navzájem. Pro v1 je design „jedna instance = autorita",
  hardening (ověření přes /proc/cmdline nebo start-time) patří do M6 (todo 22).
- **`LineBuffer` nemá strop délky řádku** — už evidováno jako todo 25 (engine), týká se i
  klienta; nedůvěryhodný, ale polodůvěryhodný podproces, teoretické OOM.
- **`tsx` studený start** ukusuje z retry rozpočtu `timeMs/2` (rozhodnuto v diskuzi) — retry
  zachraňuje partii, ne kvalitu tahu.
- **Jedno nereprodukovatelné pozorování:** při úplně prvním manuálním SIGTERM zůstal engine
  sirotkem + pidfile; v 5+ následných pokusech (včetně SIGTERM během přemýšlení, 3×) se to
  ani jednou nezopakovalo. Nemám vysvětlení, ale reprodukovat nejde.

## Doporučení
Zvaž `/mini:decision` k zaznamenání **autority barvy**: diskuze psala „zdvojený tah člověka
odmítne autorita sama, žádné zvláštní if navíc" — to platilo jen pro tah ČERNÝM kamenem.
Realita si vynutila explicitní guard + nový kód `not_your_turn`, protože legální BÍLÝ tah by
`findLegalMove` jinak přijal. Budoucí čtenář se na ten „if navíc" bude ptát.

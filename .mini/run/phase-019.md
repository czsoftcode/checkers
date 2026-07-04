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

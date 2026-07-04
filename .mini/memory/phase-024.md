# Phase 24 — Vzdání hry a nová hra

**Goal:** Přidat do webového klienta tlačítka „Vzdávám hru" (aktivní za běhu partie) a „Nová hra" (aktivní jen po skončení partie). Server dostane endpoint pro vzdání, který nastaví vynucený výsledek (vyhrává engine/bílý) uložený v partii mimo pravidla; všechny čtecí cesty (DTO, archivace, kontrola „je konec?" v tazích člověka i enginu) čtou efektivní výsledek = vynucený jinak gameResultFromState, aby engine nemohl zahrát ani re-archivovat vzdanou partii. Vzdaná partie se atomicky zapíše do .pdn (token 1-0). Nová partie NEstartuje automaticky – jen na klik „Nová hra", který založí novou partii (POST /games) a před vykreslením dispose() starý controller (zabít polling).

## Steps
- [done] Store: vynucený výsledek + efektivní výsledek
- [done] Endpoint /resign + přepojení všech čtecích cest
- [done] Serverové testy se zuby
- [done] Klient: resign() v server-clientu + controller
- [done] Skořápka aplikace: stav + tlačítka + Nová hra
- [done] Klientské testy + nezávislý self-review

## Auto-commit
- Phase 24: Vzdání hry a nová hra

## Discussion
# Phase 24 — Vzdání hry a nová hra

## Intent
Testovací vybavení pro session člověk vs. počítač: web klient dostane nad deskou
řádek se stavem partie a dvě tlačítka – „Vzdávám hru" (aktivní jen za běhu partie)
a „Nová hra" (aktivní jen po skončení partie). Vzdání zapíše partii do `.pdn` a
NEspustí novou partii automaticky – nová partie vzniká výhradně klikem „Nová hra".

Pravidla ani archivace se v jádru nemění: `GameResult` už zná `white-wins` a
`RESULT_TOKEN` už mapuje `white-wins → "1-0"`. Vzdání člověka (černý) = výhra
bílého (počítač). Fáze je tedy: serverová nadstavba (vynucený výsledek mimo
pravidla) + endpoint + kus UI skořápky kolem existující desky.

## Key decisions
- **Vynucený výsledek mimo pravidla.** Do záznamu partie (store) přibude
  `forcedResult` (nebo `resignedBy`). Vznikne JEDINÁ funkce
  `efektivníVýsledek(record) = forcedResult ?? gameResultFromState(state)` a
  všechna dnešní volání `gameResultFromState` na straně serveru jdou přes ni:
  `gameToDto`, `maybeArchive`, kontrola „je konec?" v POST /moves (člověk),
  `maybeTriggerEngine`, a OBĚ terminační kontroly v `runEngineMove`.
- **Endpoint** `POST /games/:id/resign`: nastaví `forcedResult = white-wins`,
  archivuje přes `markArchived` + `writeGamePdn`, vrátí `GameDto`
  s `result: "white-wins"`. Bez těla. Bez kontroly, kdo je na tahu (vzdát lze
  kdykoli za běhu). Chyby: 404 `game_not_found`; 409 `game_over`, když je partie
  už terminální (přirozený konec i opakované vzdání). Reuse `ERROR_CODES.gameOver`,
  nový kód není potřeba.
- **Kdo se vzdává:** natvrdo černý (člověk) → vyhrává bílý, stejně jako je engine
  napevno bílý (`ENGINE_COLOR`). Platí i v manuálním režimu bez enginu.
- **Klient – vzdání během pollingu (1a):** „Vzdávám hru" nejdřív počká na doběhnutí
  právě běžícího requestu (single-flight `busy`), pak vzdání spolehlivě odešle –
  klik nesmí tiše propadnout. Během čekání tlačítko zablokovat proti dvojímu
  odeslání.
- **Potvrzení vzdání:** dvoukrokové INLINE potvrzení, žádný nativní `confirm()`
  (CSP + preference uživatele). Klik „Vzdávám hru" → „Opravdu vzdát? [Ano] [Zrušit]",
  teprve „Ano" odešle.
- **„Nová hra" = úklid controlleru:** nejdřív `dispose()` starého controlleru
  (zabít polling interval), pak `POST /games` a vykreslení nového. Dnes to
  neexistuje (`main.ts` = „restart přes obnovení stránky").
- **UI text:** „Počítač" místo „Engine" (např. „Vyhrál počítač", „Vzdal jsi –
  vyhrál počítač"). PDN tag `[White "Engine"]` ZŮSTÁVÁ (archivační kontrakt fixovaný
  testy), nemění se.
- **Vizuál minimální:** řádek stavu (na tahu / konec: výsledek) + dvě tlačítka,
  bez animací a modálů. Styl přes třídy v `styles.css` (žádné inline styly – CSP).

## Watch out for
- **Linchpin efektivního výsledku.** Vzdání NEmění stav pravidel – pozice zůstává
  `ongoing`. Když jediné místo (hlavně guardy v `runEngineMove` PO `await`) čte
  `gameResultFromState` napřímo místo efektivního výsledku, engine zahraje tah do
  vzdané partie a/nebo ji re-archivuje. Test se zuby: dočasně rozbít guard → test
  musí padnout.
- **Právě jednou.** Vzdání volá `markArchived` PŘED `writeGamePdn` (stejně jako tah);
  `markArchived` je atomický check-and-set → dvojí zápis nehrozí ani při závodu
  vzdání × dotahující engine.
- **`gameToDto` musí nést vynucený výsledek.** Dnes odvozuje result čistě ze stavu.
  Předat mu record / efektivní výsledek; DTO zůstává čisté, ale aktualizovat jeho
  testy.
- **Závod s enginem.** Vzdání ve chvíli `engineStatus === 'thinking'`: engine job se
  po `await bestmove` probere, přes efektivní výsledek uvidí terminál a skončí do
  `idle` bez aplikace tahu. Engine proces se NEzabíjí; `engineStatus` může v záznamu
  krátce zůstat `thinking`, než job doběhne – UI ukazuje konec bez ohledu na to.
- **Životní cyklus „Nová hra".** `dispose()` MUSÍ zavolat `clearInterval`, jinak
  poběží dva pollery. Rozdělaný fetch starého controlleru se může dořešit do už
  odpojeného DOM – neškodné, ale nesmí překreslit novou desku (nový controller má
  vlastní `gameId`/stav).
- **Stav tlačítek řídí server.** Enable/disable se odvozuje z `result` pozorovaného
  ze serveru (přes poll i odpovědi POST): `result !== 'ongoing'` → „Nová hra" on,
  „Vzdávám hru" off. Controller musí výsledek předat skořápce (callback).
- **Manuální režim (bez enginu).** Vzdání funguje pořád (černý → bílý). Archivace
  je vázaná na `pdnDir`; když chybí (testy, manuál), zápis se neprovede – to je
  vědomé, ne chyba.
- **PDN nerozlišuje vzdání od přirozené výhry** (obojí `1-0`). Přijato, mimo rozsah.
- **Testy se zuby (server):** vzdání běžící partie → `result: white-wins` + `<id>.pdn`
  s tokenem `1-0`; dvojí vzdání → 409 + PRÁVĚ jeden soubor; po vzdání pokus enginu
  o `bestmove` je no-op/odmítnut (guard přes efektivní výsledek). Bez enginu vzdání
  taky projde.
- **Bez inline stylů/scriptů (CSP).** Tlačítka a stav stylovat třídami v `styles.css`.

## Run report
---
phase: 24
verdict: done
steps:
  - title: "Store: vynucený výsledek + efektivní výsledek"
    status: done
  - title: "Endpoint /resign + přepojení všech čtecích cest"
    status: done
  - title: "Serverové testy se zuby"
    status: done
  - title: "Klient: resign() v server-clientu + controller"
    status: done
  - title: "Skořápka aplikace: stav + tlačítka + Nová hra"
    status: done
  - title: "Klientské testy + nezávislý self-review"
    status: done
---

# Phase 24 — report z auto session

## Co je hotové
Vzdání partie a tlačítka „Vzdávám hru" / „Nová hra" fungují end-to-end přes celý
stack. Klíčové rozhodnutí (z diskuse): výsledek vzdání žije MIMO pravidla jako
`GameRecord.forcedResult` a čte se přes jedinou funkci `effectiveResult(record) =
forcedResult ?? gameResultFromState(state)`. Tou jsem přepojil VŠECHNA serverová
rozhodovací místa „je konec?" (DTO, archivace, kontrola v POST /moves,
`maybeTriggerEngine` a OBĚ terminační kontroly v `runEngineMove`). `gameResultFromState`
se teď volá jen uvnitř `effectiveResult` — nezávislý recenzent to potvrdil.

- **Server:** nový `POST /games/:id/resign` (404 game_not_found, 409 game_over,
  jinak `white-wins` + archivace do .pdn s tokenem 1-0). `store.resign` je atomický
  check (ongoing → white-wins), `markArchived` drží „právě jednou" i při závodu
  vzdání × dotahující engine.
- **Klient:** `ServerClient.resign()`, controller dostal `resign()` s čekáním na
  doběhnutí běžícího requestu (rozhodnutí 1a, přes sledování `inflight` promise) a
  callback `onState`. Nová skořápka `app-shell.ts` řídí řádek stavu, tlačítka a
  inline dvoukrokové potvrzení vzdání (bez `confirm()` kvůli CSP); „Nová hra"
  disposuje starý controller (zabije polling) a založí nový. `main.ts` už neseeduje
  desku ani nerestartuje přes reload.

## Testy
Vše zelené: server 71, web 61, cli 24, engine 213; lint i typecheck čisté, produkční
build webu projde.
- Server `resign.test.ts`: vzdání → white-wins + .pdn 1-0; dvojí vzdání → 409 +
  právě jeden soubor; vzdání přirozeně skončené partie → 409; 404; a hlavně
  **závod s přemýšlejícím enginem** přes „gated" stub — engine po vzdání NEzahraje.
- Ověřil jsem ZUBY dvou klíčových testů dočasnou mutací kódu: (1) guard v
  `runEngineMove` na `gameResultFromState` místo `effectiveResult` → resign test
  padne (engine zahrál, `turn` se přehodil); (2) odstranění `disposed` guardu →
  test „po dispose se doběhlý poll neprojeví" padne.
- Klient: `resign()` volá správný endpoint (bez těla) + 409; controller — vzdání
  počká na inflight a teprve pak pošle, no-op na skončené partii, onState hlásí
  výsledek; app-shell — stav tlačítek dle výsledku, potvrzení Ano/Zrušit, „Nová
  hra" disposuje starý controller a vytvoří nový, chyba createGame.

## Nezávislý self-review a jeho dopad
Pustil jsem adversariálního sub-agenta (čerstvý kontext). Linchpin, atomicitu,
rozsah catch, závod resign×polling i stav tlačítek označil za čisté. Našel tři
nízké, ale reálné latentní vady v chybových cestách klienta, které jsem OPRAVIL:
1. `dispose()` během běžícího `createGame` → zombie controller s pollingem
   (přidán `disposed` guard v app-shell po awaitu).
2. Doběhlý poll starého controlleru po dispose přepisoval stav skořápky (přidán
   `disposed` guard do `applyServerState` + `dispose` ho nastavuje) — s novým testem.
3. `resignFlow` po čekání znovu neověřoval `lastResult` → zbytečný 409 request
   (přidána re-kontrola `disposed || lastResult !== 'ongoing'` po smyčce).

## Poznámky / trade-offy
- PDN nerozlišuje vzdání od přirozené výhry (obojí 1-0) a tag `[White "Engine"]`
  zůstal (archivační kontrakt) — „Počítač" je jen text na obrazovce. Vědomě.
- Vzdání je hardcoded „černý (člověk) → vyhrává bílý" i v manuálním režimu bez
  enginu — to UI je pro člověka vs. počítač.

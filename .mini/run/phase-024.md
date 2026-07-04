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

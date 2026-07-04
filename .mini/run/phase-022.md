---
phase: 22
verdict: done
steps:
  - title: "Vite proxy + typovaný server-klient"
    status: done
  - title: "Controller: async, stav bere ze serveru"
    status: done
  - title: "Polling tahu enginu (single-flight)"
    status: done
  - title: "Bootstrap: partie ze serveru + načítání"
    status: done
  - title: "Defenzivní cesty: neúspěch + resync"
    status: done
  - title: "Sebekontrola unhappy path + nezávislý self-review"
    status: done
verify:
  - title: "Vizuální hra v prohlížeči proti enginu"
    detail: "Mechanicky ověřeno po HTTP vrstvu (curl přes server i Vite proxy). Vizuální tok a spolehlivost kliku ověřil uživatel v prohlížeči; nález 22-1 (spolknutý klik při pollingu) opraven a re-verifikován."
---

# Phase 22 — report z auto session

## Co je hotové
Webový klient přestal být „druhý rozhodčí". Dřív hrál hot-seat lokálně přes
`applyMove`; teď:
- při načtení založí partii `POST /games` a vykreslí pozici z odpovědi
  (`main.ts`, do té doby „Načítám partii…", žádný lokální `initialPosition()`),
- dokončený tah člověka pošle `POST /games/:id/moves` a desku nastaví na vrácený
  `GameDto` (`controller.ts` je nově async, `applyMove` z klientské cesty zmizel),
- tah enginu (bílý) zachytí polling `GET /games/:id` à 250 ms.

Nový modul `server-client.ts` je jediná síťová vrstva (typovaný `ServerClient`
nad `fetch`, `GameDto`/`ServerError`). `vite.config.ts` má proxy `/games` na
`127.0.0.1:3000`, takže klient volá relativní cesty (žádné CORS, žádná URL
natvrdo). `rules` v klientu zůstávají jen na zvýrazňování legálních tahů;
`selection.ts` je beze změny (`resolveMove` je nadále exportovaný a testovaný, ale
controller ho už nepoužívá – viz Otevřené).

## Ověření
- Lint čistý, typecheck všech balíčků, build web OK.
- Testy: web 48 (bylo 45 + 3 nové), server 39, engine 213, cli 24 – vše zelené.
- E2e (curl) proti reálnému serveru i přes Vite proxy: `POST /games` → `POST` tah
  člověka → `turn=white`/`engineStatus=thinking` → po ~2 s `turn=black`/`idle`
  (engine odpověděl). Kontrakt DTO i tělo `{from,path}` sedí. Procesy po sobě
  uklizené (žádný zombie engine, port 3000 uvolněn).

## Nezávislý self-review (red-team sub-agent)
Potvrdil, že single-flight zámek je těsný (busy se nastavuje synchronně před
prvním `await`), `busy` nemůže zůstat natrvalo `true` (finally s `busy=false`
před `render`), blokování výběru za engine funguje a přebalení síťové chyby
nemaskuje programovou chybu. Našel jeden reálný STŘEDNÍ nález, který jsem **opravil**:

- **Úspěšná odpověď se parsovala bez ochrany a bez kontroly tvaru.** Server (nebo
  špatně chytající proxy) mohl na `200` vrátit ne-JSON (`index.html`) → `SyntaxError`
  místo `ServerError`; nebo JSON jiného tvaru → `position=undefined` a pád `render()`
  na `TypeError` → **deska natrvalo rozbitá**. Přidán guard `parseGameDto` +
  lehký runtime guard tvaru `isGameDto` (ověří `position.board`/`turn`, `id`,
  `engineStatus`); cokoli mimo tvar se teď stane `ServerError`, který controller
  odchytí a dorovná. Kryto dvěma novými testy (200 s ne-JSON, 200 se špatným tvarem).

Přidán i test, že `engineStatus=error` z pollingu jen zaloguje a desku nezasekne.

## Otevřené / vědomě mimo rozsah (kandidáti do dalších fází M5)
- **Polling se nikdy nezastaví.** Běží dál i po konci partie a při nedostupném
  serveru (à 250 ms request, u výpadku navíc `console.error` donekonečna).
  Zastavení při `result !== 'ongoing'` souvisí se zobrazením konce hry, které je
  vědomě mimo rozsah této fáze. Návrh: utlumit poll, až se bude řešit konec hry /
  stavový řádek.
- **Klientský `GameDto` tvar serveru duplikuje** (web nezávisí na balíčku server).
  Runtime guard teď drift promění v `ServerError` místo tiché koruce, ale
  automatický kontraktní test proti reálnému `buildApp` chybí (nechtěl jsem vázat
  build graf web→server). Dnes tvar sedí přesně (ověřeno ručně i sub-agentem).
- **`resolveMove` v `selection.ts`** je po přechodu na server v produkci nevyužitý
  (controller posílá from+path přímo). Nechal jsem ho – je to čistý, testovaný
  helper a odstranění by zbytečně sáhlo do nesouvisejícího souboru + smazalo testy.
  Pokud vadí jako mrtvý kód, řekni a odstraním ho i s jeho testy.

## Trade-off fáze
Zvolen **neoptimistický** přístup: mezi kliknutím a přesunem kamene je jeden
round-trip serveru (na localhostu neznatelné, přes síť by drhlo). Optimistický
tah + mismatch resync a stavový řádek jsou vědomě odloženy do dalších fází.

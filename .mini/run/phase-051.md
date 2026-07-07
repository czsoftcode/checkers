---
phase: 51
verdict: done
steps:
  - title: "DTO + guard: humanColor ve webovém GameDto"
    status: done
  - title: "Controller: barva člověka per-partie"
    status: done
  - title: "Board-view: orientace desky podle barvy"
    status: done
  - title: "App-shell: hlášky, tlačítka a indikátor podle barvy"
    status: done
  - title: "Testy se zuby: perspektiva bílého (engine černý)"
    status: done
  - title: "Nezávislý sub-agent self-review"
    status: done
verify:
  - title: "Vizuální kontrola orientace desky pro člověk=bílý"
    detail: "Testy ověřují pořadí buněk v DOM (pole 1–4 nahoře, 29–32 dole), ale skutečné vykreslení (kameny dole = bílé, drag & drop, animace tahu na obrácené desce) jsem nespustil v prohlížeči. Bílá větev je dnes v produkci NEDOSAŽITELNÁ (klient barvu neposílá – to je fáze 52), takže vizuálně ji lze prověřit až po fázi 52, nebo dočasným natvrdo nastavením humanColor='white' v odpovědi serveru."
---

# Phase 51 — report z auto session

## Co se udělalo
Klient (balíček `packages/web`) je nově „color-aware" – reaguje na `humanColor` z `GameDto`:

1. **DTO + guard** (`server-client.ts`): přidáno volitelné `readonly humanColor?: Color`. Guard `isGameDto` je záměrně **asymetrický** vůči `ballotMoves`: chybějící/`undefined` barva PROJDE (zpětná kompatibilita, volající dosadí `'black'`), ale přítomná neplatná hodnota (ne `black`/`white`) se ODMÍTNE jako drift. Pokryto 3 novými testy.
2. **Controller** (`controller.ts`): modulový `const HUMAN_COLOR = 'black'` nahrazen per-partie `const humanColor = game.humanColor ?? 'black'`. Protaženo všech 9 míst (turn-checky výběru/dragu/hintu, `engineJustMoved` teď bere barvu parametrem, mapování `black-wins`/`white-wins` → zvuk výhra/prohra). Barva se předává do `createBoardView` kvůli orientaci.
3. **Board-view** (`board-view.ts`): `createBoardView` má 4. volitelný parametr `humanColor` (výchozí `'black'`). Otáčí se JEN pořadí appendu buněk do DOM (`seq` obrací řady i sloupce = rotace 180° pro černého; přirozené pořadí pro bílého). `data-square`, `.dark/.light`, klikání i drag hit-test se dál počítají z reálných souřadnic → žádný zrcadlový nesoulad.
4. **App-shell** (`app-shell.ts`): uloží `humanColor` z vráceného DTO PŘED vznikem controlleru (aby první `onState → render()` už četl správnou hodnotu). `terminalMessage` (výhra/prohra podle barvy), `offerDrawBtn` (`turn !== humanColor`), latch `firstMoveMade` (výchozí stav = člověk na tahu) odvozené z barvy. `updateTurnIndicator` se ZÁMĚRNĚ nemění – kámen ukazuje barvu strany na tahu, což je správně v obou orientacích.

## Ověření
- Typecheck (`tsc --noEmit`) i ESLint na `packages/web` čisté.
- Celá web sada zelená: **216 testů / 17 souborů**.
- **Zuby testů ověřeny**: dočasným rozbitím mapování výhry (natvrdo `'black-wins'`) padly 2 app-shell testy; dočasným rozbitím orientace (vypnutí otočení) padl orientační test. Po obnově vše zelené.
- **Nezávislý sub-agent** (čerstvý kontext, dle projektového CLAUDE.md – fáze sahá na kontrakt server↔klient a turn/chybové cesty): žádný blocker ani warning. Potvrdil korektnost guardu, orientace (bez zrcadlení), turn-checků i mapování a konzistenci controller↔app-shell (oba čtou stejný objekt `game`).

## Na co upozornit (cross-phase, MIMO tuto fázi)
- Bílá větev je dnes v produkci **nedosažitelná** – klient barvu na server NEposílá (to je fáze 52). Logika je „spící", správná konstrukcí a otestovaná přes DTO. Aktivuje se až fáze 52.
- Až fáze 52 začne posílat bílou, závisí na serveru, že u člověk=bílý sám spustí první tah enginu (černého) – jinak by člověk uvázl (nemůže táhnout, `turn='black'`). Dle watch-out fáze 50 to server už řeší (`maybeTriggerEngine` běží v `POST /games`), ale patří to ověřit v fázi 52.

## ADR
Žádná zásadní rozcestí k zaznamenání (`/mini:decision` netřeba). Jediná drobná volba – latch zamkne úroveň hned při založení partie s bílým člověkem – je vědomá a shodná s chováním Mistrovství, popsaná v komentáři u kódu.

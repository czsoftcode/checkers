---
phase: 7
verdict: done
steps:
  - title: "Funkce gameResult(position)"
    status: done
  - title: "Testy konce hry (brána fáze)"
    status: done
  - title: "Zelený workspace"
    status: done
---

# Phase 7 — report from the auto session

## Co vzniklo
- `packages/rules/src/result.ts` – `gameResult(position)`: `'ongoing' | 'black-wins' | 'white-wins'`. Hráč na tahu bez legálního tahu prohrává (vyhrává soupeř); staví na kontraktu „prázdné legalMoves = žádný tah" zafixovaném ve fázi 4. `legalMoves` se počítá interně – žádný volitelný parametr s předpočítanými tahy (rozhodnuto v plánu: pozvánka k nekonzistenci). Export z indexu.
- Testy (12 nových, celkem 191 v rules): prohra bez kamenů i se zablokovanými kameny (pat neexistuje – past GDD 2.7) pro OBĚ barvy; výchozí pozice ongoing; poškozená pozice vyhazuje RangeError. Navíc reálný tok partie přes applyMove: sebrání posledního kamene i zablokování soupeře tahem vede na pozici s výsledkem.
- Workspace zelený: typecheck, testy, lint.

## Self-review
Nezávislého sub-agenta jsem tentokrát NEpouštěl a říkám to na rovinu: fáze je ~10 řádků logiky nad už zreviewovaným kontraktem legalMoves, bez nových chybových cest (validace se dědí), bez vstupních bodů procesu a bez nového mezimodulového kontraktu. Checklist jsem prošel ručně: jediné riziko – prohození vítěze (strana na tahu bez tahu vyhrává místo prohrává) – shodí 6 testů s ručně postavenými pozicemi pro obě barvy; všechny tři návratové větve jsou testy dosažené.

## Unhappy path
Poškozená pozice (krátká deska, neplatný turn) vyhazuje RangeError zděděnou z legalMoves – testováno přímo na gameResult. Funkce je čistá, bez vedlejších efektů.

## Poznámka pro todo 8 (remízy)
gameResult vědomě neřeší remízy – trojí opakování a 80 půltahů potřebují historii/čítač NAD rámec Position. Todo 8 rozšíří výsledek o 'draw' na úrovni, která ten stav drží (pravděpodobně nový typ GameState nebo parametr), ne změnou Position.

---
phase: 4
verdict: done
steps:
  - title: "Generátor jednoduchých skoků"
    status: done
  - title: "legalMoves s povinností braní"
    status: done
  - title: "Zapouzdření stavebních bloků"
    status: done
  - title: "Explicitní test dočasného chování + zelený workspace"
    status: done
---

# Phase 4 — report from the auto session

## Co vzniklo
- `jumpMovesFrom` v `packages/rules/src/moves.ts`: jednoduchý skok přes soupeřův kámen na prázdné pole za ním (stejný index směru NEIGHBORS/JUMPS), muž bere jen vpřed, dáma všesměr; bere se i soupeřova dáma.
- `legalMoves(position)` – nové jediné veřejné API generátoru: existuje-li skok kterékoli figury strany na tahu, vrací jen skoky, jinak prosté tahy. Povinnost braní testovaná z obou stran (skok potlačí prostý tah téhož kamene i všech ostatních).
- Zapouzdření: `simpleMovesFrom`/`generateSimpleMoves`/`jumpMovesFrom` zmizely z indexu balíčku (testy je importují přímo z modulu). Zapouzdření drží dvěma vrstvami – index + `exports` mapa v package.json blokuje deep-import.
- Společná validace vstupu (`cellAt`): deska ≠ 32 polí, neplatné pole i neplatný `turn` vyhazují RangeError.
- Testy: 25 nových (celkem 143 v rules), včetně explicitně označeného DOČASNÉHO testu: skok končí po jednom braní; komentář uvádí přesné očekávání (9x18x27), které ho v todo [5] nahradí. Workspace zelený (typecheck, testy, lint).

## Nezávislý self-review (sub-agent, čerstvý kontext)
Recenzent přepočítal geometrii všech klíčových fixtures (sedí) a nadto ověřil zuby testů EMPIRICKY mutacemi: vypnutí povinnosti braní → 6 testů padlo; muž bere vzad → 1 test padl; přeskočení vlastního kamene → 2 testy padly. Žádný kritický ani střední nález. Nízké nálezy a co s nimi:
- **Nevalidovaný `turn` (opraveno):** pozice s `turn: "Black"` z JSON hranice by tiše vrátila „žádné tahy" = falešný konec hry. Přidána validace do `cellAt` + test na veřejném API.
- **Chybějící kotvy `legalMoves` pro konec hry (opraveno):** přidány testy – strana bez kamenů → `[]`, zcela zablokovaná strana → `[]`, poškozená pozice vyhazuje i přes `legalMoves`. „Prázdný seznam = žádný tah" je teď zafixovaný kontrakt pro detekci konce hry (todo [7]).
- **Past pro todo [5]/[6] (ošetřeno docem):** do komentáře `jumpMovesFrom` doplněna dvě pravidla, na která rekurze vícenásobného skoku nesmí zapomenout – kámen nelze přeskočit 2× a muž proměněný uprostřed skoku tahem KONČÍ.
- **Vědomě bez změny:** testy skoků porovnávají celé pole tahů, takže závisí na pořadí směrů NW→NE→SW→SE; legální refaktor pořadí by je rozbil. Je to vazba na implementační detail, ale záměrně deterministické pořadí generátoru se bude hodit enginu – nechávám.

Pozn.: recenzent při mutačním testu jednou sáhl na working tree přes git checkout; stav jsem po review nezávisle ověřil (git status/diff + 140 testů před mými opravami) – vše sedělo.

## Unhappy path
Poškozená deska (≠32), neplatné pole (0/33/1.5/NaN), neplatný `turn` → RangeError, testováno i na veřejném `legalMoves`. Strana bez kamenů / bez tahů → `[]` (zafixováno testem jako kontrakt). Skok přes kraj desky neexistuje (dopad mimo desku), obsazený dopad blokuje – testováno.

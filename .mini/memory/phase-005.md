# Phase 5 — Vícenásobný skok

**Goal:** Generátor skoků rekurzivně pokračuje z pole dopadu, dokud existuje další braní: větvení z jednoho dopadu vrací každou větev jako samostatný tah, stejný kámen nelze v sekvenci přeskočit dvakrát, volba kratší větve z rozcestí je legální (maximum braní se nevyžaduje), ale uprostřed větve skončit nejde. Brána: testy multi-skoků a větvení (GDD 2.7) + dočasný test z fáze 4 nahrazen očekáváním 9x18x27.

## Steps
- [done] Rekurzivní generátor skokových sekvencí
- [done] Nahrazení dočasného testu očekáváním 9x18x27
- [done] Testy větvení a volby kratší větve
- [done] Kruhový skok dámy a zákaz dvojího přeskočení
- [done] Kotvy a zelený workspace

## Auto-commit
- Phase 5: Vícenásobný skok

## Run report
---
phase: 5
verdict: done
steps:
  - title: "Rekurzivní generátor skokových sekvencí"
    status: done
  - title: "Nahrazení dočasného testu očekáváním 9x18x27"
    status: done
  - title: "Testy větvení a volby kratší větve"
    status: done
  - title: "Kruhový skok dámy a zákaz dvojího přeskočení"
    status: done
  - title: "Kotvy a zelený workspace"
    status: done
---

# Phase 5 — report from the auto session

## Co vzniklo
- Přepis `jumpMovesFrom` na rekurzi (`extendJumps`): DFS z pole dopadu nad pracovní kopií desky – skákající kámen se posouvá (origin se uvolní, kruhový návrat na `from` je legální), přeskočený kámen se hned odebírá (⇒ nejde přeskočit dvakrát). Tah se vydává JEN z listů rekurze: uprostřed větve skončit nejde, ale kratší větev z rozcestí je legální (maximum braní se nevyžaduje).
- Dočasný test z fáze 4 podle plánu NEJDŘÍV prokazatelně spadl (a jedině on), pak byl nahrazen očekáváním 9x18x27.
- Testy: trojskok 1x10x19x28, větvení z jednoho dopadu (2 samostatné tahy), kratší větev vedle delší, zákaz zastavení na pokračovatelném prefixu, kruh dámy (18→9→2→11→18 oběma směry, návrat na from, 4 braní bez duplicit), muž nebere vzad ani v sekvenci. Celkem 152 testů, workspace zelený.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Recenzent přepočítal všechny fixtures (sedí) a paritní argument (okamžité odebrání kamene = odebrání na konci tahu) ověřil dvěma cestami: matematicky (dopady mají od startu sudou paritu řady i sloupce, přeskočená pole lichou – množiny se nikdy nepotkají) a empiricky – napsal si do scratchpadu referenční implementaci s opačnou sémantikou a porovnal na 20 000 náhodných pozic: 0 neshod. Backtracking (párované push/pop, vracení kamene) potvrzen bez děr; výkon: hloubka rekurze ≤ počet soupeřových kamenů, žádná nekonečná rekurze.

Nálezy:
- **Střední – trefa (opraveno):** žádný test nechytal muže beroucího VZAD ve skokové větvi – mutace dávající muži dámské směry ve skocích by prošla všemi 149 testy. Přidány 2 fixtures: první skok muže vzad neexistuje (18x25 ano, 18x11 ne) a sekvence muže nepokračuje braním vzad z pole dopadu (9x18 končí, dáma by šla 18x11).
- **Nízká (ošetřeno):** komentář `cellAt` sliboval víc, než platilo – díra (undefined) v desce délky 32 na NEdotazovaném poli tiše degraduje (konzervativně = obsazeno). Komentář zpřesněn na skutečné chování a přidán test, že přes veřejné `legalMoves` díra vždy vyhodí RangeError (iteruje všech 32 polí). Řídké pole z JSON nevznikne.

## Unhappy path
Rekurze mutuje jen lokální kopii desky (výjimka uprostřed nerozbije vnější stav); poškozené pozice (délka, díra, turn) vyhazují na veřejném API RangeError – testováno. Terminace zaručena: každé zanoření odebere jeden soupeřův kámen, hloubka ≤ 12.

## Poznámka pro fázi proměny (todo 6)
Muž končící skokem na dámské řadě dnes končí přirozeně (nemá skok vpřed). Fáze proměny musí ohlídat, že se z něj v applyMove stane dáma a že tah NEPOKRAČUJE – doc poznámka u `jumpMovesFrom` na to upozorňuje.

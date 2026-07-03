---
phase: 3
verdict: done
steps:
  - title: "Výchozí pozice initialPosition()"
    status: done
  - title: "Prosté tahy muže (jen vpřed)"
    status: done
  - title: "Prosté tahy dámy (všesměr, o 1 pole)"
    status: done
  - title: "Kotva perft(1): přesně 7 tahů z výchozí pozice"
    status: done
  - title: "Export z indexu + zelený workspace"
    status: done
---

# Phase 3 — report from the auto session

## Co vzniklo
- `packages/rules/src/position.ts` – `initialPosition()`: černí muži 1-12, bílí 21-32, pole 13-20 prázdná, na tahu černý; každé volání vrací nezávislou pozici.
- `packages/rules/src/moves.ts` – `simpleMovesFrom(position, square)` a `generateSimpleMoves(position)`: muž jen vpřed (černý SW/SE, bílý NW/NE), dáma všemi 4 směry, obojí o právě 1 pole. Deska s jinou délkou než 32 a neplatné číslo pole vyhazují RangeError.
- Testy: 26 nových (celkem 118 v rules) – výchozí pozice po polích, zablokovaný muž (vlastním i soupeřovým kamenem, bez skoku), kraje desky, explicitní test proti dálkové dámě (přesná množina 4 tahů + negativní kontrola polí o 2 kroky dál), kotva perft(1) = přesná množina 7 tahů černého i bílého (ručně vypsané dvojice, ne počty). Typecheck, testy i lint celého workspace zelené.

## Nezávislý self-review (sub-agent, čerstvý kontext)
Recenzent nezávisle přepočítal geometrii tahů, obě sedmičkové kotvy i test dálkové dámy (potvrdil průkaznost) a ověřil, že testy padnou při prohození barev, směrů i při dálkové dámě. Nálezy:
- **Střední (opraveno):** krátká deska vyhazovala RangeError jen když dotaz padl ZA její konec; když cíl tahu padl dovnitř zkráceného pole, tahy tiše zmizely jako „obsazeno". Opraveno validací délky desky (=32) na vstupu simpleMovesFrom + 2 nové testy (krátká deska s dotazem uvnitř, dlouhá deska).
- **Nízká (ošetřeno docem):** `generateSimpleMoves` NENÍ generátor legálních tahů (chybí povinné braní) – kdokoli by se na něj teď napojil, po přidání braní by tiše nabízel nelegální tahy. Doplněno výrazné varování v doc-komentáři; veřejným API bude až `legalMoves` v další fázi.
- **Nízká (vědomě bez změny):** prázdné pole, soupeřův kámen i „strana bez kamenů" vrací shodně `[]` – pro detekci konce partie (fáze todo [7]) se to musí rozlišit tam, ne v generátoru.

## Poznámky pro další fáze
- Až vznikne povinné braní (todo [4]), zvážit zprivátnění/zapouzdření `generateSimpleMoves` pod `legalMoves`, ať nelegální cesta není lákavě po ruce.
- Validace délky desky běží v každém volání simpleMovesFrom (32× v generateSimpleMoves) – zanedbatelné teď, ale až tudy poteče perft/engine, stojí za to ji vytáhnout o úroveň výš.

## Unhappy path
Neplatné číslo pole (0, 33, 1.5, NaN) → RangeError; deska ≠ 32 polí (kratší i delší, dotaz uvnitř i vně) → RangeError; prázdné pole / soupeřův kámen / strana bez kamenů → prázdný seznam (zdokumentováno). Vše kryto testy.

/**
 * Golden testy POVINNÉHO MAXIMA braní (italská varianta,
 * `ITALIAN_RULESET.mustCaptureMaximum`).
 *
 * FID pravidlo 7 (KVANTITA): existuje-li víc braní, hráč MUSÍ zvolit to,
 * které bere NEJVÍC kamenů (metrika = počet braných polí; každý kámen = 1,
 * BEZ vážení dámy). Filtr žije v `legalMoves` (public gate) a je flag-vázaný
 * na `mustCaptureMaximum` – ostatní varianty ho nemají.
 *
 * ZUBY: tatáž pozice jako v (a) se pouští i s AMERICAN_RULESET (liší se právě
 * a jen absencí maxima) – tam se KRATŠÍ braní vrátí. To dokazuje, že kratší
 * skok reálně existuje a odstranil ho FILTR maxima, ne jeho absence, a že
 * americká varianta zůstala netknutá (flag-vázanost).
 *
 * POZOR – tato fáze (IT-3) řeší jen KVANTITU. Kvalitativní FID priorita
 * (dáma > muž, víc dam, pořadí braní) je IT-4 a NENÍ zde testovaná; proto
 * výstupem je MNOŽINA všech skoků s rovným maximem, ne jeden vybraný tah.
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position } from '../src/index.js';
import { AMERICAN_RULESET, ITALIAN_RULESET, legalMoves } from '../src/index.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };

/** Seřazená množina [odkud, kam] pro stabilní porovnání. */
function asPairs(moves: readonly Move[]): [number, number][] {
  return moves
    .map((m): [number, number] => [m.from, m.path[m.path.length - 1] ?? -1])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('ITALIAN mustCaptureMaximum – 3-braní vytlačí 2-braní', () => {
  // Černý muž na 5 bere rovně po SE diagonále přes 9, 18, 27 → 3 kameny
  // (5→14→23→32). Nezávislý černý muž na 4 bere přes 8, 16 → 2 kameny
  // (4→11→20). Řetězce jsou disjunktní (žádné sdílené pole ani bez větvení).
  const pos = positionWith(
    [
      [5, BLACK_MAN],
      [9, WHITE_MAN],
      [18, WHITE_MAN],
      [27, WHITE_MAN],
      [4, BLACK_MAN],
      [8, WHITE_MAN],
      [16, WHITE_MAN],
    ],
    'black',
  );

  it('s maximem: legalMoves vrátí JEN 3-braní, 2-braní CHYBÍ (adversariálně)', () => {
    expect(legalMoves(pos, ITALIAN_RULESET)).toEqual([
      { from: 5, path: [14, 23, 32], captures: [9, 18, 27] },
    ]);
  });

  it('zuby: AMERICAN (bez maxima) vrátí OBĚ braní – 2-braní reálně existuje', () => {
    // Kratší braní 4→11→20 existuje; v italské ho odstranil filtr maxima,
    // ne jeho absence. Zároveň důkaz, že americká varianta je netknutá.
    expect(asPairs(legalMoves(pos, AMERICAN_RULESET))).toEqual([
      [4, 20],
      [5, 32],
    ]);
  });
});

describe('ITALIAN mustCaptureMaximum – více rovných maxim zůstane (množina)', () => {
  // Dvě disjunktní 3-braní: muž 1 (1→10→19→28, bere 6,15,24) a muž 5
  // (5→14→23→32, bere 9,18,27). Obě mají rovné maximum → OBĚ musí zůstat;
  // filtr NEsmí vybrat jen jedno.
  const pos = positionWith(
    [
      [1, BLACK_MAN],
      [6, WHITE_MAN],
      [15, WHITE_MAN],
      [24, WHITE_MAN],
      [5, BLACK_MAN],
      [9, WHITE_MAN],
      [18, WHITE_MAN],
      [27, WHITE_MAN],
    ],
    'black',
  );

  it('legalMoves zachová OBĚ 3-braní (rovné maximum = množina, ne jeden tah)', () => {
    expect(legalMoves(pos, ITALIAN_RULESET)).toEqual([
      { from: 1, path: [10, 19, 28], captures: [6, 15, 24] },
      { from: 5, path: [14, 23, 32], captures: [9, 18, 27] },
    ]);
  });
});

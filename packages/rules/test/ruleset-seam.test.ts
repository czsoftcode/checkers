import { describe, expect, it } from 'vitest';

import { AMERICAN_RULESET, type Cell, type Color, type Position, type Ruleset } from '../src/index.js';
// Stavební blok se z indexu záměrně neexportuje – test ho importuje přímo z modulu.
import { jumpMovesFrom, legalMoves } from '../src/moves.js';

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

/** Ne-výchozí varianta: muž smí brát i dozadu (jako ruská/česká dáma). */
const BACKWARD_CAPTURE: Ruleset = {
  manCaptureBackward: true,
  king: 'short',
  promoteMidCapture: false,
  kingCapturePriority: false,
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
};

describe('Ruleset seam – braní muže dozadu', () => {
  // Bílý na 14 je SEVERNĚ (za zády) od černého muže na 18 – braní vzad.
  const backwardScenario = positionWith(
    [
      [18, BLACK_MAN],
      [14, WHITE_MAN],
    ],
    'black',
  );

  it('AMERICAN (default): muž vzad nebere', () => {
    expect(jumpMovesFrom(backwardScenario, 18)).toEqual([]);
    // A default parametru se opravdu chová jako AMERICAN.
    expect(jumpMovesFrom(backwardScenario, 18, AMERICAN_RULESET)).toEqual([]);
  });

  it('manCaptureBackward:true: muž bere i dozadu (z 18 přes 14 na 9)', () => {
    expect(jumpMovesFrom(backwardScenario, 18, BACKWARD_CAPTURE)).toEqual([
      { from: 18, path: [9], captures: [14] },
    ]);
  });

  it('seam prochází i přes legalMoves (povinnost braní ho zviditelní)', () => {
    // S AMERICAN žádný skok neexistuje → vrací se prostý tah muže vpřed.
    const americanMoves = legalMoves(backwardScenario);
    expect(americanMoves.every((m) => m.captures.length === 0)).toBe(true);
    // S braním vzad je skok povinný → legalMoves vrací jen ten skok.
    expect(legalMoves(backwardScenario, BACKWARD_CAPTURE)).toEqual([
      { from: 18, path: [9], captures: [14] },
    ]);
  });

  it('braní vpřed zůstává v obou variantách stejné', () => {
    // Bílý na 14 je JIŽNĚ (vpřed) od černého muže na 10 – bere se vždy.
    const forwardScenario = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
      ],
      'black',
    );
    const expected = [{ from: 10, path: [17], captures: [14] }];
    expect(jumpMovesFrom(forwardScenario, 10, AMERICAN_RULESET)).toEqual(expected);
    expect(jumpMovesFrom(forwardScenario, 10, BACKWARD_CAPTURE)).toEqual(expected);
  });
});

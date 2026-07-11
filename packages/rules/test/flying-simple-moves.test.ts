import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position, Ruleset } from '../src/index.js';
import { AMERICAN_RULESET } from '../src/index.js';
// Stavební bloky se z indexu záměrně neexportují – test je bere přímo z modulu.
import { generateSimpleMoves, legalMoves, simpleMovesFrom } from '../src/moves.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

/** Cílová pole prostých tahů, seřazená pro porovnání množin. */
function targets(moves: readonly Move[]): number[] {
  return moves.map((m) => m.path[0] ?? -1).sort((a, b) => a - b);
}

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };
const BLACK_KING: Cell = { color: 'black', kind: 'king' };

/** Létavá varianta (ruská/česká/pool) – jen dosah dámy, braní muže neřeší. */
const FLYING: Ruleset = { manCaptureBackward: false, king: 'flying', promoteMidCapture: false };

describe('simpleMovesFrom – létavá dáma (klouzání)', () => {
  it('na prázdné desce klouže po všech 4 diagonálách až k okraji', () => {
    const position = positionWith([[18, BLACK_KING]], 'black');
    expect(targets(simpleMovesFrom(position, 18, FLYING))).toEqual(
      [4, 5, 8, 9, 11, 14, 15, 22, 23, 25, 27, 29, 32],
    );
    // Každý tah je prostý: jeden dopad, žádné braní.
    for (const move of simpleMovesFrom(position, 18, FLYING)) {
      expect(move.path).toHaveLength(1);
      expect(move.captures).toEqual([]);
    }
  });

  it('vlastní kámen zastaví klouzání PŘED sebou (nedopadne na něj)', () => {
    // Černý muž na 9 leží na NW paprsku (14, 9, 5) – dáma dojede jen na 14.
    const position = positionWith(
      [
        [18, BLACK_KING],
        [9, BLACK_MAN],
      ],
      'black',
    );
    const nw = targets(simpleMovesFrom(position, 18, FLYING)).filter((s) => [14, 9, 5].includes(s));
    expect(nw).toEqual([14]);
  });

  it('cizí kámen zastaví klouzání také PŘED sebou (prostý tah přes něj neexistuje – to je skok)', () => {
    // Bílý muž na 11 leží na NE paprsku (15, 11, 8, 4) – dáma dojede jen na 15.
    const position = positionWith(
      [
        [18, BLACK_KING],
        [11, WHITE_MAN],
      ],
      'black',
    );
    const ne = targets(simpleMovesFrom(position, 18, FLYING)).filter((s) => [15, 11, 8, 4].includes(s));
    expect(ne).toEqual([15]);
  });

  it('okraj desky ukončí paprsek (dáma v rohu 29 klouže jen po jediné diagonále)', () => {
    const position = positionWith([[29, BLACK_KING]], 'black');
    // Z rohu 29 vede dovnitř jen NE: 25, 22, 18, 15, 11, 8, 4.
    expect(targets(simpleMovesFrom(position, 29, FLYING))).toEqual([4, 8, 11, 15, 18, 22, 25]);
  });

  it("king:'short' (default AMERICAN) klouzavou dámu NEudělá – jen o 1 pole", () => {
    const position = positionWith([[18, BLACK_KING]], 'black');
    expect(targets(simpleMovesFrom(position, 18))).toEqual([14, 15, 22, 23]);
    expect(targets(simpleMovesFrom(position, 18, AMERICAN_RULESET))).toEqual([14, 15, 22, 23]);
  });

  it('muž ve flying variantě zůstává krátký (klouže jen dáma)', () => {
    const position = positionWith([[10, BLACK_MAN]], 'black');
    expect(targets(simpleMovesFrom(position, 10, FLYING))).toEqual([14, 15]);
  });
});

describe('legalMoves / generateSimpleMoves – flying protažení', () => {
  it('legalMoves předá ruleset dál: bez skoku vrací klouzavé tahy dámy', () => {
    const position = positionWith([[18, BLACK_KING]], 'black');
    expect(targets(legalMoves(position, FLYING))).toEqual(
      [4, 5, 8, 9, 11, 14, 15, 22, 23, 25, 27, 29, 32],
    );
  });

  it('generateSimpleMoves protáhne ruleset až do simpleMovesFrom', () => {
    const position = positionWith([[18, BLACK_KING]], 'black');
    expect(targets(generateSimpleMoves(position, FLYING))).toEqual(
      [4, 5, 8, 9, 11, 14, 15, 22, 23, 25, 27, 29, 32],
    );
    // A default (short) tam nechá jen krok o 1.
    expect(targets(generateSimpleMoves(position))).toEqual([14, 15, 22, 23]);
  });

  it('povinnost braní má přednost i u létavé dámy (skok existuje → žádný klouzavý tah)', () => {
    // Bílý muž na 23 stojí těsně u dámy, za ním prázdné 27 → skok je povinný.
    const position = positionWith(
      [
        [18, BLACK_KING],
        [23, WHITE_MAN],
      ],
      'black',
    );
    const moves = legalMoves(position, FLYING);
    expect(moves.every((m) => m.captures.length > 0)).toBe(true);
  });
});

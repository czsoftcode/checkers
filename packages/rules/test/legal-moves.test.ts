import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position } from '../src/index.js';
import { initialPosition, legalMoves } from '../src/index.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

/** Převede tahy na dvojice [odkud, kam] seřazené pro porovnání množin. */
function asPairs(moves: readonly Move[]): [number, number][] {
  return moves
    .map((m): [number, number] => [m.from, m.path[0] ?? -1])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };
const BLACK_KING: Cell = { color: 'black', kind: 'king' };

describe('legalMoves – povinnost braní', () => {
  it('kámen se skokem i prostým tahem smí jen skákat', () => {
    // Černý muž na 10: prostý tah na 14 je volný, ale přes 15 se dá skočit.
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    expect(legalMoves(position)).toEqual([{ from: 10, path: [19], captures: [15] }]);
  });

  it('skok jednoho kamene zakáže prosté tahy všech ostatních', () => {
    // Muž na 12 má volné prosté tahy, ale muž na 10 může brát → 12 nesmí táhnout.
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [12, BLACK_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    const moves = legalMoves(position);
    expect(moves).toEqual([{ from: 10, path: [19], captures: [15] }]);
    expect(moves.some((m) => m.from === 12)).toBe(false);
  });

  it('má-li skok víc figur, vrací se skoky všech', () => {
    // Bílého muže na 15 mohou brát muž z 10 (dopad 19) i dáma z 18 (dopad 11).
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [18, BLACK_KING],
        [15, WHITE_MAN],
      ],
      'black',
    );
    expect(asPairs(legalMoves(position))).toEqual([
      [10, 19],
      [18, 11],
    ]);
  });

  it('každý vrácený skok má neprázdné captures, prosté tahy se nemíchají', () => {
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [12, BLACK_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    for (const move of legalMoves(position)) {
      expect(move.captures.length).toBeGreaterThan(0);
    }
  });

  it('bez skoků vrací prosté tahy (výchozí pozice = 7 tahů, kotva perft(1))', () => {
    expect(asPairs(legalMoves(initialPosition()))).toEqual([
      [9, 13],
      [9, 14],
      [10, 14],
      [10, 15],
      [11, 15],
      [11, 16],
      [12, 16],
    ]);
  });

  it('povinnost braní platí i pro bílého', () => {
    // Bílý muž na 18: prostý tah na 15 je volný, ale přes 14 se dá skočit na 9.
    const position = positionWith(
      [
        [18, WHITE_MAN],
        [14, BLACK_MAN],
      ],
      'white',
    );
    expect(legalMoves(position)).toEqual([{ from: 18, path: [9], captures: [14] }]);
  });
});

describe('legalMoves – okraje kontraktu', () => {
  it('strana bez kamenů vrací prázdný seznam (budoucí kontrakt pro konec hry)', () => {
    const position = positionWith([[10, WHITE_MAN]], 'black');
    expect(legalMoves(position)).toEqual([]);
  });

  it('zcela zablokovaná strana vrací prázdný seznam', () => {
    // Černí muži zaklínění o sebe v dolním rohu: 21 blokuje vlastní 25,
    // 25 blokují vlastní 29 a 30, muži na poslední řadě nemají kam vpřed.
    // Vlastní kámen se přeskočit nedá a jediný bílý je daleko na 1.
    const blocked = positionWith(
      [
        [21, BLACK_MAN],
        [25, BLACK_MAN],
        [29, BLACK_MAN],
        [30, BLACK_MAN],
        [1, WHITE_MAN],
      ],
      'black',
    );
    expect(legalMoves(blocked)).toEqual([]);
  });

  it('poškozená pozice vyhazuje RangeError i na veřejném API', () => {
    const shortBoard: Position = { board: new Array<Cell>(18).fill(null), turn: 'black' };
    expect(() => legalMoves(shortBoard)).toThrow(RangeError);
    const badTurn = { board: new Array<Cell>(32).fill(null), turn: 'Black' } as unknown as Position;
    expect(() => legalMoves(badTurn)).toThrow(RangeError);
  });

  it('díra (undefined) v desce délky 32 vyhazuje přes legalMoves RangeError', () => {
    const board = new Array<Cell>(32).fill(null);
    (board as (Cell | undefined)[])[9] = undefined;
    const sparse = { board, turn: 'black' } as Position;
    expect(() => legalMoves(sparse)).toThrow(RangeError);
  });
});

describe('legalMoves – vícenásobný skok', () => {
  it('9x18x27: skok pokračuje z dopadu, uprostřed sekvence skončit nejde', () => {
    // Nahrazuje DOČASNÝ test z fáze 4: černý muž na 9 bere přes 14 na 18
    // a odtud POVINNĚ dál přes 23 na 27. Samotné 9x18 legální není.
    const position = positionWith(
      [
        [9, BLACK_MAN],
        [14, WHITE_MAN],
        [23, WHITE_MAN],
      ],
      'black',
    );
    expect(legalMoves(position)).toEqual([{ from: 9, path: [18, 27], captures: [14, 23] }]);
  });

  it('trojskok muže: 1x10x19x28', () => {
    const position = positionWith(
      [
        [1, BLACK_MAN],
        [6, WHITE_MAN],
        [15, WHITE_MAN],
        [24, WHITE_MAN],
      ],
      'black',
    );
    expect(legalMoves(position)).toEqual([
      { from: 1, path: [10, 19, 28], captures: [6, 15, 24] },
    ]);
  });
});

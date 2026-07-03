import { describe, expect, it } from 'vitest';

import type { Cell, Color, Position } from '../src/index.js';
// Stavební blok se z indexu záměrně neexportuje – test ho importuje přímo z modulu.
import { jumpMovesFrom } from '../src/moves.js';

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
const BLACK_KING: Cell = { color: 'black', kind: 'king' };
const WHITE_KING: Cell = { color: 'white', kind: 'king' };

describe('jumpMovesFrom – muž', () => {
  it('černý muž na 10 skáče přes bílého na 14 s dopadem na 17 (diagram v coords.test.ts)', () => {
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(position, 10)).toEqual([{ from: 10, path: [17], captures: [14] }]);
  });

  it('bere se i soupeřova dáma', () => {
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [15, WHITE_KING],
      ],
      'black',
    );
    expect(jumpMovesFrom(position, 10)).toEqual([{ from: 10, path: [19], captures: [15] }]);
  });

  it('vlastní kámen přeskočit nelze', () => {
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [14, BLACK_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(position, 10)).toEqual([]);
  });

  it('obsazený dopad skok blokuje (vlastním i soupeřovým kamenem)', () => {
    const own = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
        [17, BLACK_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(own, 10)).toEqual([]);
    const enemy = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
        [17, WHITE_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(enemy, 10)).toEqual([]);
  });

  it('skok přes kraj desky neexistuje (dopad mimo desku)', () => {
    // Černý muž na 1: SW dopad je mimo desku (JUMPS[1] = [null,null,null,10]),
    // takže soupeř na 5 se přeskočit nedá; přes 6 na 10 ano.
    const position = positionWith(
      [
        [1, BLACK_MAN],
        [5, WHITE_MAN],
        [6, WHITE_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(position, 1)).toEqual([{ from: 1, path: [10], captures: [6] }]);
  });

  it('muž NEbere vzad', () => {
    // Bílý na 14 je za černým mužem na 18 (severně) – černý muž vzad nebere.
    const position = positionWith(
      [
        [18, BLACK_MAN],
        [14, WHITE_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(position, 18)).toEqual([]);
  });

  it('muž bere oběma směry vpřed najednou', () => {
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(position, 10)).toEqual([
      { from: 10, path: [17], captures: [14] },
      { from: 10, path: [19], captures: [15] },
    ]);
  });
});

describe('jumpMovesFrom – dáma', () => {
  it('dáma bere i vzad (na rozdíl od muže)', () => {
    const position = positionWith(
      [
        [18, BLACK_KING],
        [14, WHITE_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(position, 18)).toEqual([{ from: 18, path: [9], captures: [14] }]);
  });

  it('dáma bere všemi 4 směry najednou', () => {
    const position = positionWith(
      [
        [18, BLACK_KING],
        [14, WHITE_MAN],
        [15, WHITE_MAN],
        [22, WHITE_MAN],
        [23, WHITE_MAN],
      ],
      'black',
    );
    expect(jumpMovesFrom(position, 18)).toEqual([
      { from: 18, path: [9], captures: [14] },
      { from: 18, path: [11], captures: [15] },
      { from: 18, path: [25], captures: [22] },
      { from: 18, path: [27], captures: [23] },
    ]);
  });
});

describe('jumpMovesFrom – okraje kontraktu', () => {
  it('prázdné pole a soupeřův kámen vrací prázdný seznam', () => {
    const position = positionWith([[10, WHITE_MAN]], 'black');
    expect(jumpMovesFrom(position, 15)).toEqual([]);
    expect(jumpMovesFrom(position, 10)).toEqual([]);
  });

  it.each([0, 33, 1.5, Number.NaN])('neplatné číslo pole %s vyhazuje RangeError', (square) => {
    const position = positionWith([[10, BLACK_MAN]], 'black');
    expect(() => jumpMovesFrom(position, square)).toThrow(RangeError);
  });

  it('deska s jinou délkou než 32 vyhazuje RangeError', () => {
    const broken: Position = { board: new Array<Cell>(18).fill(null), turn: 'black' };
    expect(() => jumpMovesFrom(broken, 10)).toThrow(RangeError);
  });
});

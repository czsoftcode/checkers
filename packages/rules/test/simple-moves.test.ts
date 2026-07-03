import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position } from '../src/index.js';
import { initialPosition } from '../src/index.js';
// Stavební bloky se z indexu záměrně neexportují (ignorují povinnost braní) –
// testy je importují přímo z modulu.
import { generateSimpleMoves, simpleMovesFrom } from '../src/moves.js';

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
const WHITE_KING: Cell = { color: 'white', kind: 'king' };

describe('simpleMovesFrom – muž', () => {
  it('černý muž na 10 táhne vpřed na 14 a 15 (diagram v coords.test.ts)', () => {
    const position = positionWith([[10, BLACK_MAN]], 'black');
    expect(asPairs(simpleMovesFrom(position, 10))).toEqual([
      [10, 14],
      [10, 15],
    ]);
  });

  it('bílý muž na 23 táhne vpřed (k nižším číslům) na 18 a 19', () => {
    const position = positionWith([[23, WHITE_MAN]], 'white');
    expect(asPairs(simpleMovesFrom(position, 23))).toEqual([
      [23, 18],
      [23, 19],
    ]);
  });

  it('muž netáhne vzad: černý muž na 14 nenabízí 9 ani 10', () => {
    const position = positionWith([[14, BLACK_MAN]], 'black');
    expect(asPairs(simpleMovesFrom(position, 14))).toEqual([
      [14, 17],
      [14, 18],
    ]);
  });

  it('vlastní kámen blokuje cíl', () => {
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [14, BLACK_MAN],
      ],
      'black',
    );
    expect(asPairs(simpleMovesFrom(position, 10))).toEqual([[10, 15]]);
  });

  it('soupeřův kámen blokuje cíl a NEgeneruje se skok přes něj', () => {
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    const moves = simpleMovesFrom(position, 10);
    expect(asPairs(moves)).toEqual([[10, 14]]);
    // Dopad případného skoku přes 15 by byl na 19 – prostý generátor ho nesmí nabídnout.
    expect(asPairs(moves)).not.toContainEqual([10, 19]);
  });

  it('muž na kraji desky má jen tahy dovnitř', () => {
    const black = positionWith([[12, BLACK_MAN]], 'black');
    expect(asPairs(simpleMovesFrom(black, 12))).toEqual([[12, 16]]);
    const white = positionWith([[5, WHITE_MAN]], 'white');
    expect(asPairs(simpleMovesFrom(white, 5))).toEqual([[5, 1]]);
  });

  it('muž bez tahu vrací prázdné pole (černý muž na 32, vpřed je jen okraj)', () => {
    const position = positionWith([[32, BLACK_MAN]], 'black');
    expect(simpleMovesFrom(position, 32)).toEqual([]);
  });

  it('tah má vždy jeden prvek v path a prázdné captures', () => {
    const position = positionWith([[10, BLACK_MAN]], 'black');
    for (const move of simpleMovesFrom(position, 10)) {
      expect(move.path).toHaveLength(1);
      expect(move.captures).toEqual([]);
    }
  });
});

describe('simpleMovesFrom – dáma', () => {
  it('dáma na 18 táhne všemi 4 směry o jedno pole', () => {
    const position = positionWith([[18, BLACK_KING]], 'black');
    expect(asPairs(simpleMovesFrom(position, 18))).toEqual([
      [18, 14],
      [18, 15],
      [18, 22],
      [18, 23],
    ]);
  });

  it('dáma NENÍ dálková: na prázdné desce nenabízí pole vzdálená 2 diagonální kroky', () => {
    const position = positionWith([[18, BLACK_KING]], 'black');
    const pairs = asPairs(simpleMovesFrom(position, 18));
    // Pole o 2 kroky dál po týchž diagonálách (9, 11, 25, 27) by nabídla jen dálková dáma.
    for (const tooFar of [9, 11, 25, 27]) {
      expect(pairs).not.toContainEqual([18, tooFar]);
    }
    expect(pairs).toHaveLength(4);
  });

  it('bílá dáma táhne i vzad (na rozdíl od muže)', () => {
    const position = positionWith([[18, WHITE_KING]], 'white');
    expect(asPairs(simpleMovesFrom(position, 18))).toEqual([
      [18, 14],
      [18, 15],
      [18, 22],
      [18, 23],
    ]);
  });

  it('dáma v rohu 29 má jediný tah na 25', () => {
    const position = positionWith([[29, WHITE_KING]], 'white');
    expect(asPairs(simpleMovesFrom(position, 29))).toEqual([[29, 25]]);
  });

  it('zablokovaná dáma nemá žádný tah', () => {
    const position = positionWith(
      [
        [18, BLACK_KING],
        [14, BLACK_MAN],
        [15, WHITE_MAN],
        [22, WHITE_MAN],
        [23, BLACK_MAN],
      ],
      'black',
    );
    expect(simpleMovesFrom(position, 18)).toEqual([]);
  });
});

describe('simpleMovesFrom – okraje kontraktu', () => {
  it('prázdné pole a soupeřův kámen vrací prázdný seznam', () => {
    const position = positionWith([[10, WHITE_MAN]], 'black');
    expect(simpleMovesFrom(position, 15)).toEqual([]);
    expect(simpleMovesFrom(position, 10)).toEqual([]);
  });

  it.each([0, 33, 1.5, Number.NaN])(
    'neplatné číslo pole %s vyhazuje RangeError',
    (square) => {
      const position = initialPosition();
      expect(() => simpleMovesFrom(position, square)).toThrow(RangeError);
    },
  );

  it('deska kratší než 32 polí vyhazuje RangeError, nevrací tiše nic', () => {
    const broken: Position = { board: [null, null, null], turn: 'black' };
    expect(() => simpleMovesFrom(broken, 10)).toThrow(RangeError);
  });

  it('krátká deska vyhazuje i pro pole UVNITŘ zkráceného rozsahu (cíle tahu by tiše zmizely)', () => {
    const board: Cell[] = new Array<Cell>(18).fill(null);
    board[16 - 1] = BLACK_MAN;
    const broken: Position = { board, turn: 'black' };
    expect(() => simpleMovesFrom(broken, 16)).toThrow(RangeError);
  });

  it('deska delší než 32 polí vyhazuje RangeError', () => {
    const broken: Position = { board: new Array<Cell>(33).fill(null), turn: 'black' };
    expect(() => simpleMovesFrom(broken, 10)).toThrow(RangeError);
  });
});

describe('generateSimpleMoves – kotva perft(1)', () => {
  it('z výchozí pozice má černý přesně těchto 7 tahů', () => {
    expect(asPairs(generateSimpleMoves(initialPosition()))).toEqual([
      [9, 13],
      [9, 14],
      [10, 14],
      [10, 15],
      [11, 15],
      [11, 16],
      [12, 16],
    ]);
  });

  it('z výchozího rozestavění s bílým na tahu má bílý přesně těchto 7 tahů', () => {
    const position: Position = { ...initialPosition(), turn: 'white' };
    expect(asPairs(generateSimpleMoves(position))).toEqual([
      [21, 17],
      [22, 17],
      [22, 18],
      [23, 18],
      [23, 19],
      [24, 19],
      [24, 20],
    ]);
  });
});

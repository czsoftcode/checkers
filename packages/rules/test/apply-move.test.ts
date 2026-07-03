import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position } from '../src/index.js';
import { applyMove, initialPosition, legalMoves } from '../src/index.js';

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

describe('applyMove – prostý tah a jednoduchý skok', () => {
  it('prostý tah přesune kámen a přepne stranu na tahu', () => {
    const before = positionWith([[10, BLACK_MAN]], 'black');
    const after = applyMove(before, { from: 10, path: [14], captures: [] });
    expect(after.board[10 - 1]).toBeNull();
    expect(after.board[14 - 1]).toEqual(BLACK_MAN);
    expect(after.turn).toBe('white');
  });

  it('jednoduchý skok odebere přeskočený kámen', () => {
    const before = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
      ],
      'black',
    );
    const after = applyMove(before, { from: 10, path: [17], captures: [14] });
    expect(after.board[10 - 1]).toBeNull();
    expect(after.board[14 - 1]).toBeNull();
    expect(after.board[17 - 1]).toEqual(BLACK_MAN);
    expect(after.turn).toBe('white');
  });

  it('vstupní pozice zůstane netknutá (imutabilita)', () => {
    const before = positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
      ],
      'black',
    );
    const snapshot = JSON.parse(JSON.stringify(before)) as Position;
    applyMove(before, { from: 10, path: [17], captures: [14] });
    expect(before).toEqual(snapshot);
  });
});

describe('applyMove – vícenásobný a kruhový skok', () => {
  it('trojskok 1x10x19x28 odebere všechny tři kameny', () => {
    const before = positionWith(
      [
        [1, BLACK_MAN],
        [6, WHITE_MAN],
        [15, WHITE_MAN],
        [24, WHITE_MAN],
      ],
      'black',
    );
    const after = applyMove(before, { from: 1, path: [10, 19, 28], captures: [6, 15, 24] });
    for (const square of [1, 6, 15, 24, 10, 19]) {
      expect(after.board[square - 1], `pole ${String(square)}`).toBeNull();
    }
    expect(after.board[28 - 1]).toEqual(BLACK_MAN);
    expect(after.turn).toBe('white');
  });

  it('kruhový skok dámy s návratem na from: dáma zůstane na 18, čtyři bílí pryč', () => {
    const before = positionWith(
      [
        [18, BLACK_KING],
        [6, WHITE_MAN],
        [7, WHITE_MAN],
        [14, WHITE_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    const after = applyMove(before, { from: 18, path: [9, 2, 11, 18], captures: [14, 6, 7, 15] });
    expect(after.board[18 - 1]).toEqual(BLACK_KING);
    for (const square of [6, 7, 14, 15, 9, 2, 11]) {
      expect(after.board[square - 1], `pole ${String(square)}`).toBeNull();
    }
    expect(after.turn).toBe('white');
  });
});

describe('applyMove – strukturální validace', () => {
  const base = () =>
    positionWith(
      [
        [10, BLACK_MAN],
        [14, WHITE_MAN],
      ],
      'black',
    );

  it.each<[string, Move]>([
    ['prázdná path', { from: 10, path: [], captures: [] }],
    ['prostý tah s více dopady', { from: 10, path: [14, 17], captures: [] }],
    ['nesedící počty braní a dopadů', { from: 10, path: [17, 26], captures: [14] }],
    ['obsazený dopad', { from: 10, path: [14], captures: [] }],
    ['teleport (cíl nesousedí)', { from: 10, path: [26], captures: [] }],
    ['skok s špatným braným polem', { from: 10, path: [17], captures: [15] }],
    ['dopad mimo desku', { from: 10, path: [33], captures: [] }],
  ])('odmítne: %s', (_label, move) => {
    expect(() => applyMove(base(), move)).toThrow(RangeError);
  });

  it('odmítne tah z prázdného pole i ze soupeřova kamene', () => {
    expect(() => applyMove(base(), { from: 15, path: [19], captures: [] })).toThrow(RangeError);
    expect(() => applyMove(base(), { from: 14, path: [17], captures: [] })).toThrow(RangeError);
  });

  it('odmítne braní prázdného pole a vlastního kamene', () => {
    const emptyCapture = positionWith([[10, BLACK_MAN]], 'black');
    expect(() =>
      applyMove(emptyCapture, { from: 10, path: [17], captures: [14] }),
    ).toThrow(RangeError);
    const ownCapture = positionWith(
      [
        [10, BLACK_MAN],
        [14, BLACK_MAN],
      ],
      'black',
    );
    expect(() => applyMove(ownCapture, { from: 10, path: [17], captures: [14] })).toThrow(
      RangeError,
    );
  });

  it('odmítne duplicitní captures', () => {
    const position = positionWith(
      [
        [18, BLACK_KING],
        [14, WHITE_MAN],
      ],
      'black',
    );
    expect(() =>
      applyMove(position, { from: 18, path: [9, 18], captures: [14, 14] }),
    ).toThrow(RangeError);
  });

  it('chybová zpráva pojmenuje konkrétní problém (dopad mimo desku)', () => {
    expect(() => applyMove(base(), { from: 10, path: [33], captures: [] })).toThrow(
      /není na desce/,
    );
  });

  it('neúspěšná aplikace nechá vstupní pozici netknutou', () => {
    const before = base();
    const snapshot = JSON.parse(JSON.stringify(before)) as Position;
    expect(() => applyMove(before, { from: 10, path: [14], captures: [] })).toThrow(RangeError);
    expect(before).toEqual(snapshot);
  });

  it('kontrakt: prostý tah muže VZAD strukturálně projde (legalitu drží legalMoves)', () => {
    // Kdyby applyMove někdy začal kontrolovat směr muže, tenhle test spadne
    // a kontrakt (server validuje členstvím v legalMoves) se musí přehodnotit vědomě.
    const position = positionWith([[14, BLACK_MAN]], 'black');
    const after = applyMove(position, { from: 14, path: [10], captures: [] });
    expect(after.board[10 - 1]).toEqual(BLACK_MAN);
  });

  it('plnou legalitu vědomě NEkontroluje: prostý tah projde i při existujícím skoku', () => {
    // Povinnost braní hlídá legalMoves (server validuje členstvím v seznamu);
    // applyMove strukturálně korektní prostý tah aplikuje.
    const position = positionWith(
      [
        [10, BLACK_MAN],
        [15, WHITE_MAN],
      ],
      'black',
    );
    const after = applyMove(position, { from: 10, path: [14], captures: [] });
    expect(after.board[14 - 1]).toEqual(BLACK_MAN);
  });
});

describe('applyMove – proměna', () => {
  it('černý muž končící prostým tahem na řadě 29-32 se stává dámou', () => {
    const before = positionWith([[26, BLACK_MAN]], 'black');
    const after = applyMove(before, { from: 26, path: [30], captures: [] });
    expect(after.board[30 - 1]).toEqual({ color: 'black', kind: 'king' });
  });

  it('bílý muž končící prostým tahem na řadě 1-4 se stává dámou', () => {
    const before = positionWith([[6, WHITE_MAN]], 'white');
    const after = applyMove(before, { from: 6, path: [1], captures: [] });
    expect(after.board[1 - 1]).toEqual({ color: 'white', kind: 'king' });
  });

  it('proměna skokem: muž doskočí na dámskou řadu a stává se dámou', () => {
    const before = positionWith(
      [
        [21, BLACK_MAN],
        [25, WHITE_MAN],
      ],
      'black',
    );
    const after = applyMove(before, { from: 21, path: [30], captures: [25] });
    expect(after.board[30 - 1]).toEqual({ color: 'black', kind: 'king' });
    expect(after.board[25 - 1]).toBeNull();
  });

  it('PAST (GDD 2.7): proměna uprostřed skoku ukončuje tah – end-to-end', () => {
    // Černý muž 21 bere přes 25 na 30 (dámská řada). Bílý na 26 stojí tak,
    // že DÁMA z 30 by ho brát mohla (30x23 přes 26) – ale tah proměnou končí.
    const before = positionWith(
      [
        [21, BLACK_MAN],
        [25, WHITE_MAN],
        [26, WHITE_MAN],
      ],
      'black',
    );
    // 1) Generátor tah ukončí na 30 a pokračování nenabízí.
    const moves = legalMoves(before);
    expect(moves).toEqual([{ from: 21, path: [30], captures: [25] }]);
    // 2) Po aplikaci: na 30 černá DÁMA, bílý na 26 přežil, na tahu bílý.
    const move = moves[0];
    expect(move).toBeDefined();
    if (move === undefined) {
      return;
    }
    const after = applyMove(before, move);
    expect(after.board[30 - 1]).toEqual({ color: 'black', kind: 'king' });
    expect(after.board[26 - 1]).toEqual(WHITE_MAN);
    expect(after.turn).toBe('white');
  });

  it('dáma končící na zadní řadě soupeře zůstává dámou (žádná dvojitá proměna)', () => {
    const before = positionWith([[26, BLACK_KING]], 'black');
    const after = applyMove(before, { from: 26, path: [30], captures: [] });
    expect(after.board[30 - 1]).toEqual(BLACK_KING);
  });

  it('bílá dáma na řadě černého zůstává dámou i po návratu', () => {
    const before = positionWith([[30, WHITE_KING]], 'white');
    const after = applyMove(before, { from: 30, path: [26], captures: [] });
    expect(after.board[26 - 1]).toEqual(WHITE_KING);
  });

  it('muž NEkončící na dámské řadě zůstává mužem', () => {
    const before = positionWith([[10, BLACK_MAN]], 'black');
    const after = applyMove(before, { from: 10, path: [14], captures: [] });
    expect(after.board[14 - 1]).toEqual(BLACK_MAN);
  });
});

describe('applyMove – konzistence s generátorem', () => {
  const scenarios: readonly (readonly [string, Position])[] = [
    ['výchozí pozice', initialPosition()],
    [
      'větvení multi-skoku',
      positionWith(
        [
          [9, BLACK_MAN],
          [14, WHITE_MAN],
          [22, WHITE_MAN],
          [23, WHITE_MAN],
        ],
        'black',
      ),
    ],
    [
      'kruh dámy',
      positionWith(
        [
          [18, BLACK_KING],
          [6, WHITE_MAN],
          [7, WHITE_MAN],
          [14, WHITE_MAN],
          [15, WHITE_MAN],
        ],
        'black',
      ),
    ],
    [
      'proměna skokem',
      positionWith(
        [
          [21, BLACK_MAN],
          [25, WHITE_MAN],
          [26, WHITE_MAN],
        ],
        'black',
      ),
    ],
  ];

  it.each(scenarios)('každý tah z legalMoves projde applyMove: %s', (_label, position) => {
    const moves = legalMoves(position);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      const after = applyMove(position, move);
      expect(after.turn).not.toBe(position.turn);
      expect(after.board).toHaveLength(32);
    }
  });
});

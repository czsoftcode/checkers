import { describe, expect, it } from 'vitest';

import type { Cell, Color, GameState, Position } from '../src/index.js';
import {
  MAX_PLIES_WITHOUT_PROGRESS,
  advanceState,
  gameResultFromState,
  initialGameState,
  initialPosition,
  legalMoves,
  positionKey,
} from '../src/index.js';

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

/**
 * Zahraje tah z `from` na `to` vybraný z legalMoves – testy tak nestaví
 * na ruční geometrii tahu, ale na skutečném generátoru.
 */
function play(state: GameState, from: number, to: number): GameState {
  const move = legalMoves(state.position).find(
    (m) => m.from === from && m.path[m.path.length - 1] === to,
  );
  if (move === undefined) {
    throw new Error(`Test čeká legální tah ${String(from)}->${String(to)}, ale žádný není`);
  }
  return advanceState(state, move);
}

describe('positionKey – deterministický klíč pozice', () => {
  it('stejná pozice dává stejný klíč', () => {
    expect(positionKey(initialPosition())).toBe(positionKey(initialPosition()));
  });

  it('jiná strana na tahu dává jiný klíč', () => {
    const position = initialPosition();
    expect(positionKey(position)).not.toBe(positionKey({ ...position, turn: 'white' }));
  });

  it('jiné rozestavění dává jiný klíč', () => {
    const a = positionWith([[18, BLACK_MAN]], 'black');
    const b = positionWith([[19, BLACK_MAN]], 'black');
    expect(positionKey(a)).not.toBe(positionKey(b));
  });

  it('muž a dáma na stejném poli dávají jiný klíč', () => {
    const man = positionWith([[18, BLACK_MAN]], 'black');
    const king = positionWith([[18, BLACK_KING]], 'black');
    expect(positionKey(man)).not.toBe(positionKey(king));
  });

  it('barva kamene mění klíč', () => {
    const black = positionWith([[18, BLACK_MAN]], 'black');
    const white = positionWith([[18, WHITE_MAN]], 'black');
    expect(positionKey(black)).not.toBe(positionKey(white));
  });

  it('poškozenou pozici odmítá RangeError', () => {
    const shortBoard: Position = { board: new Array<Cell>(18).fill(null), turn: 'black' };
    expect(() => positionKey(shortBoard)).toThrow(RangeError);
    const badTurn = { board: new Array<Cell>(32).fill(null), turn: 'x' } as unknown as Position;
    expect(() => positionKey(badTurn)).toThrow(RangeError);
  });

  it('díru v poli a nesmyslnou buňku odmítá RangeError (žádný tichý klíč)', () => {
    // Díra (řídké pole) – dvě různě poškozené desky nesmí sdílet klíč.
    const sparse = { board: new Array<Cell>(32), turn: 'black' } as unknown as Position;
    expect(() => positionKey(sparse)).toThrow(RangeError);
    const junkCell = positionWith(
      [[18, { color: 'red', kind: 'queen' } as unknown as Cell]],
      'black',
    );
    expect(() => positionKey(junkCell)).toThrow(RangeError);
  });
});

describe('initialGameState – výchozí stav partie', () => {
  it('čítač 0 a výchozí pozice jako 1. výskyt v historii', () => {
    const state = initialGameState();
    expect(state.position).toEqual(initialPosition());
    expect(state.pliesWithoutProgress).toBe(0);
    expect(state.repetitionHistory).toEqual([positionKey(initialPosition())]);
  });

  it('přijímá i zadanou pozici', () => {
    const position = positionWith([[18, BLACK_KING]], 'black');
    const state = initialGameState(position);
    expect(state.position).toBe(position);
    expect(state.repetitionHistory).toEqual([positionKey(position)]);
  });
});

describe('advanceState – čítač a historie', () => {
  it('prostý tah dámou zvedá čítač a prodlužuje historii', () => {
    const state = initialGameState(
      positionWith(
        [
          [1, BLACK_KING],
          [32, WHITE_KING],
        ],
        'black',
      ),
    );
    const next = play(state, 1, 5);
    expect(next.pliesWithoutProgress).toBe(1);
    expect(next.repetitionHistory).toHaveLength(2);
    expect(next.repetitionHistory[1]).toBe(positionKey(next.position));
  });

  it('tah mužem nuluje čítač a zahazuje historii', () => {
    const state: GameState = {
      ...initialGameState(),
      pliesWithoutProgress: 7,
      repetitionHistory: ['a', 'b', 'c'],
    };
    const next = play(state, 10, 14);
    expect(next.pliesWithoutProgress).toBe(0);
    expect(next.repetitionHistory).toEqual([positionKey(next.position)]);
  });

  it('braní dámou nuluje čítač a zahazuje historii', () => {
    // Braní dámou (ne mužem), aby reset prokazatelně způsobilo braní samo.
    const position = positionWith(
      [
        [14, BLACK_KING],
        [18, WHITE_MAN],
        [32, WHITE_KING],
      ],
      'black',
    );
    const base: GameState = {
      position,
      pliesWithoutProgress: 12,
      repetitionHistory: ['x', 'y', positionKey(position)],
    };
    const next = play(base, 14, 23);
    expect(next.pliesWithoutProgress).toBe(0);
    expect(next.repetitionHistory).toEqual([positionKey(next.position)]);
  });

  it('proměna je tah mužem – nuluje čítač', () => {
    const position = positionWith(
      [
        [26, BLACK_MAN],
        [1, WHITE_KING],
      ],
      'black',
    );
    const base: GameState = {
      position,
      pliesWithoutProgress: 5,
      repetitionHistory: [positionKey(position)],
    };
    const next = play(base, 26, 30);
    expect(next.position.board[30 - 1]).toEqual(BLACK_KING);
    expect(next.pliesWithoutProgress).toBe(0);
    expect(next.repetitionHistory).toHaveLength(1);
  });

  it('vstupní stav se nemutuje', () => {
    const state = initialGameState(
      positionWith(
        [
          [1, BLACK_KING],
          [32, WHITE_KING],
        ],
        'black',
      ),
    );
    const historyBefore = [...state.repetitionHistory];
    play(state, 1, 5);
    expect(state.pliesWithoutProgress).toBe(0);
    expect(state.repetitionHistory).toEqual(historyBefore);
  });

  it('strukturálně neplatný tah propaguje RangeError z applyMove', () => {
    const state = initialGameState();
    expect(() => advanceState(state, { from: 18, path: [15], captures: [] })).toThrow(RangeError);
    expect(() => advanceState(state, { from: 10, path: [], captures: [] })).toThrow(RangeError);
  });
});

describe('gameResultFromState – remíza 80 půltahů bez pokroku', () => {
  const kings = positionWith(
    [
      [1, BLACK_KING],
      [32, WHITE_KING],
    ],
    'black',
  );

  it('čítač těsně pod limitem je ongoing, dosažení limitu je remíza', () => {
    const below: GameState = {
      position: kings,
      pliesWithoutProgress: MAX_PLIES_WITHOUT_PROGRESS - 1,
      repetitionHistory: [positionKey(kings)],
    };
    expect(gameResultFromState(below)).toBe('ongoing');
    const next = play(below, 1, 5);
    expect(next.pliesWithoutProgress).toBe(MAX_PLIES_WITHOUT_PROGRESS);
    expect(gameResultFromState(next)).toBe('draw');
  });

  it('pokrok těsně před limitem remízu odvrací', () => {
    const withMan = positionWith(
      [
        [1, BLACK_KING],
        [10, BLACK_MAN],
        [32, WHITE_KING],
      ],
      'black',
    );
    const below: GameState = {
      position: withMan,
      pliesWithoutProgress: MAX_PLIES_WITHOUT_PROGRESS - 1,
      repetitionHistory: [positionKey(withMan)],
    };
    const next = play(below, 10, 14);
    expect(next.pliesWithoutProgress).toBe(0);
    expect(gameResultFromState(next)).toBe('ongoing');
  });
});

describe('gameResultFromState – trojí opakování', () => {
  it('kyvadlo dam: 3. výskyt výchozí pozice je remíza, do té doby ongoing', () => {
    const start = initialGameState(
      positionWith(
        [
          [1, BLACK_KING],
          [32, WHITE_KING],
        ],
        'black',
      ),
    );
    // Jeden cyklus kyvadla = 4 půltahy a návrat do výchozí pozice.
    const cycle = [
      [1, 5],
      [32, 28],
      [5, 1],
      [28, 32],
    ] as const;
    let state = start;
    for (let round = 0; round < 2; round++) {
      for (const [from, to] of cycle) {
        expect(gameResultFromState(state)).toBe('ongoing');
        state = play(state, from, to);
      }
    }
    // Výchozí pozice je teď v historii potřetí (výchozí + 2 návraty).
    expect(gameResultFromState(state)).toBe('draw');
  });

  it('opakování se počítá jen od posledního pokroku (vyčištěná historie)', () => {
    // Stejná pozice, ale historie s jediným výskytem – žádná remíza.
    const kings = positionWith(
      [
        [1, BLACK_KING],
        [32, WHITE_KING],
      ],
      'black',
    );
    const fresh: GameState = {
      position: kings,
      pliesWithoutProgress: 2,
      repetitionHistory: [positionKey(kings)],
    };
    expect(gameResultFromState(fresh)).toBe('ongoing');
    // Tatáž pozice s historií nesoucí 3 výskyty remíza JE – rozdíl dělá
    // výhradně historie, přesně to zahazování při pokroku chrání.
    const repeated: GameState = {
      ...fresh,
      repetitionHistory: [positionKey(kings), 'jina', positionKey(kings), positionKey(kings)],
    };
    expect(gameResultFromState(repeated)).toBe('draw');
  });

  it('stejná deska s jinou stranou na tahu se jako opakování nepočítá', () => {
    const kings = positionWith(
      [
        [1, BLACK_KING],
        [32, WHITE_KING],
      ],
      'black',
    );
    const whiteTurnKey = positionKey({ ...kings, turn: 'white' });
    const state: GameState = {
      position: kings,
      pliesWithoutProgress: 4,
      repetitionHistory: [positionKey(kings), whiteTurnKey, positionKey(kings), whiteTurnKey],
    };
    // Deska je v historii 4×, ale žádná (deska + strana na tahu) 3×.
    expect(gameResultFromState(state)).toBe('ongoing');
  });

  it('remízu najde i zpětně – opakovala se dřívější pozice úseku, ne aktuální', () => {
    // Dávkové přehrání tahů: 3. výskyt pozice A je uprostřed historie,
    // aktuální pozice je jiná. Remíza nesmí být „přejetá".
    const kings = positionWith(
      [
        [1, BLACK_KING],
        [32, WHITE_KING],
      ],
      'black',
    );
    const state: GameState = {
      position: kings,
      pliesWithoutProgress: 7,
      repetitionHistory: ['a', 'b', 'a', 'b', 'a', positionKey(kings)],
    };
    expect(gameResultFromState(state)).toBe('draw');
  });

  it('poškozená pozice ve stavu propaguje RangeError', () => {
    const broken: GameState = {
      position: { board: new Array<Cell>(18).fill(null), turn: 'black' },
      pliesWithoutProgress: 0,
      repetitionHistory: [],
    };
    expect(() => gameResultFromState(broken)).toThrow(RangeError);
  });
});

describe('gameResultFromState – prohra má přednost před remízou', () => {
  it('bez tahu při čítači na limitu je prohra, ne remíza', () => {
    // Fixture ze fáze 4/7: černí zaklínění, černý na tahu nemá tah.
    const blocked = positionWith(
      [
        [21, BLACK_MAN],
        [25, BLACK_MAN],
        [29, BLACK_MAN],
        [30, BLACK_MAN],
        [1, WHITE_KING],
      ],
      'black',
    );
    const state: GameState = {
      position: blocked,
      pliesWithoutProgress: MAX_PLIES_WITHOUT_PROGRESS,
      repetitionHistory: [positionKey(blocked)],
    };
    expect(gameResultFromState(state)).toBe('white-wins');
  });

  it('bez kamenů při čítači na limitu je prohra, ne remíza', () => {
    const empty = positionWith([[18, BLACK_KING]], 'white');
    const state: GameState = {
      position: empty,
      pliesWithoutProgress: MAX_PLIES_WITHOUT_PROGRESS,
      repetitionHistory: [positionKey(empty)],
    };
    expect(gameResultFromState(state)).toBe('black-wins');
  });

  it('bez tahu při trojím opakování v historii je prohra, ne remíza', () => {
    const blocked = positionWith(
      [
        [21, BLACK_MAN],
        [25, BLACK_MAN],
        [29, BLACK_MAN],
        [30, BLACK_MAN],
        [1, WHITE_KING],
      ],
      'black',
    );
    const key = positionKey(blocked);
    const state: GameState = {
      position: blocked,
      pliesWithoutProgress: 10,
      repetitionHistory: [key, key, key],
    };
    expect(gameResultFromState(state)).toBe('white-wins');
  });
});

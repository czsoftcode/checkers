/**
 * Golden testy KVALITATIVNÍ PŘEDNOSTI braní dámou (česká varianta,
 * `CZECH_RULESET.kingCapturePriority`).
 *
 * Ručně postavené pozice, kde v jedné pozici může brát DÁMA i MUŽ. Pod českým
 * rulesetem musí `legalMoves` vrátit JEN skoky dámou (skoky mužem se vypustí);
 * je-li braní dámou nedostupné, muž se bere normálně. Kontroluje se obě strany
 * (černý i bílý) a výsledná deska po `applyMove`.
 *
 * ZUBY: tytéž pozice se pouští i s rulesetem, který se od českého liší JEN
 * vypnutým `kingCapturePriority` – tam se skok mužem vrátí. To dokazuje, že
 * skok mužem reálně existuje a odstranil ho FILTR priority, ne jeho absence.
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position, Ruleset } from '../src/index.js';
import { CZECH_RULESET, applyMove, legalMoves } from '../src/index.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

/** Český ruleset s VYPNUTOU prioritou dámy – jinak identický (kontrolní zuby). */
const CZECH_NO_PRIORITY: Ruleset = { ...CZECH_RULESET, kingCapturePriority: false };

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const BLACK_KING: Cell = { color: 'black', kind: 'king' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };
const WHITE_KING: Cell = { color: 'white', kind: 'king' };

/** Seřazená množina [odkud, kam] pro stabilní porovnání. */
function asPairs(moves: readonly Move[]): [number, number][] {
  return moves
    .map((m): [number, number] => [m.from, m.path[m.path.length - 1] ?? -1])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('CZECH kingCapturePriority – přednost dámy (černý na tahu)', () => {
  // Černá dáma na 21 bere přes bílého muže 25 na 30 (klouzavě, k okraji).
  // Nezávisle černý muž na 10 bere vpřed přes bílého muže 15 na 19.
  // Dáma i muž berou RŮZNÉ kameny a nezasahují si do cesty.
  const pos = positionWith(
    [
      [21, BLACK_KING],
      [10, BLACK_MAN],
      [25, WHITE_MAN],
      [15, WHITE_MAN],
    ],
    'black',
  );

  it('s prioritou: legalMoves vrátí JEN skok dámou, muž se vypustí', () => {
    expect(legalMoves(pos, CZECH_RULESET)).toEqual([{ from: 21, path: [30], captures: [25] }]);
  });

  it('zuby: bez priority (jinak stejný ruleset) se skok mužem vrátí', () => {
    // Existuje-li skok mužem, filtr priority ho odstranil – ne jeho absence.
    expect(asPairs(legalMoves(pos, CZECH_NO_PRIORITY))).toEqual([
      [10, 19],
      [21, 30],
    ]);
  });

  it('applyMove skoku dámou: dáma na 30, braný muž 25 pryč, zbytek beze změny', () => {
    const next = applyMove(pos, { from: 21, path: [30], captures: [25] }, CZECH_RULESET);
    expect(next.turn).toBe('white');
    expect(next.board[30 - 1]).toEqual(BLACK_KING);
    expect(next.board[21 - 1]).toBeNull();
    expect(next.board[25 - 1]).toBeNull();
    // Mužův cíl braní (bílý 15) i vlastní muž (10) zůstávají netknuté.
    expect(next.board[15 - 1]).toEqual(WHITE_MAN);
    expect(next.board[10 - 1]).toEqual(BLACK_MAN);
  });
});

describe('CZECH kingCapturePriority – přednost dámy (bílý na tahu)', () => {
  // Bílá dáma na 18 bere přes černého muže 25 na 29 (klouzavě, k okraji).
  // Nezávisle bílý muž na 10 bere vpřed přes černého muže 6 na 1.
  const pos = positionWith(
    [
      [18, WHITE_KING],
      [10, WHITE_MAN],
      [25, BLACK_MAN],
      [6, BLACK_MAN],
    ],
    'white',
  );

  it('s prioritou: legalMoves vrátí JEN skok dámou', () => {
    expect(legalMoves(pos, CZECH_RULESET)).toEqual([{ from: 18, path: [29], captures: [25] }]);
  });

  it('zuby: bez priority se skok mužem vrátí', () => {
    expect(asPairs(legalMoves(pos, CZECH_NO_PRIORITY))).toEqual([
      [10, 1],
      [18, 29],
    ]);
  });

  it('applyMove skoku dámou: dáma na 29, braný muž 25 pryč, zbytek beze změny', () => {
    const next = applyMove(pos, { from: 18, path: [29], captures: [25] }, CZECH_RULESET);
    expect(next.turn).toBe('black');
    expect(next.board[29 - 1]).toEqual(WHITE_KING);
    expect(next.board[18 - 1]).toBeNull();
    expect(next.board[25 - 1]).toBeNull();
    expect(next.board[6 - 1]).toEqual(BLACK_MAN);
    expect(next.board[10 - 1]).toEqual(WHITE_MAN);
  });
});

describe('CZECH kingCapturePriority – dáma brát nemůže → muž bere normálně', () => {
  // Černá dáma na 1 nemá koho brát (jediný směr SE blokuje vlastní muž na 10);
  // černý muž na 10 bere vpřed přes bílého 15 na 19. Priorita NESMÍ potlačit
  // mužovo braní, když dáma žádné nemá.
  const pos = positionWith(
    [
      [1, BLACK_KING],
      [10, BLACK_MAN],
      [15, WHITE_MAN],
    ],
    'black',
  );

  it('legalMoves vrátí mužův skok (dáma nemá co brát, filtr se neuplatní)', () => {
    expect(legalMoves(pos, CZECH_RULESET)).toEqual([{ from: 10, path: [19], captures: [15] }]);
  });

  it('applyMove mužova skoku: muž na 19, braný 15 pryč, dáma na 1 stojí dál', () => {
    const next = applyMove(pos, { from: 10, path: [19], captures: [15] }, CZECH_RULESET);
    expect(next.turn).toBe('white');
    expect(next.board[19 - 1]).toEqual(BLACK_MAN);
    expect(next.board[10 - 1]).toBeNull();
    expect(next.board[15 - 1]).toBeNull();
    expect(next.board[1 - 1]).toEqual(BLACK_KING);
  });
});

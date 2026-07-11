import { describe, expect, it } from 'vitest';
import type { Cell, Color, Position } from '@checkers/rules';
import { computeEngineMove } from '../../src/local/compute-move.js';
import { makeClock } from './helpers.js';

/** Postaví pozici z výčtu obsazených polí; zbytek prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

const BLACK_KING: Cell = { color: 'black', kind: 'king' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };

/**
 * Pozice, kde se varianty ROZCHÁZEJÍ ve VÝBĚRU tahu:
 * černá dáma na 18, bílý muž na 8 (NE paprsek 18-15-11-8-4, mezipole 15/11 i dopad 4
 * prázdné). Krátká (americká) dáma na 8 NEDOSÁHNE (není soused) → jen prosté tahy,
 * žádné braní. Létavá (ruská) dáma muže na 8 SEBERE klouzáním a dopadne na 4 → braní
 * je povinné, takže je to JEDINÝ legální tah.
 *
 * Kdyby `computeEngineMove` variantu ignorovalo (počítalo americky), vrátilo by pro
 * 'russian' prostý tah bez braní a assert `captures` by spadl – to jsou zuby testu.
 */
describe('computeEngineMove – varianta určuje výběr tahu', () => {
  const position = positionWith(
    [
      [18, BLACK_KING],
      [8, WHITE_MAN],
    ],
    'black',
  );
  const base = { position, level: 'professional' as const, seed: 0x1234_abcd, timeMs: 1 };

  it("ruská (létavá) sebere vzdáleného muže: braní 8, dopad 4", () => {
    const move = computeEngineMove({ ...base, variant: 'russian' }, makeClock());
    expect(move.captures).toEqual([8]);
    expect(move.path).toEqual([4]);
  });

  it('americká (default) muže na 8 nedosáhne → prostý tah bez braní', () => {
    const move = computeEngineMove({ ...base, variant: 'american' }, makeClock());
    expect(move.captures).toEqual([]);
  });

  it('bez varianty se chová jako americká (žádné braní)', () => {
    const move = computeEngineMove({ ...base }, makeClock());
    expect(move.captures).toEqual([]);
  });
});

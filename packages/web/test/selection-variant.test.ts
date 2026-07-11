import { describe, expect, it } from 'vitest';
import { RUSSIAN_RULESET } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { nextTargets, targetsFor, endpointsFor } from '../src/selection.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

const BLACK_KING: Cell = { color: 'black', kind: 'king' };

/**
 * Selection funkce berou ruleset varianty (default americká). Ověřujeme, že se
 * ruleset SKUTEČNĚ uplatní: létavá dáma (ruská) klouže po celé diagonále, americká
 * (short) jen o pole. Kdyby selection ruleset ignorovala, obě sady by byly stejné.
 */
describe('selection – ruleset varianty (létavá vs. krátká dáma)', () => {
  const position = positionWith([[18, BLACK_KING]], 'black');

  it('ruská (létavá) nabídne vzdálené dopady, americká (default) jen sousední', () => {
    const flying = nextTargets(position, 18, [], RUSSIAN_RULESET).sort((a, b) => a - b);
    const short = nextTargets(position, 18, []).sort((a, b) => a - b); // default = americká

    // Létavá dojede až k okraji desky (např. 27 na SW paprsku); krátká ne.
    expect(flying).toContain(27);
    expect(short).not.toContain(27);
    // Krátká je vlastní podmnožinou létavé (stejné směry, kratší dosah).
    for (const t of short) {
      expect(flying).toContain(t);
    }
    expect(flying.length).toBeGreaterThan(short.length);
  });

  it('targetsFor a endpointsFor stejně respektují ruleset', () => {
    expect(targetsFor(position, 18, RUSSIAN_RULESET)).toContain(27);
    expect(targetsFor(position, 18)).not.toContain(27);
    expect(endpointsFor(position, 18, RUSSIAN_RULESET)).toContain(27);
    expect(endpointsFor(position, 18)).not.toContain(27);
  });
});

/**
 * Jednotkový ADVERSARIÁLNÍ test autority serveru nad ITALSKÝMI pravidly na úrovni
 * `findLegalMove(position, from, path, ITALIAN_RULESET)` (fáze 120, IT-10).
 *
 * `findLegalMove` je jádro serverové autority (viz `app.ts` → `tryApplyMove`):
 * když vrátí `undefined`, server tah ODMÍTNE (WS `error` / REST 409). Tady se na
 * REÁLNÉM generátoru (`legalMoves`, žádný mock) dokazuje, že s `ITALIAN_RULESET`
 * server odmítne přesně tři italsky-specifické nelegality, které AMERICKÁ pravidla
 * pustí:
 *   (a) NEMAXIMÁLNÍ braní (kratší skok, když existuje delší) – FID kvantita,
 *   (b) braní MUŽEM místo povinné DÁMY (kvalitativní priorita dáma > muž),
 *   (c) MUŽ bere DÁMU (`manCannotCaptureKing`).
 * Legální MAXIMÁLNÍ tah naopak vrací non-null (odmítnutí není paušální).
 *
 * ZUBY: každá pozice se pouští i s AMERICAN_RULESET – tam se odmítnutý tah NAJDE
 * (non-undefined). To dokazuje, že tah reálně existuje a odstranil ho VÝBĚR
 * italského rulesetu, ne obecná nelegalita (tu řeší dto.test.ts / fáze 70).
 * Pozice jsou tytéž golden fixtury jako v `packages/rules` (max/priorita/muž×dáma).
 */

import { describe, expect, it } from 'vitest';

import { AMERICAN_RULESET, ITALIAN_RULESET } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { findLegalMove } from '../src/index.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const BLACK_KING: Cell = { color: 'black', kind: 'king' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };
const WHITE_KING: Cell = { color: 'white', kind: 'king' };

describe('findLegalMove(ITALIAN) – (a) nemaximální braní se ODMÍTNE', () => {
  // Černý muž 5 bere 3 kameny (5→14→23→32 přes 9,18,27); nezávislý černý muž 4
  // bere 2 (4→11→20 přes 8,16). FID maximum připouští jen 3-braní.
  const pos = positionWith(
    [
      [5, BLACK_MAN],
      [9, WHITE_MAN],
      [18, WHITE_MAN],
      [27, WHITE_MAN],
      [4, BLACK_MAN],
      [8, WHITE_MAN],
      [16, WHITE_MAN],
    ],
    'black',
  );

  it('kratší 2-braní → undefined (server ho odmítne)', () => {
    expect(findLegalMove(pos, 4, [11, 20], ITALIAN_RULESET)).toBeUndefined();
  });

  it('maximální 3-braní → non-null (odmítnutí není paušální), server odvodí captures', () => {
    const move = findLegalMove(pos, 5, [14, 23, 32], ITALIAN_RULESET);
    expect(move).toBeDefined();
    expect(move?.captures).toEqual([9, 18, 27]);
  });

  it('ZUB: AMERICAN (bez maxima) 2-braní NAJDE – odstranil ho výběr italského rulesetu', () => {
    const move = findLegalMove(pos, 4, [11, 20], AMERICAN_RULESET);
    expect(move).toBeDefined();
    expect(move?.captures).toEqual([8, 16]);
  });
});

describe('findLegalMove(ITALIAN) – (b) braní mužem místo povinné dámy se ODMÍTNE', () => {
  // Černý muž 9 bere přes 14 na 18 (1 kámen); černá dáma 22 bere přes 26 na 31
  // (1 kámen). Stejné maximum (1) → rozhoduje kvalita: bere-li dáma, mužův tah zmizí.
  const pos = positionWith(
    [
      [9, BLACK_MAN],
      [14, WHITE_MAN],
      [22, BLACK_KING],
      [26, WHITE_MAN],
    ],
    'black',
  );

  it('braní mužem (9→18) → undefined (priorita dáma > muž)', () => {
    expect(findLegalMove(pos, 9, [18], ITALIAN_RULESET)).toBeUndefined();
  });

  it('povinné braní dámou (22→31) → non-null', () => {
    const move = findLegalMove(pos, 22, [31], ITALIAN_RULESET);
    expect(move).toBeDefined();
    expect(move?.captures).toEqual([26]);
  });

  it('ZUB: AMERICAN (bez kvality) braní mužem NAJDE', () => {
    const move = findLegalMove(pos, 9, [18], AMERICAN_RULESET);
    expect(move).toBeDefined();
    expect(move?.captures).toEqual([14]);
  });
});

describe('findLegalMove(ITALIAN) – (c) muž bere dámu se ODMÍTNE', () => {
  // Černý muž 10, před ním (SE) bílá DÁMA 15, za ní prázdné 19. Muž dámu nesmí brát.
  const pos = positionWith(
    [
      [10, BLACK_MAN],
      [15, WHITE_KING],
    ],
    'black',
  );

  it('muž bere dámu (10→19) → undefined (manCannotCaptureKing)', () => {
    expect(findLegalMove(pos, 10, [19], ITALIAN_RULESET)).toBeUndefined();
  });

  it('ZUB: AMERICAN muže přes dámu PUSTÍ (10→19, bere 15)', () => {
    const move = findLegalMove(pos, 10, [19], AMERICAN_RULESET);
    expect(move).toBeDefined();
    expect(move?.captures).toEqual([15]);
  });
});

/**
 * Jednotkové testy čistých helperů: serializace stavu + hledání legálního tahu.
 * Reálný kód `rules` (legalMoves, gameResultFromState), žádné mocky – findLegalMove
 * je jádro autority serveru a musí sedět na skutečném generátoru tahů.
 */

import { describe, expect, it } from 'vitest';

import { initialGameState, legalMoves } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { findLegalMove, gameToDto, moveToDto } from '../src/index.js';

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

describe('gameToDto', () => {
  it('výchozí pozice: ongoing, černý na tahu, 7 prostých tahů', () => {
    const dto = gameToDto('abc', initialGameState());
    expect(dto.id).toBe('abc');
    expect(dto.position.turn).toBe('black');
    expect(dto.result).toBe('ongoing');
    expect(dto.legalMoves).toHaveLength(7);
    // Kontrakt tvaru tahu na drátě: { from, path, captures }, prostý tah bez braní.
    for (const move of dto.legalMoves) {
      expect(Object.keys(move).sort()).toEqual(['captures', 'from', 'path']);
      expect(move.captures).toEqual([]);
      expect(move.path).toHaveLength(1);
    }
  });
});

describe('moveToDto', () => {
  it('vrací kopie polí (ne readonly odkaz na Move z rules)', () => {
    const [move] = legalMoves(initialGameState().position);
    if (move === undefined) {
      throw new Error('výchozí pozice musí mít legální tah');
    }
    const dto = moveToDto(move);
    expect(dto).toEqual({ from: move.from, path: [...move.path], captures: [...move.captures] });
    // Kopie, ne sdílený odkaz.
    expect(dto.path).not.toBe(move.path);
  });
});

describe('findLegalMove – match zadání klienta proti reálným legalMoves', () => {
  it('prostý tah z výchozí pozice se najde a doplní prázdné captures', () => {
    const position = initialGameState().position;
    // 9→13 je legální otevírací tah černého muže.
    const move = findLegalMove(position, 9, [13]);
    expect(move).toBeDefined();
    expect(move?.from).toBe(9);
    expect(move?.path).toEqual([13]);
    expect(move?.captures).toEqual([]);
  });

  it('nesedící cesta vrací undefined (žádný legální tah)', () => {
    const position = initialGameState().position;
    // Setrvání na místě není tah – server ho nesmí najít.
    expect(findLegalMove(position, 9, [9])).toBeUndefined();
    // Tah druhé strany (bílý kámen, když je na tahu černý).
    expect(findLegalMove(position, 23, [18])).toBeUndefined();
    // Neexistující výchozí pole.
    expect(findLegalMove(position, 15, [19])).toBeUndefined();
  });

  it('při povinném braní se prostý tah stejného kamene NENAJDE', () => {
    // Černý muž na 9, bílý na 14: povinný skok 9x18. Prostý tah je potlačen.
    const position = positionWith([[9, BLACK_MAN], [14, WHITE_MAN]], 'black');
    expect(findLegalMove(position, 9, [13])).toBeUndefined();
    const jump = findLegalMove(position, 9, [18]);
    expect(jump).toBeDefined();
    // captures si odvodil server z generátoru, klient je neposílal.
    expect(jump?.captures).toEqual([14]);
  });

  it('vícenásobný skok: plná cesta dopadů rozhoduje, ne jen výchozí pole', () => {
    // Kruh: černá dáma 18, bílí muži 6,7,14,15. Dva legální tahy – oba obkrouží
    // kruh a vrátí se na 18, liší se POŘADÍM cesty.
    const position = positionWith(
      [[18, BLACK_KING], [6, WHITE_MAN], [7, WHITE_MAN], [14, WHITE_MAN], [15, WHITE_MAN]],
      'black',
    );

    // path OBSAHUJE výchozí pole (dáma se vrací na 18) – match musí zvládnout
    // path === from na konci sekvence.
    const forward = findLegalMove(position, 18, [9, 2, 11, 18]);
    expect(forward).toBeDefined();
    expect(forward?.captures).toEqual([14, 6, 7, 15]);

    // Opačné pořadí je JINÝ legální tah (stejná množina polí, jiné pořadí).
    // Kdyby match dedupoval přes Set, spletl by si je – proto deep-equal.
    const backward = findLegalMove(position, 18, [11, 2, 9, 18]);
    expect(backward).toBeDefined();
    expect(backward?.captures).toEqual([15, 7, 6, 14]);

    // Neúplná cesta (jen část kruhu) legální není – nesmí se strefit do plné.
    expect(findLegalMove(position, 18, [9, 2, 11])).toBeUndefined();
  });
});

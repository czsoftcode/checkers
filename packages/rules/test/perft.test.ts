import { describe, expect, it } from 'vitest';

import type { Cell, Position } from '../src/index.js';
import { initialPosition, perft } from '../src/index.js';

describe('perft – základ', () => {
  it('hloubka 0 je 1 list', () => {
    expect(perft(initialPosition(), 0)).toBe(1);
  });

  it('hloubka 1 z výchozí pozice je 7 tahů', () => {
    expect(perft(initialPosition(), 1)).toBe(7);
  });

  it('neplatnou hloubku odmítá RangeError', () => {
    expect(() => perft(initialPosition(), -1)).toThrow(RangeError);
    expect(() => perft(initialPosition(), 1.5)).toThrow(RangeError);
    expect(() => perft(initialPosition(), Number.NaN)).toThrow(RangeError);
  });

  it('pozice bez tahů má perft 0 v každé hloubce >= 1', () => {
    const board: Cell[] = new Array<Cell>(32).fill(null);
    board[18 - 1] = { color: 'white', kind: 'man' };
    const noMoves: Position = { board, turn: 'black' };
    expect(perft(noMoves, 1)).toBe(0);
    expect(perft(noMoves, 3)).toBe(0);
  });
});

describe('perft 1–6 proti nezávislému zdroji', () => {
  // Publikované hodnoty pro americkou dámu (English draughts) z výchozí
  // pozice – nezávislý zdroj: Aart Bik (perft thread, Bob Newell's Checker
  // Maven / talkchess archiv). NESMÍ se upravovat podle našeho generátoru:
  // nesedící číslo znamená chybu v NAŠEM kódu.
  const EXPECTED: readonly number[] = [7, 49, 302, 1469, 7361, 36768];

  it.each(EXPECTED.map((nodes, i) => [i + 1, nodes] as const))(
    'perft(%i) = %i',
    (depth, nodes) => {
      expect(perft(initialPosition(), depth)).toBe(nodes);
    },
  );
});

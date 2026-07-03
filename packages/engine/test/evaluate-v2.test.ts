import { legalMoves } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import {
  ADVANCE_BONUS,
  BACK_ROW_BONUS,
  DOUBLE_CORNER_BONUS,
  evaluateV2,
  KING_VALUE,
  MAN_VALUE,
  MOBILITY_WEIGHT,
} from '../src/evaluate.js';
import { makePosition, mirrorPosition, randomPlayedPosition } from './support/position.js';

/**
 * Očekávaný příspěvek mobility k evaluaci: rozdíl počtu legálních tahů
 * strany na tahu a soupeře × váha. Počítá se přes VEŘEJNÉ `legalMoves`
 * (stejné API jako v evaluaci) – testuje se tím zapojení mobility do skóre
 * (znaménko, váha, obě strany), ne správnost generátoru tahů (to má rules).
 */
function mobilityTerm(position: Position): number {
  const opponent: Color = position.turn === 'black' ? 'white' : 'black';
  const mine = legalMoves(position).length;
  const theirs = legalMoves({ board: position.board, turn: opponent }).length;
  return MOBILITY_WEIGHT * (mine - theirs);
}

describe('evaluateV2 – mobilita', () => {
  it('při rovném materiálu rozhoduje mobilita (víc tahů = kladné, z pohledu soupeře záporné)', () => {
    // Černý muž 14 (řada 3) má 2 prosté tahy (17, 18); bílý muž 20 (řada 4)
    // má 1 (16). Postup obou je 3 řady → materiál je PŘESNĚ vyrovnaný (0),
    // takže celé skóre je jen mobilita. Kameny jsou daleko od sebe, nikdo
    // nebere. Rozdíl tahů 2−1 → +MOBILITY_WEIGHT z pohledu černého.
    const blackToMove = makePosition('black', { 14: 'bm', 20: 'wm' });
    expect(evaluateV2(blackToMove)).toBe(MOBILITY_WEIGHT);
    // Stejné kameny, ale na tahu je bílý (1 tah vs 2 černého) → záporné.
    const whiteToMove = makePosition('white', { 14: 'bm', 20: 'wm' });
    expect(evaluateV2(whiteToMove)).toBe(-MOBILITY_WEIGHT);
  });
});

describe('evaluateV2 – dvojitý roh', () => {
  it('vlastní kámen na vlastním dvojitém rohu (černý) dostává bonus', () => {
    // Pole 8 je černý dvojitý roh, pole 6 ne – obě jsou v řadě 1 (stejný
    // postup) a osamocený muž má z obou 2 tahy (stejná mobilita), takže
    // rozdíl skóre je čistě bonus za dvojitý roh.
    const onCorner = evaluateV2(makePosition('black', { 8: 'bm' }));
    const offCorner = evaluateV2(makePosition('black', { 6: 'bm' }));
    expect(onCorner - offCorner).toBe(DOUBLE_CORNER_BONUS);
  });

  it('vlastní kámen na vlastním dvojitém rohu (bílý) dostává bonus', () => {
    // Pole 25 je bílý dvojitý roh, pole 26 ne – obě řada 6, oba 2 tahy.
    const onCorner = evaluateV2(makePosition('white', { 25: 'wm' }));
    const offCorner = evaluateV2(makePosition('white', { 26: 'wm' }));
    expect(onCorner - offCorner).toBe(DOUBLE_CORNER_BONUS);
  });
});

describe('evaluateV2 – zadní řada podmíněně', () => {
  it('muž na zadní řadě má bonus, dokud má soupeř muže; proti samým dámám ne', () => {
    // Soupeř má MUŽE (může proměnit) → černý muž na 1 i bílý muž na 32
    // dostávají bonus za zadní řadu.
    const withMan = makePosition('black', { 1: 'bm', 6: 'bm', 32: 'wm' });
    const blackWithMan = MAN_VALUE + BACK_ROW_BONUS + (MAN_VALUE + ADVANCE_BONUS);
    const whiteWithMan = MAN_VALUE + BACK_ROW_BONUS;
    expect(evaluateV2(withMan)).toBe(blackWithMan - whiteWithMan + mobilityTerm(withMan));

    // Soupeř má jen DÁMU (nic k proměně) → černý muž na 1 bonus za zadní
    // řadu ZTRÁCÍ. Jediná změna oproti výše je muž→dáma soupeře.
    const withKing = makePosition('black', { 1: 'bm', 6: 'bm', 32: 'wk' });
    const blackWithKing = MAN_VALUE + (MAN_VALUE + ADVANCE_BONUS);
    expect(evaluateV2(withKing)).toBe(blackWithKing - KING_VALUE + mobilityTerm(withKing));
  });
});

describe('evaluateV2 – exaktní hodnota (chytí i špatnou váhu, ne jen zapojení)', () => {
  it('osamocený černý muž na dvojitém rohu (pole 8), bílý prázdný = přesně 109', () => {
    // Ručně dopočítané celé číslo, NEZÁVISLE na importovaných konstantách –
    // kdyby se změnila kterákoli váha (materiál 100, postup +1/řada, dvojitý
    // roh +4, mobilita ×2), tohle číslo se pohne a test spadne. Dokumentuje
    // AKTUÁLNÍ váhy: při ladění evaluace se má vědomě přepsat, ne obejít.
    //   muž na 8: 100 (materiál) + 1 (postup řada 1) + 4 (dvojitý roh) = 105
    //   mobilita: 2 tahy černého − 0 bílého = 2 → ×2 = 4
    //   celkem 105 + 4 = 109
    expect(evaluateV2(makePosition('black', { 8: 'bm' }))).toBe(109);
  });
});

describe('evaluateV2 – invarianty', () => {
  const seeds = [1, 7, 42, 1234, 99999];

  it.each(seeds)('zrcadlo s prohozenými barvami dává opačné skóre (seed %i)', (seed) => {
    const position = randomPlayedPosition(seed, 10 + (seed % 20));
    const mirrored = mirrorPosition(position, position.turn);
    const score = evaluateV2(position);
    expect(evaluateV2(mirrored)).toBe(score === 0 ? 0 : -score);
  });

  it.each(seeds)('skóre je vždy celé číslo (seed %i)', (seed) => {
    const position = randomPlayedPosition(seed, 10 + (seed % 20));
    expect(Number.isInteger(evaluateV2(position))).toBe(true);
  });
});

describe('evaluateV2 – poškozený vstup', () => {
  it('díra v board (undefined) vyhazuje RangeError', () => {
    const board: (Cell | undefined)[] = Array.from({ length: 32 }, () => null);
    board[12] = undefined;
    expect(() => evaluateV2({ board, turn: 'black' } as unknown as Position)).toThrow(RangeError);
  });
});

import {
  AMERICAN_RULESET,
  CZECH_RULESET,
  POOL_RULESET,
  RUSSIAN_RULESET,
  initialPosition,
} from '@checkers/rules';
import type { Cell, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import {
  ADVANCE_BONUS,
  BACK_ROW_BONUS,
  evaluate,
  KING_VALUE,
  KING_VALUE_FLYING,
  MAN_VALUE,
} from '../src/evaluate.js';
import { makePosition, mirrorPosition, randomPlayedPosition } from './support/position.js';

describe('evaluate – základní vlastnosti', () => {
  it('výchozí pozice je vyrovnaná (0) pro obě strany na tahu', () => {
    expect(evaluate(initialPosition())).toBe(0);
    expect(evaluate({ ...initialPosition(), turn: 'white' })).toBe(0);
  });

  it('materiální převaha dává straně na tahu kladné skóre a soupeři záporné', () => {
    // Černý má muže navíc; pole volená mimo zadní řady, stejný postup (řada 3 a 4).
    const position = makePosition('black', { 13: 'bm', 14: 'bm', 18: 'wm' });
    expect(evaluate(position)).toBeGreaterThan(0);
    expect(evaluate({ ...position, turn: 'white' })).toBeLessThan(0);
  });

  it('dáma má vyšší hodnotu než muž na stejném poli', () => {
    const man = evaluate(makePosition('black', { 18: 'bm' }));
    const king = evaluate(makePosition('black', { 18: 'bk' }));
    expect(king).toBeGreaterThan(man);
    expect(king).toBe(KING_VALUE);
  });
});

describe('evaluate – poziční složky', () => {
  it('muž na vlastní zadní řadě dostává bonus', () => {
    // Pole 1 je zadní řada černého (řada 0, postup 0).
    expect(evaluate(makePosition('black', { 1: 'bm' }))).toBe(MAN_VALUE + BACK_ROW_BONUS);
    // Pole 32 je zadní řada bílého (řada 7, postup 0).
    expect(evaluate(makePosition('white', { 32: 'wm' }))).toBe(MAN_VALUE + BACK_ROW_BONUS);
  });

  it('postup muže vpřed přidává bonus za každou řadu', () => {
    // Pole 9 je řada 2 → černý muž postoupil o 2 řady od své zadní řady.
    expect(evaluate(makePosition('black', { 9: 'bm' }))).toBe(MAN_VALUE + 2 * ADVANCE_BONUS);
    // Pole 18 je řada 4 → bílý muž postoupil o 3 řady (7 − 4).
    expect(evaluate(makePosition('white', { 18: 'wm' }))).toBe(MAN_VALUE + 3 * ADVANCE_BONUS);
  });

  it('dáma poziční bonusy nemá (ani na zadní řadě)', () => {
    expect(evaluate(makePosition('black', { 1: 'bk' }))).toBe(KING_VALUE);
  });
});

describe('evaluate – cena létavé dámy per varianta', () => {
  const flyingRulesets = [
    ['pool', POOL_RULESET],
    ['ruská', RUSSIAN_RULESET],
    ['česká', CZECH_RULESET],
  ] as const;

  it.each(flyingRulesets)('flying varianta (%s) cení dámu na KING_VALUE_FLYING (300)', (_name, ruleset) => {
    const king = makePosition('black', { 18: 'bk' });
    expect(evaluate(king, ruleset)).toBe(KING_VALUE_FLYING);
    // americká (short) tutéž dámu cení na 130 – řádový rozdíl.
    expect(evaluate(king, AMERICAN_RULESET)).toBe(KING_VALUE);
    expect(KING_VALUE_FLYING).toBeGreaterThan(KING_VALUE);
  });

  it.each(flyingRulesets)('pozice s dámou je s flying ruleset (%s) hodnocena výš než s americkým', (_name, ruleset) => {
    // Vyrovnaný materiál kromě jedné černé dámy navíc → flying ji cení víc.
    const position = makePosition('black', { 18: 'bk', 13: 'bm', 20: 'wm' });
    expect(evaluate(position, ruleset)).toBeGreaterThan(evaluate(position, AMERICAN_RULESET));
  });

  it('výchozí ruleset (bez argumentu) je americký – short 130, chování beze změny', () => {
    const king = makePosition('black', { 18: 'bk' });
    expect(evaluate(king)).toBe(evaluate(king, AMERICAN_RULESET));
    expect(evaluate(king)).toBe(KING_VALUE);
  });

  it('flying ruleset NEMĚNÍ hodnotu mužů (jen dámy)', () => {
    // Pozice bez dámy: skóre musí být identické napříč rulesety.
    const menOnly = makePosition('black', { 13: 'bm', 14: 'bm', 20: 'wm' });
    expect(evaluate(menOnly, RUSSIAN_RULESET)).toBe(evaluate(menOnly, AMERICAN_RULESET));
  });

  it('americká pozice s dámou beze změny čísel (short 130 nezměněn)', () => {
    // Regrese: americká dáma na poli 1 je pořád přesně KING_VALUE (žádný poziční bonus).
    expect(evaluate(makePosition('black', { 1: 'bk' }), AMERICAN_RULESET)).toBe(KING_VALUE);
  });
});

describe('evaluate – symetrie na rozehraných pozicích', () => {
  const seeds = [1, 7, 42, 1234, 99999];

  it.each(seeds)('zrcadlo s prohozenými barvami dává opačné skóre (seed %i)', (seed) => {
    const position = randomPlayedPosition(seed, 10 + (seed % 20));
    const mirrored = mirrorPosition(position, position.turn);
    const score = evaluate(position);
    // `-score` u vyrovnané pozice vyrobí -0 a toBe (Object.is) by falešně spadl.
    expect(evaluate(mirrored)).toBe(score === 0 ? 0 : -score);
  });

  it.each(seeds)('zrcadlo s prohozením barev I strany na tahu dává stejné skóre (seed %i)', (seed) => {
    const position = randomPlayedPosition(seed, 10 + (seed % 20));
    const swappedTurn = position.turn === 'black' ? 'white' : 'black';
    const mirrored = mirrorPosition(position, swappedTurn);
    expect(evaluate(mirrored)).toBe(evaluate(position));
  });
});

describe('evaluate – poškozený vstup', () => {
  it('díra v board (undefined) vyhazuje RangeError', () => {
    const board: (Cell | undefined)[] = Array.from({ length: 32 }, () => null);
    board[12] = undefined;
    expect(() => evaluate({ board, turn: 'black' } as unknown as Position)).toThrow(RangeError);
  });
});

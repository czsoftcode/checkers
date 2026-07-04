// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import { beforeEach, describe, expect, it } from 'vitest';

import { createBoardController } from '../src/controller.js';

function mount(): HTMLElement {
  const { element } = createBoardController(initialPosition());
  document.body.append(element);
  return element;
}

function squareEl(root: HTMLElement, square: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} v desce nenalezeno`);
  }
  return el;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('render desky', () => {
  it('má 64 polí, z toho 32 hracích s čísly 1–32', () => {
    const board = mount();
    expect(board.querySelectorAll('.square')).toHaveLength(64);

    const numbers = [...board.querySelectorAll<HTMLElement>('[data-square]')]
      .map((el) => Number(el.dataset.square))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
  });

  it('má správnou orientaci: pole 1–4 v horní řadě, 29–32 v dolní', () => {
    // Zuby proti posunu/zrcadlení mapování: kdyby coordsToSquare bylo otočené
    // nebo posunuté, čísla v krajních řadách by neseděla.
    const board = mount();
    const cells = [...board.querySelectorAll<HTMLElement>('.square')];
    expect(cells).toHaveLength(64);

    const numbersIn = (from: number, to: number): number[] =>
      cells
        .slice(from, to)
        .map((el) => el.dataset.square)
        .filter((s): s is string => s !== undefined)
        .map(Number)
        .sort((a, b) => a - b);

    expect(numbersIn(0, 8)).toEqual([1, 2, 3, 4]); // horní řada = strana černého
    expect(numbersIn(56, 64)).toEqual([29, 30, 31, 32]); // dolní řada = strana bílého
  });

  it('vykreslí výchozí rozestavění: 12 černých a 12 bílých kamenů', () => {
    const board = mount();
    expect(board.querySelectorAll('.piece.black')).toHaveLength(12);
    expect(board.querySelectorAll('.piece.white')).toHaveLength(12);
  });
});

describe('interakce výběru', () => {
  it('klik na vlastní kámen ho vybere a zvýrazní cíle', () => {
    const board = mount();
    click(squareEl(board, 9));

    expect(squareEl(board, 9).classList.contains('selected')).toBe(true);
    expect(squareEl(board, 13).classList.contains('target')).toBe(true);
    expect(squareEl(board, 14).classList.contains('target')).toBe(true);
  });

  it('opětovný klik na vybraný kámen výběr zruší', () => {
    const board = mount();
    click(squareEl(board, 9));
    click(squareEl(board, 9));

    expect(board.querySelectorAll('.selected')).toHaveLength(0);
    expect(board.querySelectorAll('.target')).toHaveLength(0);
  });

  it('klik na kámen soupeře výběr zruší (nevybere ho)', () => {
    const board = mount();
    click(squareEl(board, 9)); // vybráno
    click(squareEl(board, 21)); // bílý – černý je na tahu

    expect(board.querySelectorAll('.selected')).toHaveLength(0);
  });

  it('klik na světlé (nehrací) pole výběr zruší', () => {
    const board = mount();
    click(squareEl(board, 9));
    const light = board.querySelector<HTMLElement>('.square.light');
    expect(light).not.toBeNull();
    click(light!);

    expect(board.querySelectorAll('.selected')).toHaveLength(0);
  });
});

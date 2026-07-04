// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { beforeEach, describe, expect, it } from 'vitest';

import { createBoardController } from '../src/controller.js';

function mount(position: Position = initialPosition()): HTMLElement {
  const { element } = createBoardController(position);
  document.body.append(element);
  return element;
}

/** Postaví pozici z řídkého zápisu `{ pole: kámen }` (pole 1–32). */
function position(turn: Color, pieces: Record<number, Cell>): Position {
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  return { board, turn };
}

const blackMan: Cell = { color: 'black', kind: 'man' };
const whiteMan: Cell = { color: 'white', kind: 'man' };
const blackKing: Cell = { color: 'black', kind: 'king' };

function hasPiece(root: HTMLElement, square: number, cls: string): boolean {
  return squareEl(root, square).querySelector(`.piece.${cls}`) !== null;
}

function isEmpty(root: HTMLElement, square: number): boolean {
  return squareEl(root, square).querySelector('.piece') === null;
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

describe('vícenásobný skok a provedení tahu', () => {
  // Černý muž 6 přeskočí bílé 10 a 18, cesta [15, 22].
  const doubleJump = (): Position =>
    position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });

  it('mezidopad se zvýrazní třídou path a nabídne další dopad', () => {
    const board = mount(doubleJump());
    click(squareEl(board, 6)); // vybere kámen, cíl 15
    expect(squareEl(board, 15).classList.contains('target')).toBe(true);

    click(squareEl(board, 15)); // první dopad
    expect(squareEl(board, 6).classList.contains('selected')).toBe(true);
    expect(squareEl(board, 15).classList.contains('path')).toBe(true);
    expect(squareEl(board, 22).classList.contains('target')).toBe(true);
    // Tah ještě není proveden – kámen pořád stojí na výchozím poli.
    expect(hasPiece(board, 6, 'black')).toBe(true);
  });

  it('dokončení sekvence provede tah přes rules a překreslí desku', () => {
    const board = mount(doubleJump());
    click(squareEl(board, 6));
    click(squareEl(board, 15));
    click(squareEl(board, 22)); // poslední dopad → provedení

    expect(hasPiece(board, 22, 'black')).toBe(true); // kámen dorazil
    expect(isEmpty(board, 6)).toBe(true); // opustil výchozí pole
    expect(isEmpty(board, 10)).toBe(true); // sebráno
    expect(isEmpty(board, 18)).toBe(true); // sebráno
    // Po tahu žádné zbytkové zvýraznění.
    expect(board.querySelectorAll('.selected, .path, .target')).toHaveLength(0);
  });

  it('u větvení nespadne do prvního směru, ale nabídne obě větve', () => {
    // Dáma 1 skočí přes 6 na 10, pak buď přes 7 na 3, nebo přes 14 na 17.
    const board = mount(position('black', { 1: blackKing, 6: whiteMan, 7: whiteMan, 14: whiteMan }));
    click(squareEl(board, 1));
    click(squareEl(board, 10)); // společný první dopad

    expect(squareEl(board, 3).classList.contains('target')).toBe(true);
    expect(squareEl(board, 17).classList.contains('target')).toBe(true);

    click(squareEl(board, 17)); // zvolená větev → provedení
    expect(hasPiece(board, 17, 'black')).toBe(true);
    expect(isEmpty(board, 6)).toBe(true);
    expect(isEmpty(board, 14)).toBe(true);
    expect(hasPiece(board, 7, 'white')).toBe(true); // druhá větev nesebrána
  });

  it('výběr zablokovaného vlastního kamene nenabídne cíle a nezpůsobí pád', () => {
    // Černý muž 1 (horní řada) má pole 5, 6 obsazená vlastními – žádný tah.
    const board = mount(initialPosition());
    expect(() => {
      click(squareEl(board, 1));
    }).not.toThrow();
    expect(squareEl(board, 1).classList.contains('selected')).toBe(true);
    expect(board.querySelectorAll('.target')).toHaveLength(0);
  });

  it('klik na výchozí kámen uprostřed sekvence zruší rozpracovaný skok', () => {
    const board = mount(doubleJump());
    click(squareEl(board, 6));
    click(squareEl(board, 15)); // rozpracovaná sekvence, mezidopad 15
    expect(squareEl(board, 15).classList.contains('path')).toBe(true);

    click(squareEl(board, 6)); // klik zpět na výchozí kámen = úplný reset
    expect(board.querySelectorAll('.selected, .path, .target')).toHaveLength(0);
    // Nic se neprovedlo – kámen i oběti zůstávají.
    expect(hasPiece(board, 6, 'black')).toBe(true);
    expect(hasPiece(board, 10, 'white')).toBe(true);
  });

  it('klik mimo zvýrazněná pole uprostřed sekvence zruší rozpracovaný skok', () => {
    const board = mount(doubleJump());
    click(squareEl(board, 6));
    click(squareEl(board, 15)); // mezidopad
    // Pole 22 je jediný další dopad; klik na jiné hrací pole (např. 1) = reset.
    click(squareEl(board, 1));
    expect(board.querySelectorAll('.selected, .path, .target')).toHaveLength(0);
    expect(hasPiece(board, 6, 'black')).toBe(true);
  });

  it('proměna na dámu při dopadu na poslední řadu se vykreslí jako king', () => {
    // Černý muž 23 přeskočí bílého 27 a dopadne na 32 (poslední řada) → dáma.
    const board = mount(position('black', { 23: blackMan, 27: whiteMan }));
    click(squareEl(board, 23));
    click(squareEl(board, 32));

    expect(hasPiece(board, 32, 'black')).toBe(true);
    expect(squareEl(board, 32).querySelector('.piece.king')).not.toBeNull();
    expect(isEmpty(board, 27)).toBe(true);
  });
});

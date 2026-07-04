/**
 * Vykreslení desky do DOM – „hloupá" vrstva bez herní logiky.
 *
 * Postaví jednou mřížku 8×8 (32 tmavých hracích polí nese `data-square` = číslo
 * pole 1–32) a hlásí kliknutí ven přes `onSquareClick`; kliknutí na světlé pole
 * nebo mimo desku hlásí `null`. Zvýraznění i kameny překresluje `update`.
 */

import { BOARD_SIZE, coordsToSquare, isDarkSquare } from '@checkers/rules';
import type { Cell, Position, Square } from '@checkers/rules';

/** Stav k vykreslení: pozice, vybrané pole a cílová pole ke zvýraznění. */
export interface RenderState {
  readonly position: Position;
  readonly selected: Square | null;
  /** Naklikané mezidopady rozpracovaného skoku (bez výchozího pole). */
  readonly path: readonly Square[];
  readonly targets: readonly Square[];
}

/** Deska napojená na DOM. */
export interface BoardView {
  /** Kořenový prvek `.board` k vložení do stránky. */
  readonly element: HTMLElement;
  /** Překreslí kameny a zvýraznění podle stavu. */
  update(state: RenderState): void;
}

/**
 * Vytvoří desku. `onSquareClick` dostane číslo klilknutého hracího pole (1–32),
 * nebo `null` při kliknutí mimo hrací pole.
 */
export function createBoardView(onSquareClick: (square: Square | null) => void): BoardView {
  const element = document.createElement('div');
  element.className = 'board';

  const squareEls = new Map<Square, HTMLElement>();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement('div');
      const dark = isDarkSquare(row, col);
      cell.className = dark ? 'square dark' : 'square light';
      if (dark) {
        const square = coordsToSquare(row, col);
        cell.dataset.square = String(square);
        squareEls.set(square, cell);
      }
      element.append(cell);
    }
  }

  element.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.square') : null;
    const raw = target instanceof HTMLElement ? target.dataset.square : undefined;
    onSquareClick(raw === undefined ? null : Number(raw));
  });

  function update(state: RenderState): void {
    const targetSet = new Set(state.targets);
    const pathSet = new Set(state.path);
    for (const [square, cell] of squareEls) {
      cell.classList.toggle('selected', state.selected === square);
      cell.classList.toggle('path', pathSet.has(square));
      cell.classList.toggle('target', targetSet.has(square));
      renderPiece(cell, state.position.board[square - 1] ?? null);
    }
  }

  return { element, update };
}

/**
 * Srovná kámen v jednom poli s jeho obsahem. Idempotentně: pokud kámen zůstává,
 * element se NErecykluje – jen se případně upraví třída (proměna man→king).
 *
 * Recyklace (smazat + znovu vytvořit při každém překreslení) by při pollingu à
 * 250 ms spolkla klik: kdyby se `.piece` vyměnil mezi mousedown a mouseup, klik
 * by na kámen nedopadl. Proto se element mění jen při reálné změně obsahu pole.
 */
function renderPiece(cell: HTMLElement, piece: Cell): void {
  const existing = cell.querySelector('.piece');
  if (piece === null) {
    existing?.remove();
    return;
  }
  const className = piece.kind === 'king' ? `piece ${piece.color} king` : `piece ${piece.color}`;
  if (existing !== null) {
    if (existing.className !== className) {
      existing.className = className; // stejný element, jen jiný stav (proměna)
    }
    return;
  }
  const el = document.createElement('div');
  el.className = className;
  cell.append(el);
}

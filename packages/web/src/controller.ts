/**
 * Spojení modelu výběru (`selection`) s vykreslením (`board-view`).
 *
 * Drží jen lokální stav výběru; žádný server, žádné provedení tahu (to je
 * pozdější todo 20). Pravidla výběru:
 * - klik na vlastní kámen ho vybere a zvýrazní jeho cíle,
 * - klik znovu na vybraný kámen výběr zruší,
 * - klik na prázdné/cizí pole nebo mimo desku výběr zruší.
 */

import { createBoardView } from './board-view.js';
import { selectableAt, targetsFor } from './selection.js';
import type { Position, Square } from '@checkers/rules';

/** Ovládaná deska připravená k vložení do stránky. */
export interface BoardController {
  readonly element: HTMLElement;
}

/** Vytvoří desku nad danou (v této fázi neměnnou) pozicí. */
export function createBoardController(position: Position): BoardController {
  let selected: Square | null = null;
  const view = createBoardView(handleClick);

  function handleClick(square: Square | null): void {
    if (square === null || square === selected || !selectableAt(position, square)) {
      selected = null;
    } else {
      selected = square;
    }
    render();
  }

  function render(): void {
    view.update({
      position,
      selected,
      targets: selected === null ? [] : targetsFor(position, selected),
    });
  }

  render();
  return { element: view.element };
}

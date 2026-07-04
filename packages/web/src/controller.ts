/**
 * Spojení modelu výběru (`selection`) s vykreslením (`board-view`) a lokálním
 * provedením tahu.
 *
 * Drží lokální stav: aktuální pozici (mění se po každém tahu) a rozpracovaný
 * výběr `{ from, path }` – výchozí kámen a už naklikané dopady vícenásobného
 * skoku. Legalitu i dokončení tahu určuje výhradně knihovna `rules`; klient sám
 * nerozhoduje, co je legální. Provedení tahu je zatím lokální (`applyMove`), bez
 * serveru – po tahu je na tahu druhá barva (hot-seat), napojení enginu řeší
 * todo 20.
 *
 * Pravidla kliknutí:
 * - klik na vlastní kámen ho vybere (a případně přepne z jiného výběru),
 * - klik na zvýrazněný další dopad prodlouží sekvenci; jakmile z předpony
 *   nevede další dopad, tah se provede a deska se překreslí,
 * - klik na vybraný kámen, cizí/prázdné pole nebo mimo desku zruší celý výběr.
 */

import { applyMove } from '@checkers/rules';
import type { Position, Square } from '@checkers/rules';

import { createBoardView } from './board-view.js';
import { nextTargets, resolveMove, selectableAt } from './selection.js';

/** Rozpracovaný výběr: výchozí kámen a už naklikané dopady (bez `from`). */
interface Selection {
  readonly from: Square;
  readonly path: readonly Square[];
}

/** Ovládaná deska připravená k vložení do stránky. */
export interface BoardController {
  readonly element: HTMLElement;
}

/** Vytvoří desku nad danou počáteční pozicí. */
export function createBoardController(initial: Position): BoardController {
  let position = initial;
  let selection: Selection | null = null;
  const view = createBoardView(handleClick);

  function handleClick(square: Square | null): void {
    if (square === null) {
      selection = null;
    } else if (selection !== null && isTarget(square)) {
      advance(square);
    } else if (selectableAt(position, square) && !isSelectedFrom(square)) {
      // Nový výběr vlastního kamene (i přepnutí z jiného). Klik na už vybraný
      // výchozí kámen sem nespadne – padá do else a výběr se zruší.
      selection = { from: square, path: [] };
    } else {
      selection = null;
    }
    render();
  }

  /** `true`, pokud `square` je jedním z aktuálně nabízených dalších dopadů. */
  function isTarget(square: Square): boolean {
    return selection !== null && nextTargets(position, selection.from, selection.path).includes(square);
  }

  function isSelectedFrom(square: Square): boolean {
    return selection !== null && selection.from === square;
  }

  /** Prodlouží sekvenci o dopad `square`; když je tah kompletní, provede ho. */
  function advance(square: Square): void {
    if (selection === null) {
      return;
    }
    const path = [...selection.path, square];
    if (nextTargets(position, selection.from, path).length > 0) {
      selection = { from: selection.from, path }; // ještě pokračuje (další dopad/větvení)
      return;
    }
    // Žádné pokračování → sekvence je úplná. resolveMove nesmí vrátit null
    // (rules garantuje, že maximální cesta odpovídá právě jednomu tahu), ale
    // kdyby přesto vrátil, výběr se zruší – nikdy nezamrzneme.
    const move = resolveMove(position, selection.from, path);
    if (move !== null) {
      position = applyMove(position, move);
    }
    selection = null;
  }

  function render(): void {
    view.update(
      selection === null
        ? { position, selected: null, path: [], targets: [] }
        : {
            position,
            selected: selection.from,
            path: selection.path,
            targets: nextTargets(position, selection.from, selection.path),
          },
    );
  }

  render();
  return { element: view.element };
}

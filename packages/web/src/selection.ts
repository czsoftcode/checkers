/**
 * Čistý model výběru a zvýraznění – žádný DOM.
 *
 * Jediným zdrojem legality je knihovna `rules`; klient nikdy sám nerozhoduje,
 * co je legální tah. Povinné braní se tím respektuje automaticky: když má strana
 * na tahu k dispozici skok, `legalMoves` prosté tahy vůbec nevrátí, takže se
 * ani nezvýrazní.
 */

import { legalMoves } from '@checkers/rules';
import type { Cell, Position, Square } from '@checkers/rules';

/** Obsah pole `square` (1–32), nebo `null` mimo rozsah i pro prázdné pole. */
function cellAt(position: Position, square: Square): Cell {
  if (!Number.isInteger(square) || square < 1 || square > position.board.length) {
    return null;
  }
  return position.board[square - 1] ?? null;
}

/**
 * `true`, pokud na poli stojí kámen strany, která je na tahu (jen ten lze
 * vybrat). Prázdné pole, kámen soupeře i pole mimo desku vrací `false`.
 */
export function selectableAt(position: Position, square: Square): boolean {
  const cell = cellAt(position, square);
  return cell !== null && cell.color === position.turn;
}

/**
 * Cílová pole legálních tahů z daného pole – pro každý tah jeho **první dopad**
 * (`path[0]`). U prostého tahu je to cílové pole, u skoku první pole dopadu;
 * doklikávání celé sekvence vícenásobného skoku řeší až todo 19.
 *
 * Vrací prázdné pole, pokud z pole žádný legální tah nevede (včetně případu, kdy
 * strana musí brát jiným kamenem – povinné braní).
 */
export function targetsFor(position: Position, square: Square): Square[] {
  const targets: Square[] = [];
  for (const move of legalMoves(position)) {
    if (move.from !== square) {
      continue;
    }
    const first = move.path[0];
    if (first !== undefined && !targets.includes(first)) {
      targets.push(first);
    }
  }
  return targets;
}

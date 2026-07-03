/**
 * Evaluace v1 – čistá funkce pozice → skóre z pohledu strany na tahu.
 *
 * Skóre je vždy CELÉ číslo (na celočíselnosti stojí sběr remízových tahů
 * v search.ts – okno `best - 1`). Kladné = strana na tahu stojí lépe.
 *
 * Složky (rozhodnutí fáze 14, kalibrace síly přijde ve fázi „síla pro cíl"):
 * - materiál: muž 100, dáma 130,
 * - zadní řada: muž stojící na vlastní zadní řadě hlídá proti proměně (+8),
 * - postup: drobný bonus za každou řadu, o kterou muž postoupil (+1/řada),
 *   aby engine v klidných pozicích tlačil vpřed místo přešlapování.
 *
 * Dáma poziční bonusy nemá – mobilitu a kontrolu dvojitého rohu řeší až v2
 * evaluace. Evaluace NEVIDÍ remízová pravidla (čítač půltahů, opakování) –
 * hodnotí jedinou pozici bez historie.
 */

import { BOARD_SQUARES, squareToCoords } from '@checkers/rules';
import type { Color, Position } from '@checkers/rules';

/** Hodnota muže. */
export const MAN_VALUE = 100;

/** Hodnota dámy. */
export const KING_VALUE = 130;

/** Bonus za muže na vlastní zadní řadě (hlídá pole proměny soupeře). */
export const BACK_ROW_BONUS = 8;

/** Bonus za každou řadu postupu muže směrem k proměně. */
export const ADVANCE_BONUS = 1;

/** Vlastní zadní řada: černý začíná nahoře (řada 0), bílý dole (řada 7). */
const BACK_ROW: Record<Color, number> = { black: 0, white: 7 };

/**
 * Ohodnotí pozici z pohledu STRANY NA TAHU (negamax konvence): kladné
 * skóre = strana na tahu má výhodu. Vrací vždy celé číslo.
 *
 * Poškozenou desku (díra v poli – `undefined`) odmítá RangeError; tiché
 * přeskočení by dvě různě poškozené pozice ohodnotilo stejně a chyba by
 * kaskádovala do výběru tahu.
 */
export function evaluate(position: Position): number {
  let black = 0;
  let white = 0;
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    const cell = position.board[square - 1];
    if (cell === undefined) {
      throw new RangeError(`Poškozená pozice: díra v board na poli ${String(square)}`);
    }
    if (cell === null) {
      continue;
    }
    let value: number;
    if (cell.kind === 'king') {
      value = KING_VALUE;
    } else {
      // Postup se měří od vlastní zadní řady: černý roste s řadou, bílý proti ní.
      const { row } = squareToCoords(square);
      const advance = cell.color === 'black' ? row : 7 - row;
      const backRow = row === BACK_ROW[cell.color] ? BACK_ROW_BONUS : 0;
      value = MAN_VALUE + ADVANCE_BONUS * advance + backRow;
    }
    if (cell.color === 'black') {
      black += value;
    } else {
      white += value;
    }
  }
  // Rozdíl místo negace: `-(black - white)` by u vyrovnané pozice vrátil -0.
  return position.turn === 'black' ? black - white : white - black;
}

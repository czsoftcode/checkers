/**
 * Generátor prostých tahů (bez braní).
 *
 * Americká dáma: muž táhne jen VPŘED o 1 pole, dáma všemi čtyřmi směry,
 * ale také jen o 1 pole – dáma NENÍ dálková (na rozdíl od mezinárodní dámy).
 */

import type { Direction } from './board.js';
import { BOARD_SQUARES, DIR, neighborOf } from './board.js';
import type { Color, Move, PieceKind, Position, Square } from './types.js';

/**
 * Směry postupu muže: černý postupuje od své zadní řady (pole 1–4, nahoře)
 * „na jih" k vyšším číslům, bílý opačně „na sever" k nižším.
 */
const MAN_DIRS: Record<Color, readonly Direction[]> = {
  black: [DIR.SW, DIR.SE],
  white: [DIR.NW, DIR.NE],
};

const ALL_DIRS: readonly Direction[] = [DIR.NW, DIR.NE, DIR.SW, DIR.SE];

function moveDirs(color: Color, kind: PieceKind): readonly Direction[] {
  return kind === 'king' ? ALL_DIRS : MAN_DIRS[color];
}

/**
 * Prosté tahy (bez braní) kamene na daném poli. Vrací prázdné pole, pokud
 * na poli nestojí kámen strany na tahu. Neplatné číslo pole i deska s jinou
 * délkou než 32 vyhazují RangeError – deska se validuje celá na vstupu,
 * jinak by zkrácená deska tiše „polykala" tahy s cílem za jejím koncem.
 */
export function simpleMovesFrom(position: Position, square: Square): Move[] {
  if (position.board.length !== BOARD_SQUARES) {
    throw new RangeError(
      `Poškozená deska: očekávám ${String(BOARD_SQUARES)} polí, ne ${String(position.board.length)}`,
    );
  }
  const cell = position.board[square - 1];
  if (cell === undefined) {
    throw new RangeError(`Neplatné číslo pole: ${String(square)}`);
  }
  if (cell === null) {
    return [];
  }
  if (cell.color !== position.turn) {
    return [];
  }
  const moves: Move[] = [];
  for (const dir of moveDirs(cell.color, cell.kind)) {
    const target = neighborOf(square, dir);
    if (target !== null && position.board[target - 1] === null) {
      moves.push({ from: square, path: [target], captures: [] });
    }
  }
  return moves;
}

/**
 * Všechny prosté tahy strany na tahu, seřazené podle výchozího pole.
 *
 * POZOR: toto NEJSOU legální tahy partie – americká dáma má povinné braní
 * a při existenci skoku prostý tah legální není. Veřejným API pro konzumenty
 * bude až `legalMoves` (další fáze); tohle je stavební blok.
 */
export function generateSimpleMoves(position: Position): Move[] {
  const moves: Move[] = [];
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    moves.push(...simpleMovesFrom(position, square));
  }
  return moves;
}

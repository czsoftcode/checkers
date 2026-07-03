/**
 * Generátor tahů.
 *
 * Americká dáma: muž táhne jen VPŘED o 1 pole, dáma všemi čtyřmi směry,
 * ale také jen o 1 pole – dáma NENÍ dálková (na rozdíl od mezinárodní dámy).
 * Braní je POVINNÉ: existuje-li skok, prostý tah není legální.
 *
 * Veřejné API pro konzumenty je `legalMoves`; ostatní funkce jsou stavební
 * bloky (index balíčku je neexportuje).
 */

import type { Direction } from './board.js';
import { BOARD_SQUARES, DIR, jumpOf, neighborOf } from './board.js';
import type { Cell, Color, Move, PieceKind, Position, Square } from './types.js';

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
 * Obsah pole s validací vstupu. Neplatné číslo pole i deska s jinou délkou
 * než 32 vyhazují RangeError – deska se validuje celá na vstupu, jinak by
 * zkrácená deska tiše „polykala" tahy s cílem za jejím koncem.
 */
function cellAt(position: Position, square: Square): Cell {
  if (position.board.length !== BOARD_SQUARES) {
    throw new RangeError(
      `Poškozená deska: očekávám ${String(BOARD_SQUARES)} polí, ne ${String(position.board.length)}`,
    );
  }
  // Neplatný turn (např. z JSON hranice) by jinak tiše vrátil "žádné tahy",
  // což konzument snadno vyloží jako konec hry.
  if (position.turn !== 'black' && position.turn !== 'white') {
    throw new RangeError(`Neplatná strana na tahu: ${String(position.turn)}`);
  }
  const cell = position.board[square - 1];
  if (cell === undefined) {
    throw new RangeError(`Neplatné číslo pole: ${String(square)}`);
  }
  return cell;
}

/**
 * Prosté tahy (bez braní) kamene na daném poli. Vrací prázdné pole, pokud
 * na poli nestojí kámen strany na tahu.
 *
 * Stavební blok – IGNORUJE povinnost braní, viz `legalMoves`.
 */
export function simpleMovesFrom(position: Position, square: Square): Move[] {
  const cell = cellAt(position, square);
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
 * Jednoduché skoky kamene na daném poli: přes soupeřův kámen na prázdné
 * pole za ním. Muž bere jen vpřed, dáma všemi směry (bere se stejný index
 * směru: přeskakuje se NEIGHBORS[pole][směr], dopad je JUMPS[pole][směr]).
 *
 * DOČASNÉ OMEZENÍ (todo 5): skok končí po jednom braní – pokračování
 * vícenásobné sekvence z pole dopadu se zatím negeneruje. Až se bude psát
 * rekurze, pozor na dvě pravidla: stejný kámen nelze v jedné sekvenci
 * přeskočit dvakrát a muž, který skokem dosáhne dámské řady, tahem KONČÍ
 * (nepokračuje v braní jako dáma) – viz todo 6 (proměna).
 *
 * Stavební blok – veřejné API je `legalMoves`.
 */
export function jumpMovesFrom(position: Position, square: Square): Move[] {
  const cell = cellAt(position, square);
  if (cell === null) {
    return [];
  }
  if (cell.color !== position.turn) {
    return [];
  }
  const moves: Move[] = [];
  for (const dir of moveDirs(cell.color, cell.kind)) {
    const over = neighborOf(square, dir);
    const landing = jumpOf(square, dir);
    if (over === null || landing === null) {
      continue;
    }
    const overCell = position.board[over - 1];
    const landingCell = position.board[landing - 1];
    if (
      overCell !== null &&
      overCell !== undefined &&
      overCell.color !== cell.color &&
      landingCell === null
    ) {
      moves.push({ from: square, path: [landing], captures: [over] });
    }
  }
  return moves;
}

/**
 * Legální tahy strany na tahu – jediné veřejné API generátoru.
 *
 * Braní je povinné: existuje-li skok KTERÉKOLI figury strany na tahu,
 * vrací se jen skoky (všech figur, které je mají) a žádný prostý tah.
 * Teprve když žádný skok neexistuje, vrací se prosté tahy.
 *
 * DOČASNÉ OMEZENÍ (todo 5): skoky jsou zatím jen jednoduché (jedno braní).
 */
export function legalMoves(position: Position): Move[] {
  const jumps: Move[] = [];
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    jumps.push(...jumpMovesFrom(position, square));
  }
  if (jumps.length > 0) {
    return jumps;
  }
  return generateSimpleMoves(position);
}

/**
 * Všechny prosté tahy strany na tahu, seřazené podle výchozího pole.
 *
 * Stavební blok – IGNORUJE povinnost braní, viz `legalMoves`.
 */
export function generateSimpleMoves(position: Position): Move[] {
  const moves: Move[] = [];
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    moves.push(...simpleMovesFrom(position, square));
  }
  return moves;
}

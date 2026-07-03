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
import { ALL_DIRS, BOARD_SQUARES, DIR, jumpOf, neighborOf } from './board.js';
import type { Cell, Color, Move, Piece, PieceKind, Position, Square } from './types.js';

/**
 * Směry postupu muže: černý postupuje od své zadní řady (pole 1–4, nahoře)
 * „na jih" k vyšším číslům, bílý opačně „na sever" k nižším.
 */
const MAN_DIRS: Record<Color, readonly Direction[]> = {
  black: [DIR.SW, DIR.SE],
  white: [DIR.NW, DIR.NE],
};

function moveDirs(color: Color, kind: PieceKind): readonly Direction[] {
  return kind === 'king' ? ALL_DIRS : MAN_DIRS[color];
}

/**
 * Obsah pole s validací vstupu. Neplatné číslo pole i deska s jinou délkou
 * než 32 vyhazují RangeError. Validuje se délka desky a DOTAZOVANÉ pole –
 * díra (undefined) na jiném poli řídkého pole projde a generátor s ní
 * zachází konzervativně jako s obsazeným polem / kamenem, který nejde brát.
 * Přes `legalMoves` díra vyhodí RangeError vždy (iteruje všech 32 polí);
 * řídké pole navíc nevznikne z JSON (undefined v něm neexistuje).
 *
 * Interní helper sdílený s apply.ts – index balíčku ho neexportuje.
 */
export function cellAt(position: Position, square: Square): Cell {
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
 * Skokové sekvence kamene na daném poli: přes soupeřův kámen na prázdné
 * pole hned za ním (stejný index směru: přeskakuje se NEIGHBORS[pole][směr],
 * dopad je JUMPS[pole][směr]), muž bere jen vpřed, dáma všemi směry.
 *
 * Braní pokračuje rekurzivně z pole dopadu, dokud existuje další skok –
 * uprostřed větve skončit nejde. Větvení z jednoho dopadu vrací každou
 * maximální větev jako samostatný tah; volba KRATŠÍ větve z rozcestí je
 * legální (americká dáma nevyžaduje maximum braní).
 *
 * Rekurze běží nad pracovní kopií desky: skákající kámen se posouvá
 * (origin se uvolní – kruhová sekvence dámy se smí vrátit i na `from`)
 * a přeskočený kámen se hned odebírá, takže stejný kámen nelze přeskočit
 * dvakrát. Okamžité odebrání vs. odebrání na konci tahu množinu tahů
 * nemění: dopadová a přeskakovaná pole se nikdy nepotkají (dopady jsou od
 * startu o sudý počet řad i sloupců, přeskočené kameny o lichý).
 *
 * Proměna (todo 6): muž, který skokem dosáhne dámské řady, tahem KONČÍ –
 * tady to platí přirozeně (muž nemá z poslední řady skok vpřed); fáze
 * proměny to učiní explicitním v applyMove.
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
  const board = [...position.board];
  // Kámen je „ve vzduchu" – origin se uvolní pro případný kruhový návrat.
  board[square - 1] = null;
  const moves: Move[] = [];
  extendJumps(board, cell, square, square, [], [], moves);
  return moves;
}

/**
 * DFS pokračování skokové sekvence z pole `current`. Nemůže-li sekvence
 * pokračovat žádným směrem a aspoň jedno braní už proběhlo, je to list =
 * hotový tah. Pracovní deska se mutuje a po návratu vrací zpět.
 */
function extendJumps(
  board: Cell[],
  piece: Piece,
  from: Square,
  current: Square,
  path: Square[],
  captures: Square[],
  out: Move[],
): void {
  let extended = false;
  for (const dir of moveDirs(piece.color, piece.kind)) {
    const over = neighborOf(current, dir);
    const landing = jumpOf(current, dir);
    if (over === null || landing === null) {
      continue;
    }
    const overCell = board[over - 1];
    if (overCell === null || overCell === undefined || overCell.color === piece.color) {
      continue;
    }
    if (board[landing - 1] !== null) {
      continue;
    }
    extended = true;
    board[over - 1] = null;
    path.push(landing);
    captures.push(over);
    extendJumps(board, piece, from, landing, path, captures, out);
    captures.pop();
    path.pop();
    board[over - 1] = overCell;
  }
  if (!extended && path.length > 0) {
    out.push({ from, path: [...path], captures: [...captures] });
  }
}

/**
 * Legální tahy strany na tahu – jediné veřejné API generátoru.
 *
 * Braní je povinné: existuje-li skok KTERÉKOLI figury strany na tahu,
 * vrací se jen skoky (všech figur, které je mají) a žádný prostý tah.
 * Teprve když žádný skok neexistuje, vrací se prosté tahy. Skoky jsou
 * úplné sekvence (vícenásobné braní) – viz `jumpMovesFrom`.
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

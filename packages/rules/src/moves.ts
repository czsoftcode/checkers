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
import {
  ALL_DIRS,
  BOARD_SQUARES,
  DIR,
  PROMOTION_ROW,
  jumpOf,
  neighborOf,
  squareToCoords,
} from './board.js';
import { AMERICAN_RULESET } from './ruleset.js';
import type { Ruleset } from './ruleset.js';
import type { Cell, Color, Move, Piece, PieceKind, Position, Square } from './types.js';

/**
 * Směry postupu muže: černý postupuje od své zadní řady (pole 1–4, nahoře)
 * „na jih" k vyšším číslům, bílý opačně „na sever" k nižším.
 */
const MAN_DIRS: Record<Color, readonly Direction[]> = {
  black: [DIR.SW, DIR.SE],
  white: [DIR.NW, DIR.NE],
};

/**
 * Směry PROSTÉHO tahu (bez braní). Muž táhne vždy jen vpřed – braní vzad
 * (u variant, kde je) mění jen SKOK, ne prostý tah. Dáma `'short'` táhne
 * všemi směry o 1 pole jako dnes.
 */
function simpleMoveDirs(color: Color, kind: PieceKind): readonly Direction[] {
  return kind === 'king' ? ALL_DIRS : MAN_DIRS[color];
}

/**
 * Směry BRANÍ. U muže řídí Ruleset: `manCaptureBackward` povolí i skok vzad
 * (všechny směry), jinak jen vpřed jako americká dáma. Dáma `'short'` bere
 * všemi směry o 1 pole. Toto je jediný seam, kde se Ruleset dnes reálně
 * projeví – pro AMERICAN_RULESET je chování identické s předchozím kódem.
 */
function captureDirs(color: Color, kind: PieceKind, ruleset: Ruleset): readonly Direction[] {
  if (kind === 'king') {
    return ALL_DIRS;
  }
  return ruleset.manCaptureBackward ? ALL_DIRS : MAN_DIRS[color];
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
 * Létavá dáma (`ruleset.king === 'flying'`) KLOUŽE: po každé diagonále jde
 * přes prázdná pole, dokud nenarazí na kámen (vlastní i cizí) nebo okraj –
 * každé volné pole na cestě je samostatný dopad. Muž i dáma `'short'` táhnou
 * jako dnes o 1 pole. Braní řeší `jumpMovesFrom`, ne tato funkce.
 *
 * Stavební blok – IGNORUJE povinnost braní, viz `legalMoves`.
 */
export function simpleMovesFrom(
  position: Position,
  square: Square,
  ruleset: Ruleset = AMERICAN_RULESET,
): Move[] {
  const cell = cellAt(position, square);
  if (cell === null) {
    return [];
  }
  if (cell.color !== position.turn) {
    return [];
  }
  const moves: Move[] = [];
  const flying = cell.kind === 'king' && ruleset.king === 'flying';
  for (const dir of simpleMoveDirs(cell.color, cell.kind)) {
    if (flying) {
      // Klouže o krok, dokud jsou pole prázdná; první kámen/okraj zastaví.
      let current: Square | null = square;
      while ((current = neighborOf(current, dir)) !== null) {
        if (position.board[current - 1] !== null) {
          break;
        }
        moves.push({ from: square, path: [current], captures: [] });
      }
    } else {
      const target = neighborOf(square, dir);
      if (target !== null && position.board[target - 1] === null) {
        moves.push({ from: square, path: [target], captures: [] });
      }
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
 * VÝJIMKA – létavá dáma (`ruleset.king === 'flying'`): tato krok-2 cesta
 * s okamžitým odebráním pro ni NEPLATÍ (paritní argument drží jen pro krok-2
 * skok, ne pro klouzání – pozdější dlouhý segment by přejel přes dřív brané
 * pole). Létavá dáma se proto routuje do `extendFlyingKingJumps`, které drží
 * brané kameny na desce jako blokery (turecký úder). Muž i krátká dáma jedou
 * touto starou cestou beze změny.
 *
 * Proměna (todo 6): muž, který skokem dosáhne dámské řady, tahem KONČÍ –
 * tady to platí přirozeně (muž nemá z poslední řady skok vpřed); fáze
 * proměny to učiní explicitním v applyMove.
 *
 * Stavební blok – veřejné API je `legalMoves`.
 */
export function jumpMovesFrom(
  position: Position,
  square: Square,
  ruleset: Ruleset = AMERICAN_RULESET,
): Move[] {
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
  const flying = cell.kind === 'king' && ruleset.king === 'flying';
  if (flying) {
    // Létavá dáma má vlastní klouzavou cestu s tureckým úderem (brané kameny
    // zůstávají na desce jako blokery až do konce sekvence). Stará cesta se
    // NEDOTÝKÁ, aby americká čísla i pořadí tahů zůstala bajt-identická.
    extendFlyingKingJumps(board, cell, square, square, [], [], moves);
  } else if (cell.kind === 'man' && ruleset.promoteMidCapture) {
    // Ruský muž: turecko-úderová krok-2 cesta (keep-as-blocker), a jakmile
    // dopadne na proměnnou řadu, přechází UPROSTŘED sekvence na létavou dámu.
    // Pool muž (promoteMidCapture=false) i americká zůstávají na `extendJumps`.
    extendRussianManJumps(board, cell, square, square, [], [], moves, ruleset);
  } else {
    extendJumps(board, cell, square, square, [], [], moves, ruleset);
  }
  return moves;
}

/**
 * DFS klouzavého braní létavé dámy z pole `current` (turecký úder).
 *
 * V každém ze čtyř směrů dáma KLOUŽE přes prázdná pole až k PRVNÍMU obsazenému.
 * Je-li to soupeřův kámen, který v TOMTO tahu ještě nebyl brán (není v
 * `captures`), a je za ním aspoň jedno prázdné pole, vzniká větev pro KAŽDÉ
 * takové prázdné pole dopadu (dokud nenarazí na další obsazené pole nebo okraj);
 * z každého dopadu se rekurzivně pokračuje.
 *
 * TURECKÝ ÚDER: brané kameny se NEODEBÍRAJÍ z pracovní desky – zůstávají jako
 * překážky, takže je nelze přeskočit ani přes ně dopadnout znovu a členství
 * v `captures` brání jejich dvojímu braní. Skutečné odebrání dělá až apply.ts
 * na konci celé sekvence (zrcadlově). Origin je uvolněn (v `jumpMovesFrom`),
 * proto se dáma smí kruhově vrátit i na výchozí pole.
 *
 * Terminace: každá větev přidá do `captures` nový kámen (monotónně roste),
 * dřív braný kámen blokuje, takže hloubka je shora omezená počtem soupeřových
 * kamenů – cyklus se uzavřít nemůže.
 */
function extendFlyingKingJumps(
  board: Cell[],
  piece: Piece,
  from: Square,
  current: Square,
  path: Square[],
  captures: Square[],
  out: Move[],
): void {
  let extended = false;
  for (const dir of ALL_DIRS) {
    // Klouzej k prvnímu obsazenému poli v tomto směru.
    let over: Square | null = current;
    while ((over = neighborOf(over, dir)) !== null && board[over - 1] === null) {
      // prázdné pole – pokračuj v klouzání
    }
    if (over === null) {
      continue; // došli jsme na okraj, žádný kámen k braní
    }
    const overCell = board[over - 1];
    // overCell tu nemůže být null (smyčka končí až na obsazeném poli); guard
    // drží i pro řídkou desku (undefined) – ta se chová jako neprůchodná.
    if (overCell === null || overCell === undefined || overCell.color === piece.color) {
      continue; // vlastní kámen (nebo díra) blokuje – v tomto směru nic
    }
    if (captures.includes(over)) {
      continue; // už braný kámen (turecký úder) blokuje a nebere se dvakrát
    }
    // Za soupeřem: každé prázdné pole je samostatný dopad, dokud další
    // obsazené pole nebo okraj klouzání neukončí.
    let landing: Square | null = over;
    while ((landing = neighborOf(landing, dir)) !== null && board[landing - 1] === null) {
      extended = true;
      path.push(landing);
      captures.push(over);
      extendFlyingKingJumps(board, piece, from, landing, path, captures, out);
      captures.pop();
      path.pop();
    }
  }
  if (!extended && path.length > 0) {
    out.push({ from, path: [...path], captures: [...captures] });
  }
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
  ruleset: Ruleset,
): void {
  // Muž, který během braní dosáhl proměnné řady, tahem KONČÍ – proměna ukončuje
  // sekvenci (pool checkers, APCA: „turns into a king and stops, even if it is
  // possible to continue the capture"). Americká dáma to drží přirozeně (muž
  // bere jen vpřed, z poslední řady skok vpřed není), ale pool bere i vzad –
  // bez této zarážky by muž nelegálně pokračoval jako muž přes dámskou řadu.
  // (Ruská proměna uprostřed braní = pokračovat jako DÁMA je jiný, zatím
  // neimplementovaný režim; ta by tuto zarážku nahradila přepnutím na dámu.)
  if (
    piece.kind === 'man' &&
    path.length > 0 &&
    squareToCoords(current).row === PROMOTION_ROW[piece.color]
  ) {
    out.push({ from, path: [...path], captures: [...captures] });
    return;
  }
  let extended = false;
  for (const dir of captureDirs(piece.color, piece.kind, ruleset)) {
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
    extendJumps(board, piece, from, landing, path, captures, out, ruleset);
    captures.pop();
    path.pop();
    board[over - 1] = overCell;
  }
  if (!extended && path.length > 0) {
    out.push({ from, path: [...path], captures: [...captures] });
  }
}

/**
 * DFS skokové sekvence RUSKÉHO muže (proměna uprostřed braní + turecký úder).
 *
 * Muž bere krok-2 obousměrně (`captureDirs` s `manCaptureBackward`), ale na
 * rozdíl od `extendJumps` brané kameny NEODEBÍRÁ z pracovní desky – drží je
 * jako blokery (turecký úder), stejně jako `extendFlyingKingJumps`. To je
 * nutné, protože po proměně uprostřed sekvence by pozdější klouzavý segment
 * dámy mohl přejet přes pole, kde muž předtím bral; ponechaný bloker to
 * zakáže. Dvojímu braní téhož kamene brání členství v `captures`.
 *
 * PROMĚNA: jakmile muž DOPADNE na proměnnou řadu (`path.length > 0` a řada =
 * `PROMOTION_ROW`), přestává být mužem a zbytek sekvence z tohoto pole se
 * generuje jako LÉTAVÁ DÁMA přes `extendFlyingKingJumps` (piece = king).
 * Delegace přebírá i tvorbu listu (pole nemá žádné další man-pokračování),
 * takže nevznikne dvojitý list ani man-pokračování přes dámskou řadu.
 *
 * Terminace: `captures` monotónně roste (dřív braný kámen blokuje), hloubka je
 * shora omezená počtem soupeřových kamenů – i po přechodu na dámu (viz
 * terminace `extendFlyingKingJumps`).
 */
function extendRussianManJumps(
  board: Cell[],
  piece: Piece,
  from: Square,
  current: Square,
  path: Square[],
  captures: Square[],
  out: Move[],
  ruleset: Ruleset,
): void {
  // Dopad na proměnnou řadu uprostřed braní: HNED se stává létavou dámou.
  // Zbytek sekvence (i případný list) obstará klouzavá cesta – žádné další
  // man-pokračování z tohoto pole, žádný vlastní list zde (jinak dvojitý).
  if (path.length > 0 && squareToCoords(current).row === PROMOTION_ROW[piece.color]) {
    const king: Piece = { color: piece.color, kind: 'king' };
    extendFlyingKingJumps(board, king, from, current, path, captures, out);
    return;
  }
  let extended = false;
  for (const dir of captureDirs(piece.color, 'man', ruleset)) {
    const over = neighborOf(current, dir);
    const landing = jumpOf(current, dir);
    if (over === null || landing === null) {
      continue;
    }
    const overCell = board[over - 1];
    if (overCell === null || overCell === undefined || overCell.color === piece.color) {
      continue;
    }
    // Turecký úder: dřív braný kámen (stále na desce) blokuje a nebere se dvakrát.
    if (captures.includes(over)) {
      continue;
    }
    // Dopad musí být volný – bloker (dřív braný kámen) tu leží dál a zabrání dopadu.
    if (board[landing - 1] !== null) {
      continue;
    }
    extended = true;
    // Keep-as-blocker: braný kámen se NEnuluje (na rozdíl od `extendJumps`).
    path.push(landing);
    captures.push(over);
    extendRussianManJumps(board, piece, from, landing, path, captures, out, ruleset);
    captures.pop();
    path.pop();
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
export function legalMoves(position: Position, ruleset: Ruleset = AMERICAN_RULESET): Move[] {
  const jumps: Move[] = [];
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    jumps.push(...jumpMovesFrom(position, square, ruleset));
  }
  if (jumps.length > 0) {
    return jumps;
  }
  return generateSimpleMoves(position, ruleset);
}

/**
 * Všechny prosté tahy strany na tahu, seřazené podle výchozího pole.
 *
 * Stavební blok – IGNORUJE povinnost braní, viz `legalMoves`.
 */
export function generateSimpleMoves(
  position: Position,
  ruleset: Ruleset = AMERICAN_RULESET,
): Move[] {
  const moves: Move[] = [];
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    moves.push(...simpleMovesFrom(position, square, ruleset));
  }
  return moves;
}

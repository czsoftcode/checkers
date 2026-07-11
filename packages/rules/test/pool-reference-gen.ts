/**
 * NEZÁVISLÁ druhá implementace generátoru legálních tahů pro POOL CHECKERS.
 *
 * Účel: cross-check proti `moves.ts` přes perft (počet listů stromu). Aby chytla
 * i chyby, které by sdílel „stejný mozek", je záměrně postavená JINAK než knihovna:
 *  - pracuje v souřadnicích (row, col) na plné mřížce 8×8, NE nad číslováním polí
 *    1–32 ani nad předpočítanými tabulkami NEIGHBORS/JUMPS,
 *  - má vlastní aplikaci tahu (produkuje rovnou NÁSLEDNICKÉ POZICE), nezávislou
 *    na `apply.ts`,
 *  - braní řeší tureckým úderem přes „blokery" (brané kameny zůstávají na desce
 *    do konce sekvence) UNIFORMNĚ pro muže i dámu – neopírá se o paritní argument
 *    z `moves.ts` (okamžité odebrání u muže).
 *
 * Pravidla pool (APCA / Wikipedia American Pool Checkers):
 *  - muž bere vpřed i VZAD; prostý tah muže jen vpřed o 1,
 *  - dáma je LÉTAVÁ (klouže po diagonále, volba dopadu, turecký úder),
 *  - braní je POVINNÉ, ale NE maximální (volba kratší větve legální),
 *  - muž, který během braní dosáhne dámské řady, se proměd na dámu a KONČÍ tah
 *    (nepokračuje – tím se pool liší od ruské).
 *
 * Porovnává se jen POČET listů (perft), ne konkrétní tahy – reprezentace se
 * schválně liší, takže srovnávat tvar Move nelze ani nedává smysl.
 */

import type { Color, Position } from '../src/index.js';
import { squareToCoords } from '../src/index.js';

type RefCell = { readonly color: Color; readonly king: boolean } | null;
type Grid = RefCell[][]; // [row][col], 8×8

/** Pozice nezávislé implementace: mřížka 8×8 a strana na tahu. */
export interface RefPos {
  readonly grid: Grid;
  readonly turn: Color;
}

const N = 8;
const DIRS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function emptyGrid(): Grid {
  return Array.from({ length: N }, () => Array.from({ length: N }, (): RefCell => null));
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < N && c >= 0 && c < N;
}

/** Čtení buňky (jen pro pole v mezích – jinak vrací null). */
function at(grid: Grid, r: number, c: number): RefCell {
  return grid[r]?.[c] ?? null;
}

/** Zápis buňky (řada 0–7 vždy existuje). */
function put(grid: Grid, r: number, c: number, v: RefCell): void {
  grid[r]![c] = v;
}

function opp(c: Color): Color {
  return c === 'black' ? 'white' : 'black';
}

/** Dámská (proměnná) řada: černý postupuje dolů (řada 7), bílý nahoru (řada 0). */
function promoRow(c: Color): number {
  return c === 'black' ? 7 : 0;
}

/** Směry PROSTÉHO tahu muže (jen vpřed): černý dolů, bílý nahoru. */
function forwardDirs(c: Color): readonly (readonly [number, number])[] {
  return c === 'black'
    ? [
        [1, -1],
        [1, 1],
      ]
    : [
        [-1, -1],
        [-1, 1],
      ];
}

function clone(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/**
 * Převede knihovní `Position` (řídké pole 1–32) na mřížku nezávislé implementace.
 * Používá `squareToCoords` jen k FYZICKÉMU umístění kamenů – logika generování
 * tahů dál žádné knihovní číslování ani tabulky nepoužívá.
 */
export function fromPosition(pos: Position): RefPos {
  const grid = emptyGrid();
  for (let s = 1; s <= 32; s++) {
    const cell = pos.board[s - 1];
    if (cell) {
      const { row, col } = squareToCoords(s);
      grid[row]![col] = { color: cell.color, king: cell.kind === 'king' };
    }
  }
  return { grid, turn: pos.turn };
}

function makeSuccessor(
  orig: Grid,
  startR: number,
  startC: number,
  finalR: number,
  finalC: number,
  captured: readonly (readonly [number, number])[],
  piece: { color: Color; king: boolean },
): RefPos {
  const g = clone(orig);
  put(g, startR, startC, null);
  for (const [cr, cc] of captured) {
    put(g, cr, cc, null);
  }
  const promotes = !piece.king && finalR === promoRow(piece.color);
  put(g, finalR, finalC, { color: piece.color, king: piece.king || promotes });
  return { grid: g, turn: opp(piece.color) };
}

function alreadyCaptured(
  captured: readonly (readonly [number, number])[],
  r: number,
  c: number,
): boolean {
  return captured.some(([xr, xc]) => xr === r && xc === c);
}

function dfsCapture(
  work: Grid,
  orig: Grid,
  piece: { color: Color; king: boolean },
  startR: number,
  startC: number,
  curR: number,
  curC: number,
  captured: [number, number][],
  succ: RefPos[],
  manPromotesStop: boolean,
  midPromote: boolean,
): void {
  // Muž, který během braní dopadne na dámskou řadu:
  //  - RUSKÁ (`midPromote=true`): HNED se stává létavou dámou a pokračuje
  //    (může-li) v braní letmo – jen přepneme `piece.king` a padáme dál do
  //    smyčky, kde už jede klouzavá větev. Finální kámen bude dáma (viz níže).
  //  - POOL (`manPromotesStop=true`): braním KONČÍ (proměna ukončuje tah).
  //  - MĚŘENÍ (`manPromotesStop=false`, `midPromote=false`): zarážka vypnutá,
  //    muž pokračuje jako muž – slouží jen k důkazu, že fix má na perftu zuby.
  let effPiece = piece;
  if (!piece.king && captured.length > 0 && curR === promoRow(piece.color)) {
    if (midPromote) {
      effPiece = { color: piece.color, king: true };
      // padáme dál – zbytek sekvence se generuje jako létavá dáma z tohoto pole
    } else if (manPromotesStop) {
      succ.push(makeSuccessor(orig, startR, startC, curR, curC, captured, piece));
      return;
    }
    // jinak (měření): effPiece zůstává muž
  }
  let extended = false;
  for (const [dr, dc] of DIRS) {
    if (effPiece.king) {
      // Klouzej k prvnímu obsazenému poli.
      let rr = curR + dr;
      let cc = curC + dc;
      while (inBounds(rr, cc) && at(work, rr, cc) === null) {
        rr += dr;
        cc += dc;
      }
      if (!inBounds(rr, cc)) {
        continue;
      }
      const overCell = at(work, rr, cc);
      if (overCell === null || overCell.color === effPiece.color) {
        continue;
      }
      if (alreadyCaptured(captured, rr, cc)) {
        continue;
      }
      // Každé prázdné pole za braným kamenem je samostatný dopad.
      let lr = rr + dr;
      let lc = cc + dc;
      while (inBounds(lr, lc) && at(work, lr, lc) === null) {
        extended = true;
        captured.push([rr, cc]);
        dfsCapture(work, orig, effPiece, startR, startC, lr, lc, captured, succ, manPromotesStop, midPromote);
        captured.pop();
        lr += dr;
        lc += dc;
      }
    } else {
      // Muž: skok o 2 pole (vpřed i vzad – pool).
      const or = curR + dr;
      const oc = curC + dc;
      const lr = curR + 2 * dr;
      const lc = curC + 2 * dc;
      if (!inBounds(lr, lc)) {
        continue;
      }
      const overCell = at(work, or, oc);
      if (overCell === null || overCell.color === effPiece.color) {
        continue;
      }
      if (alreadyCaptured(captured, or, oc)) {
        continue;
      }
      if (at(work, lr, lc) !== null) {
        continue; // dopad obsazen (i braným kamenem-blokerem)
      }
      extended = true;
      captured.push([or, oc]);
      dfsCapture(work, orig, effPiece, startR, startC, lr, lc, captured, succ, manPromotesStop, midPromote);
      captured.pop();
    }
  }
  if (!extended && captured.length > 0) {
    // effPiece: u ruské proměny je to už dáma → makeSuccessor postaví dámu
    // i když finální pole není na dámské řadě.
    succ.push(makeSuccessor(orig, startR, startC, curR, curC, captured, effPiece));
  }
}

function captureSuccessors(pos: RefPos, manPromotesStop: boolean, midPromote: boolean): RefPos[] {
  const succ: RefPos[] = [];
  const { grid, turn } = pos;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = at(grid, r, c);
      if (cell?.color !== turn) {
        continue;
      }
      // Pracovní deska: braný kámen se drží jako bloker (turecký úder), skákající
      // kámen je „ve vzduchu" (uvolní start – kruhový návrat dámy je legální).
      const work = clone(grid);
      put(work, r, c, null);
      dfsCapture(
        work,
        grid,
        { color: cell.color, king: cell.king },
        r,
        c,
        r,
        c,
        [],
        succ,
        manPromotesStop,
        midPromote,
      );
    }
  }
  return succ;
}

function simpleSuccessors(pos: RefPos): RefPos[] {
  const succ: RefPos[] = [];
  const { grid, turn } = pos;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = at(grid, r, c);
      if (cell?.color !== turn) {
        continue;
      }
      if (cell.king) {
        for (const [dr, dc] of DIRS) {
          let rr = r + dr;
          let cc = c + dc;
          while (inBounds(rr, cc) && at(grid, rr, cc) === null) {
            const g = clone(grid);
            put(g, r, c, null);
            put(g, rr, cc, cell);
            succ.push({ grid: g, turn: opp(turn) });
            rr += dr;
            cc += dc;
          }
        }
      } else {
        for (const [dr, dc] of forwardDirs(cell.color)) {
          const rr = r + dr;
          const cc = c + dc;
          if (inBounds(rr, cc) && at(grid, rr, cc) === null) {
            const g = clone(grid);
            put(g, r, c, null);
            const promotes = rr === promoRow(cell.color);
            put(g, rr, cc, { color: cell.color, king: promotes });
            succ.push({ grid: g, turn: opp(turn) });
          }
        }
      }
    }
  }
  return succ;
}

/**
 * Legální následnické pozice: povinné braní má přednost, jinak prosté tahy.
 * `manPromotesStop` (default `true` = pool) řídí, zda muž braním na dámské řadě
 * končí; `false` je jen měřicí režim (viz `dfsCapture`). `midPromote` (default
 * `false`) zapíná RUSKÉ chování: muž na dámské řadě se hned mění na dámu a bere
 * dál (přebíjí `manPromotesStop`). Prostý tah je pro pool i ruskou stejný.
 */
export function legalSuccessors(pos: RefPos, manPromotesStop = true, midPromote = false): RefPos[] {
  const captures = captureSuccessors(pos, manPromotesStop, midPromote);
  if (captures.length > 0) {
    return captures;
  }
  return simpleSuccessors(pos);
}

/**
 * Perft nezávislé implementace: počet listů stromu legálních tahů v hloubce
 * `depth`. `midPromote=true` počítá RUSKOU variantu (proměna uprostřed braní).
 */
export function perftRef(
  pos: RefPos,
  depth: number,
  manPromotesStop = true,
  midPromote = false,
): number {
  if (depth === 0) {
    return 1;
  }
  let nodes = 0;
  for (const next of legalSuccessors(pos, manPromotesStop, midPromote)) {
    nodes += perftRef(next, depth - 1, manPromotesStop, midPromote);
  }
  return nodes;
}

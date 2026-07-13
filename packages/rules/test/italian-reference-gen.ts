/**
 * NEZÁVISLÁ druhá implementace generátoru legálních tahů pro ITALSKOU dámu
 * (dama italiana, pravidla FID).
 *
 * Účel: cross-check proti `moves.ts` přes perft (počet listů stromu). Aby chytla
 * i chyby, které by sdílel „stejný mozek", je záměrně postavená JINAK než knihovna:
 *  - pracuje v souřadnicích (row, col) na plné mřížce 8×8, NE nad číslováním polí
 *    1–32 ani nad předpočítanými tabulkami NEIGHBORS/JUMPS,
 *  - má vlastní aplikaci tahu (produkuje rovnou NÁSLEDNICKÉ POZICE), nezávislou
 *    na `apply.ts`,
 *  - braní řeší tureckým úderem přes „blokery" (brané kameny zůstávají na desce
 *    do konce sekvence), vlastní DFS.
 *
 * LIMIT NEZÁVISLOSTI (viz discuss fáze 115): tuto referenci píše TÝŽ autor jako
 * knihovnu, takže je nezávislá pro MECHANIKU (souřadnice, aplikace tahu,
 * počítání, DFS braní), NE pro VÝKLAD pravidla FID č. 7 (kaskáda kvality). Sdílené
 * ŠPATNÉ pochopení kvality (hlavně bod 4 „nejdřív braná dáma") by se v obou kódech
 * shodlo na stejném čísle a perft by to NECHYTIL. Správnost kaskády stojí na
 * ručních fixturách (italian-quality-priority.test.ts, italian-fixtures.test.ts),
 * ne na perftu.
 *
 * PRAVIDLA ITALSKÁ (dama italiana, FID):
 *  - muž se hýbe i bere JEN VPŘED (o 1, resp. skok o 2 vpřed),
 *  - dáma je KRÁTKÁ (o 1 pole všemi 4 směry; braní = skok o 2 přes soupeře),
 *  - muž NESMÍ brát (přeskočit) dámu (`manCannotCaptureKing`),
 *  - braní je POVINNÉ,
 *  - MAXIMUM braných kamenů je povinné (kvantita),
 *  - KVALITATIVNÍ kaskáda FID nad max-množinou: (2) bere-li dáma, mužovy tahy
 *    zmizí; (3) nejvíc braných dam; (4) nejdřív braná dáma (index v sekvenci),
 *  - proměna až NA KONCI tahu: muž, který braním dopadne na dámskou řadu, se
 *    proměd a KONČÍ (nepokračuje jako dáma – geometricky ani nemůže, muž bere
 *    jen vpřed a vpřed z dámské řady je mimo desku).
 *
 * Porovnává se jen POČET listů (perft), ne konkrétní tahy – reprezentace se
 * schválně liší.
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

/** Jeden brany kámen v sekvenci: pozice + zda to byla dáma (pro FID kvalitu). */
interface Captured {
  readonly r: number;
  readonly c: number;
  readonly king: boolean;
}

/** Kandidát na braní: následnická pozice + metriky pro max-filtr a FID kaskádu. */
interface CaptureSeq {
  readonly successor: RefPos;
  /** Brané kameny V POŘADÍ sekvence (index = kdy v sekvenci padl). */
  readonly captured: readonly Captured[];
  /** Druh táhnoucí figury (konstantní – italská nemá proměnu uprostřed braní). */
  readonly moverKing: boolean;
}

const N = 8;
const ALL_DIRS: readonly (readonly [number, number])[] = [
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

function at(grid: Grid, r: number, c: number): RefCell {
  return grid[r]?.[c] ?? null;
}

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

/** Směry braní/pohybu muže (jen vpřed): černý dolů, bílý nahoru. */
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
  captured: readonly Captured[],
  piece: { color: Color; king: boolean },
): RefPos {
  const g = clone(orig);
  put(g, startR, startC, null);
  for (const cap of captured) {
    put(g, cap.r, cap.c, null);
  }
  const promotes = !piece.king && finalR === promoRow(piece.color);
  put(g, finalR, finalC, { color: piece.color, king: piece.king || promotes });
  return { grid: g, turn: opp(piece.color) };
}

function alreadyCaptured(captured: readonly Captured[], r: number, c: number): boolean {
  return captured.some((x) => x.r === r && x.c === c);
}

/**
 * DFS braní z pole (curR,curC). `work` drží brané kameny jako blokery (turecký
 * úder), `orig` je výchozí deska pro stavbu následníka. `captured` je aktuální
 * sekvence (v pořadí). Do `out` se ukládají KOMPLETNÍ sekvence (maximální větve –
 * kde už braní pokračovat nemůže).
 */
function dfsCapture(
  work: Grid,
  orig: Grid,
  piece: { color: Color; king: boolean },
  startR: number,
  startC: number,
  curR: number,
  curC: number,
  captured: Captured[],
  out: CaptureSeq[],
): void {
  // Muž na dámské řadě uprostřed braní se proměd a KONČÍ (italská = pool „stop").
  // Geometricky navíc muž bere jen vpřed a vpřed z dámské řady je mimo desku,
  // takže by stejně nepokračoval – zarážka je tu explicitně kvůli jasnosti.
  if (!piece.king && captured.length > 0 && curR === promoRow(piece.color)) {
    out.push({
      successor: makeSuccessor(orig, startR, startC, curR, curC, captured, piece),
      captured: captured.slice(),
      moverKing: false,
    });
    return;
  }

  const dirs = piece.king ? ALL_DIRS : forwardDirs(piece.color);
  let extended = false;
  for (const [dr, dc] of dirs) {
    // Krátká figura: soused (or,oc), dopad o 2 (lr,lc). Dáma není létavá.
    const or = curR + dr;
    const oc = curC + dc;
    const lr = curR + 2 * dr;
    const lc = curC + 2 * dc;
    if (!inBounds(lr, lc)) {
      continue;
    }
    const overCell = at(work, or, oc);
    if (overCell === null || overCell.color === piece.color) {
      continue;
    }
    // Muž NESMÍ brát dámu (italská manCannotCaptureKing).
    if (!piece.king && overCell.king) {
      continue;
    }
    if (alreadyCaptured(captured, or, oc)) {
      continue;
    }
    if (at(work, lr, lc) !== null) {
      continue; // dopad obsazen (i braným kamenem-blokerem)
    }
    extended = true;
    captured.push({ r: or, c: oc, king: overCell.king });
    dfsCapture(work, orig, piece, startR, startC, lr, lc, captured, out);
    captured.pop();
  }
  if (!extended && captured.length > 0) {
    out.push({
      successor: makeSuccessor(orig, startR, startC, curR, curC, captured, piece),
      captured: captured.slice(),
      moverKing: piece.king,
    });
  }
}

/** Všechny KOMPLETNÍ sekvence braní (před max/kvalita filtrem). */
function allCaptureSeqs(pos: RefPos): CaptureSeq[] {
  const out: CaptureSeq[] = [];
  const { grid, turn } = pos;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = at(grid, r, c);
      if (cell?.color !== turn) {
        continue;
      }
      const work = clone(grid);
      put(work, r, c, null); // skákající kámen je „ve vzduchu"
      dfsCapture(work, grid, { color: cell.color, king: cell.king }, r, c, r, c, [], out);
    }
  }
  return out;
}

/**
 * FID kaskáda kvality NAD max-množinou (italská pravidlo 7, body 2–4).
 * Uspořádaná – další stupeň rozhoduje jen při rovnosti předchozího.
 * Postaveno podle FID textu (VÝKLAD sdílený s knihovnou – viz limit v hlavičce).
 */
function italianFilter(seqs: CaptureSeq[]): CaptureSeq[] {
  // Stupeň 1 (max, KVANTITA): nejvíc braných kamenů.
  const maxCount = Math.max(...seqs.map((s) => s.captured.length));
  const maxSet = seqs.filter((s) => s.captured.length === maxCount);
  // Stupeň 2 – dáma > muž.
  const kingMovers = maxSet.filter((s) => s.moverKing);
  const afterKind = kingMovers.length > 0 ? kingMovers : maxSet;
  // Stupeň 3 – nejvíc braných dam.
  const kingsCaptured = (s: CaptureSeq): number => s.captured.filter((x) => x.king).length;
  const maxKings = Math.max(...afterKind.map(kingsCaptured));
  const afterCount = afterKind.filter((s) => kingsCaptured(s) === maxKings);
  // Stupeň 4 – nejmenší index první brané dámy (Infinity = žádná dáma).
  const firstKingIndex = (s: CaptureSeq): number => {
    const idx = s.captured.findIndex((x) => x.king);
    return idx === -1 ? Infinity : idx;
  };
  const minFirst = Math.min(...afterCount.map(firstKingIndex));
  return afterCount.filter((s) => firstKingIndex(s) === minFirst);
}

/** Prosté (nebrací) tahy: muž o 1 vpřed, krátká dáma o 1 všemi směry. */
function simpleSuccessors(pos: RefPos): RefPos[] {
  const succ: RefPos[] = [];
  const { grid, turn } = pos;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = at(grid, r, c);
      if (cell?.color !== turn) {
        continue;
      }
      const dirs = cell.king ? ALL_DIRS : forwardDirs(cell.color);
      for (const [dr, dc] of dirs) {
        const rr = r + dr;
        const cc = c + dc;
        if (inBounds(rr, cc) && at(grid, rr, cc) === null) {
          const g = clone(grid);
          put(g, r, c, null);
          const promotes = !cell.king && rr === promoRow(cell.color);
          put(g, rr, cc, { color: cell.color, king: cell.king || promotes });
          succ.push({ grid: g, turn: opp(turn) });
        }
      }
    }
  }
  return succ;
}

/**
 * Legální následnické pozice: povinné braní (max + FID kvalita) má přednost,
 * jinak prosté tahy.
 */
export function legalSuccessors(pos: RefPos): RefPos[] {
  const seqs = allCaptureSeqs(pos);
  if (seqs.length > 0) {
    return italianFilter(seqs).map((s) => s.successor);
  }
  return simpleSuccessors(pos);
}

/**
 * Perft nezávislé implementace: počet listů stromu legálních tahů v hloubce
 * `depth`.
 */
export function perftRef(pos: RefPos, depth: number): number {
  if (depth === 0) {
    return 1;
  }
  let nodes = 0;
  for (const next of legalSuccessors(pos)) {
    nodes += perftRef(next, depth - 1);
  }
  return nodes;
}

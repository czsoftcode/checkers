/**
 * Geometrie desky: převod čísla pole 1–32 na souřadnice a zpět
 * a předpočítané tabulky sousedství (NEIGHBORS) a skoků (JUMPS).
 */

import type { Color, Square } from './types.js';

/** Počet hracích polí na desce 8×8 (hraje se jen na tmavých polích). */
export const BOARD_SQUARES = 32;

/**
 * Řada proměny = zadní řada soupeře: černý postupuje dolů a promuje na řadě 7,
 * bílý nahoru a promuje na řadě 0. Jediný zdroj pravdy sdílený `apply.ts`
 * (kde se proměna provede) a `moves.ts` (kde muž braním na této řadě končí).
 */
export const PROMOTION_ROW: Record<Color, number> = { black: 7, white: 0 };

/** Rozměr desky (8×8). */
export const BOARD_SIZE = 8;

/**
 * Souřadnice políčka: `row` 0 je horní řada (strana černého, pole 1–4),
 * `row` 7 dolní řada (strana bílého, pole 29–32). `col` 0 je levý sloupec.
 */
export interface Coords {
  readonly row: number;
  readonly col: number;
}

/** Tmavé (hrací) políčko je to, kde je součet řádku a sloupce lichý. */
export function isDarkSquare(row: number, col: number): boolean {
  // Math.abs kvůli záporným souřadnicím – v JS je (-1) % 2 === -1.
  return Math.abs((row + col) % 2) === 1;
}

function isOnBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Převede číslo pole 1–32 na souřadnice. Mimo rozsah vyhazuje RangeError. */
export function squareToCoords(square: Square): Coords {
  if (!Number.isInteger(square) || square < 1 || square > BOARD_SQUARES) {
    throw new RangeError(`Neplatné číslo pole: ${String(square)}`);
  }
  const index = square - 1;
  const row = Math.floor(index / 4);
  // Sudé řady (0, 2, …) mají tmavá pole na lichých sloupcích,
  // liché řady na sudých – vzor je o jedno políčko posunutý.
  const col = row % 2 === 0 ? (index % 4) * 2 + 1 : (index % 4) * 2;
  return { row, col };
}

/**
 * Převede souřadnice na číslo pole 1–32. Souřadnice mimo desku nebo
 * světlé (nehrací) políčko vyhazují RangeError – žádná tichá hodnota.
 */
export function coordsToSquare(row: number, col: number): Square {
  if (!Number.isInteger(row) || !Number.isInteger(col) || !isOnBoard(row, col)) {
    throw new RangeError(`Souřadnice mimo desku: row=${String(row)}, col=${String(col)}`);
  }
  if (!isDarkSquare(row, col)) {
    throw new RangeError(`Světlé (nehrací) políčko: row=${String(row)}, col=${String(col)}`);
  }
  return row * 4 + Math.floor(col / 2) + 1;
}

/**
 * Indexy směrů, společné pro NEIGHBORS i JUMPS: stejný index = stejný směr.
 * „Sever" (NW, NE) míří k horní řadě (pole 1–4, zadní řada černého),
 * tedy směr postupu bílého muže; „jih" (SW, SE) je směr postupu černého.
 */
export const DIR = { NW: 0, NE: 1, SW: 2, SE: 3 } as const;

/** Index směru 0–3 (viz {@link DIR}). */
export type Direction = (typeof DIR)[keyof typeof DIR];

/** Cíle ve čtyřech směrech v pořadí NW, NE, SW, SE; mimo desku `null`. */
export type DirTargets = readonly [Square | null, Square | null, Square | null, Square | null];

function buildTable(steps: 1 | 2): readonly DirTargets[] {
  const table: DirTargets[] = [];
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    const { row, col } = squareToCoords(square);
    const target = (rowDelta: number, colDelta: number): Square | null => {
      const targetRow = row + rowDelta * steps;
      const targetCol = col + colDelta * steps;
      return isOnBoard(targetRow, targetCol) ? coordsToSquare(targetRow, targetCol) : null;
    };
    // Pořadí musí odpovídat indexům v DIR: NW, NE, SW, SE.
    table.push([target(-1, -1), target(-1, 1), target(1, -1), target(1, 1)]);
  }
  return table;
}

/**
 * `NEIGHBORS[pole - 1][směr]` = sousední tmavé pole o 1 diagonální krok,
 * nebo `null`, když soused leží mimo desku.
 */
export const NEIGHBORS: readonly DirTargets[] = buildTable(1);

/**
 * `JUMPS[pole - 1][směr]` = pole dopadu o 2 diagonální kroky (skok přes
 * `NEIGHBORS[pole - 1][směr]`), nebo `null`, když dopad leží mimo desku.
 */
export const JUMPS: readonly DirTargets[] = buildTable(2);

function lookUp(table: readonly DirTargets[], square: Square, dir: Direction): Square | null {
  const targets = table[square - 1];
  if (targets === undefined) {
    throw new RangeError(`Neplatné číslo pole: ${String(square)}`);
  }
  // Typ Direction za běhu nic nezaručuje (aritmetika, volání z JS) –
  // bez kontroly by targets[dir] vrátilo undefined a tiše kaskádovalo dál.
  if (dir !== DIR.NW && dir !== DIR.NE && dir !== DIR.SW && dir !== DIR.SE) {
    throw new RangeError(`Neplatný index směru: ${String(dir)}`);
  }
  return targets[dir];
}

/** Soused pole v daném směru (viz {@link NEIGHBORS}); validuje pole i směr. */
export function neighborOf(square: Square, dir: Direction): Square | null {
  return lookUp(NEIGHBORS, square, dir);
}

/** Pole dopadu skoku v daném směru (viz {@link JUMPS}); validuje pole i směr. */
export function jumpOf(square: Square, dir: Direction): Square | null {
  return lookUp(JUMPS, square, dir);
}

/** Všechny čtyři směry v pořadí indexů {@link DIR}. */
export const ALL_DIRS: readonly Direction[] = [DIR.NW, DIR.NE, DIR.SW, DIR.SE];

/** True, když `target` je soused `from` o 1 diagonální krok (kterýkoli směr). */
export function isNeighbor(from: Square, target: Square): boolean {
  return ALL_DIRS.some((dir) => NEIGHBORS[from - 1]?.[dir] === target);
}

/**
 * Paprsek diagonály z `from` na `to`: pole od `from` (EXKLUZIVNĚ) po `to`
 * (INKLUZIVNĚ), pokud `to` leží na některé z diagonál z `from`; jinak `null`.
 * Jde po jednotlivých krocích přes {@link neighborOf}, takže výsledek obsahuje
 * i všechna mezipole – volající si je ověří na obsazenost (klouzavá dáma).
 *
 * `null` znamená „nedosažitelné po diagonále": `to` mimo desku, `to === from`,
 * nebo pole neleží na společné diagonále. Neplatné `from` (mimo 1–32) vyhodí
 * RangeError přes `neighborOf` – stejně jako ostatní geometrie v tomto modulu.
 */
export function raySquares(from: Square, to: Square): Square[] | null {
  for (const dir of ALL_DIRS) {
    const squares: Square[] = [];
    let current: Square | null = from;
    while ((current = neighborOf(current, dir)) !== null) {
      squares.push(current);
      if (current === to) {
        return squares;
      }
    }
  }
  return null;
}

/**
 * Najde směr, kterým vede skok z `from` na `landing`, a vrátí přeskakované
 * pole; null, když `landing` není dopad žádného skoku z `from`. Pole mimo
 * 1–32 nevyhazují – prostě žádný skok nenajdou (chování zděděné z tabulek).
 */
export function jumpedSquareBetween(from: Square, landing: Square): Square | null {
  for (const dir of ALL_DIRS) {
    if (JUMPS[from - 1]?.[dir] === landing) {
      return NEIGHBORS[from - 1]?.[dir] ?? null;
    }
  }
  return null;
}

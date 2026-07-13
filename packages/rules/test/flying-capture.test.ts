import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position, Ruleset } from '../src/index.js';
import { applyMove, legalMoves } from '../src/index.js';

/**
 * Golden testy KLOUZAVÉHO braní létavé dámy (fáze 95).
 *
 * Zdroj pravdy = pool výklad flying braní (bere letmo, muž i dozadu, žádná
 * priorita/maximum, turecký úder) zapsaný NATVRDO do POOL_RULESET a do
 * očekávaných hodnot. Každý test jede přes REÁLNÝ kód OBOU stran kontraktu:
 * `legalMoves` (generátor) → `applyMove` (validátor) → kontrola výsledné desky.
 * Neasertuje se přes notaci (formatMove/parseMove je mimo řez, fáze B2b).
 */

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

/** Obsazená pole výsledné desky jako `"<pole><barva><druh>"`, seřazená. */
function occupied(position: Position): string[] {
  return position.board
    .map((cell, i) => (cell ? `${String(i + 1)}${cell.color[0]}${cell.kind[0]}` : null))
    .filter((x): x is string => x !== null)
    .sort();
}

/** Serializace tahu pro porovnání množin (path|captures). */
function moveKey(move: Move): string {
  return `${move.path.join(',')}|${move.captures.join(',')}`;
}

const BLACK_KING: Cell = { color: 'black', kind: 'king' };
const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };

/** Pool ruleset = zdroj pravdy fáze: létavá dáma, muž bere i dozadu. */
const POOL_RULESET: Ruleset = {
  manCaptureBackward: true,
  king: 'flying',
  promoteMidCapture: false,
  kingCapturePriority: false,
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
};

describe('flying braní – volba dopadu', () => {
  it('dáma sebere jeden kámen a smí dopadnout na KTERÉKOLI prázdné pole za ním', () => {
    // Černá dáma na 4, bílý muž na 15 (SW paprsek 4→8,11,15,18,22,25,29;
    // mezipole 8,11 prázdná). Za 15 jsou volná 18,22,25,29 → 4 samostatné tahy.
    const before = positionWith([[4, BLACK_KING], [15, WHITE_MAN]], 'black');
    const moves = legalMoves(before, POOL_RULESET);
    expect(moves.map(moveKey).sort()).toEqual(['18|15', '22|15', '25|15', '29|15']);

    // Aplikace každé větve: bílý na 15 zmizí, dáma stojí na svém dopadu.
    for (const move of moves) {
      const landing = move.path[move.path.length - 1];
      const after = applyMove(before, move, POOL_RULESET);
      expect(occupied(after)).toEqual([`${String(landing)}bk`]);
      expect(after.turn).toBe('white');
    }
  });

  it('bez povinného maxima: kratší dopad je legální tah vedle delšího', () => {
    // Volba 4→18 (nejblíž) i 4→29 (nejdál) jsou obě v legalMoves.
    const before = positionWith([[4, BLACK_KING], [15, WHITE_MAN]], 'black');
    const keys = legalMoves(before, POOL_RULESET).map(moveKey);
    expect(keys).toContain('18|15');
    expect(keys).toContain('29|15');
  });
});

describe('flying braní – vícenásobné braní', () => {
  it('dvě braní v jedné sekvenci, s volbou dopadu v každém kroku', () => {
    // Dáma 25, bílí na 22 a 11 (NE paprsek 25→22,18,15,11,8,4). Sebere 22
    // (dopad 18 nebo 15), pak 11 (dopad 8 nebo 4) → 4 kombinace, každá bere obojí.
    const before = positionWith([[25, BLACK_KING], [22, WHITE_MAN], [11, WHITE_MAN]], 'black');
    const moves = legalMoves(before, POOL_RULESET);
    expect(moves.map(moveKey).sort()).toEqual([
      '15,4|22,11',
      '15,8|22,11',
      '18,4|22,11',
      '18,8|22,11',
    ]);

    for (const move of moves) {
      const landing = move.path[move.path.length - 1];
      const after = applyMove(before, move, POOL_RULESET);
      // Oba bílí pryč, na desce jen černá dáma na konci sekvence.
      expect(occupied(after)).toEqual([`${String(landing)}bk`]);
    }
  });
});

describe('flying braní – turecký úder (brané kameny drží jako blokery)', () => {
  const RING: readonly (readonly [number, Cell])[] = [
    [18, BLACK_KING],
    [14, WHITE_MAN],
    [15, WHITE_MAN],
    [6, WHITE_MAN],
    [7, WHITE_MAN],
  ];

  it('kruhová sekvence sebere všechny 4 kameny a dáma se vrátí na výchozí pole', () => {
    const before = positionWith(RING, 'black');
    const loop = legalMoves(before, POOL_RULESET).find(
      (m) => m.path[m.path.length - 1] === 18 && m.captures.length === 4,
    );
    expect(loop).toBeDefined();
    if (loop === undefined) return;

    const after = applyMove(before, loop, POOL_RULESET);
    // Všichni čtyři bílí zmizí NARÁZ; černá dáma opět na 18. Kdyby se brané
    // kameny mazaly průběžně (jako americká cesta), geometrie by nesouhlasila.
    expect(occupied(after)).toEqual(['18bk']);
  });

  it('KAŽDÝ vygenerovaný tah projde applyMove bez výjimky (kontrakt gen↔apply)', () => {
    const before = positionWith(RING, 'black');
    const moves = legalMoves(before, POOL_RULESET);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      const after = applyMove(before, move, POOL_RULESET);
      expect(after.turn).toBe('white');
    }
  });

  it('pozdější segment NESMÍ přejet dřív braný kámen k dalšímu kameni (apply odmítne)', () => {
    // 14 i 23 jsou bílí. 18→9 sebere 14 (zůstává na desce jako bloker). Pokus
    // 9→27 po SE paprsku (14,18,23,27) by musel přejet přes už braný kámen 14,
    // aby dosáhl na 23. Turecký úder to zakazuje → apply hlásí DVA kameny na
    // segmentu. Kdyby apply mazal brané kameny průběžně, 14 by zmizel a tah by
    // CHYBNĚ prošel jako sebrání 23 – proto tato pozice má „zuby".
    const before = positionWith([[18, BLACK_KING], [14, WHITE_MAN], [23, WHITE_MAN]], 'black');
    expect(() =>
      applyMove(before, { from: 18, path: [9, 27], captures: [14, 23] }, POOL_RULESET),
    ).toThrow(RangeError);
    // A generátor takový tah vůbec nenabídne.
    const illegal = '9,27|14,23';
    expect(legalMoves(before, POOL_RULESET).map(moveKey)).not.toContain(illegal);
  });

  it('nedopadne na pole obsazené dřív braným (spent) kamenem', () => {
    // Po sebrání 23 (drží na desce) je pokus dopadnout zpět na 23 obsazené pole.
    const before = positionWith([[32, BLACK_KING], [23, WHITE_MAN], [14, WHITE_MAN]], 'black');
    expect(() =>
      applyMove(before, { from: 32, path: [18, 23], captures: [23, 14] }, POOL_RULESET),
    ).toThrow(RangeError);
  });

  it('jedním segmentem nelze přeskočit dva kameny (dva soupeři na jednom paprsku)', () => {
    // 32→9 po NW paprsku (27,23,18,14,9) přejíždí DVA bílé (23 i 14) najednou.
    const before = positionWith([[32, BLACK_KING], [23, WHITE_MAN], [14, WHITE_MAN]], 'black');
    expect(() =>
      applyMove(before, { from: 32, path: [9], captures: [23] }, POOL_RULESET),
    ).toThrow(RangeError);
  });
});

describe('flying braní – geometrické hrany generátoru', () => {
  it('žádné prázdné pole za soupeřem = žádný skok (dopad zablokovaný druhým kamenem)', () => {
    // Bílí 15 a 18 těsně za sebou na SW paprsku z 4: za 15 hned 18 → nelze dopadnout.
    const before = positionWith([[4, BLACK_KING], [15, WHITE_MAN], [18, WHITE_MAN]], 'black');
    const moves = legalMoves(before, POOL_RULESET);
    // Žádné braní neexistuje → padne na prosté (klouzavé) tahy dámy k 8 a 11.
    expect(moves.every((m) => m.captures.length === 0)).toBe(true);
    expect(moves.map((m) => m.path[0]).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([8, 11]);
  });

  it('vlastní kámen jako první v paprsku braní neumožní (blokuje)', () => {
    // Vlastní černý muž na 11 v SW paprsku z 4 → v tomto směru žádný skok.
    const before = positionWith([[4, BLACK_KING], [11, BLACK_MAN]], 'black');
    const moves = legalMoves(before, POOL_RULESET);
    expect(moves.every((m) => m.captures.length === 0)).toBe(true);
  });

  it('apply odmítne „sebrání" vlastního kamene létavou dámou (RangeError)', () => {
    // Vlastní černý muž na 15; ruční tah, který ho deklaruje jako braný, nesmí projít.
    const before = positionWith([[4, BLACK_KING], [15, BLACK_MAN]], 'black');
    expect(() =>
      applyMove(before, { from: 4, path: [18], captures: [15] }, POOL_RULESET),
    ).toThrow(RangeError);
  });

  it('muž pod flying rulesetem NENÍ létavý – bere jen krok o 2 (stará cesta)', () => {
    // Černý muž na 10, bílý na 15 (soused SE), za ním prázdné 19 → jen krok-2 skok.
    const before = positionWith([[10, BLACK_MAN], [15, WHITE_MAN]], 'black');
    const moves = legalMoves(before, POOL_RULESET);
    expect(moves.map(moveKey)).toEqual(['19|15']);
  });
});

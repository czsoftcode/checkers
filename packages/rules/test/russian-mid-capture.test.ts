/**
 * GOLDEN testy RUSKÉ proměny UPROSTŘED braní (fáze 98).
 *
 * Ověřují REÁLNÝ kontrakt obou stran: `legalMoves` (generátor) → `applyMove`
 * (přehrání) → výsledná deska. Klíčové vlastnosti ruského pravidla:
 *  - muž, který během braní dopadne na proměnnou řadu, se HNED stává létavou
 *    dámou a MUSÍ (může-li) pokračovat v braní letmo,
 *  - na cílovém poli stojí DÁMA i když cíl NENÍ na proměnné řadě (dáma po
 *    proměně doskočila jinam),
 *  - brané kameny (celé sekvence) jsou po tahu pryč (turecký úder, odložené
 *    mazání), případný nebraný bloker zůstává.
 *
 * ZUBY: velká otevírací perft tuto featuru skoro netestuje (muži jsou daleko od
 * proměny; první divergence pool↔ruská až v hloubce 8 – viz perft-russian).
 * Proto RUČNĚ postavené pozice + explicitní kontrola tvaru tahu i desky. Když se
 * přechod muž→dáma rozbije (muž skončí na proměnné řadě jako pool), tvar tahu se
 * změní z `[31,24]` na `[31]` a tyto testy padnou.
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Move, Position, Square } from '../src/index.js';
import {
  POOL_RULESET,
  RUSSIAN_RULESET,
  applyMove,
  legalMoves,
  squareToCoords,
} from '../src/index.js';

function board(cells: [number, 'b' | 'w', 'm' | 'k'][], turn: 'black' | 'white'): Position {
  const b: Cell[] = new Array<Cell>(32).fill(null);
  for (const [sq, col, kind] of cells) {
    b[sq - 1] = {
      color: col === 'b' ? 'black' : 'white',
      kind: kind === 'k' ? 'king' : 'man',
    };
  }
  return { board: b, turn };
}

const PROMO_ROW = { black: 7, white: 0 } as const;

describe('ruská proměna uprostřed braní – muž se mění na dámu a bere dál', () => {
  // Ručně postavené pozice; každá je JEDNOZNAČNÁ (geometrie vynucuje právě jeden
  // legální tah), aby šla porovnat na přesný tvar. Dvě barvy + opačný směr.
  const continueCases: [string, Position, Move, Square][] = [
    // Černý muž 22 bere 26, dopadá na 31 (proměnná řada 7) → HNED dáma, otočí se
    // a bere 27, doskočí na 24 (řada 5, NENÍ proměnná). Bílý 20 je jen bloker,
    // zůstává. Bez přechodu (pool) by muž skončil na 31 jako `[31]`.
    [
      'černý: promuje na 31, bere dál, končí na 24 (dáma mimo proměnnou řadu)',
      board(
        [
          [22, 'b', 'm'],
          [26, 'w', 'm'],
          [27, 'w', 'm'],
          [20, 'w', 'm'],
        ],
        'black',
      ),
      { from: 22, path: [31, 24], captures: [26, 27] },
      24,
    ],
    // Zrcadlo pro bílého (jiná barva, směr i pole): bílý muž 11 bere 7, dopadá na
    // 2 (proměnná řada 0) → dáma, bere 6, doskočí na 9 (řada 2). Černý 13 bloker.
    [
      'bílý: promuje na 2, bere dál, končí na 9 (dáma mimo proměnnou řadu)',
      board(
        [
          [11, 'w', 'm'],
          [7, 'b', 'm'],
          [6, 'b', 'm'],
          [13, 'b', 'm'],
        ],
        'white',
      ),
      { from: 11, path: [2, 9], captures: [7, 6] },
      9,
    ],
  ];

  it.each(continueCases)('%s', (_name, pos, expectedMove, finalSquare) => {
    const piece = pos.board[expectedMove.from - 1]!;
    const moves = legalMoves(pos, RUSSIAN_RULESET);
    // Generátor: přesně tento jeden tah, s pokračováním PO proměně (path > 1).
    expect(moves).toEqual([expectedMove]);

    const after = applyMove(pos, expectedMove, RUSSIAN_RULESET);
    const finalCell = after.board[finalSquare - 1];
    // Na cíli stojí DÁMA i když cíl NENÍ na proměnné řadě.
    expect(squareToCoords(finalSquare).row).not.toBe(PROMO_ROW[piece.color]);
    expect(finalCell).toEqual({ color: piece.color, kind: 'king' });
    // Všechny brané kameny jsou pryč.
    for (const cap of expectedMove.captures) {
      expect(after.board[cap - 1]).toBeNull();
    }
    // Výchozí pole je prázdné, na tahu je soupeř.
    expect(after.board[expectedMove.from - 1]).toBeNull();
    expect(after.turn).not.toBe(pos.turn);
  });

  it('POOL na téže pozici NEpokračuje (muž končí na proměnné řadě) – přechod má zuby', () => {
    const [, pos, russianMove] = continueCases[0]!;
    const poolMoves = legalMoves(pos, POOL_RULESET);
    // Pool: muž bere jen 26 a končí na 31 (proměnná řada) – žádné pokračování.
    expect(poolMoves).toEqual([{ from: 22, path: [31], captures: [26] }]);
    // Ruská se tvarem tahu prokazatelně liší od pool (jinak by test nic nehlídal).
    expect(legalMoves(pos, RUSSIAN_RULESET)).not.toEqual(poolMoves);
    // Sanity: ruský tah bere o kámen víc.
    expect(russianMove.captures.length).toBe(2);
  });
});

describe('ruská proměna uprostřed braní – muž promuje a NEMŮŽE dál (končí na proměnné řadě)', () => {
  // Muž bere na proměnnou řadu, ale za ní není co brát → sekvence končí, na poli
  // stojí dáma. Hrana „promuje a musí stop, protože nemá pokračování".
  const pos = board(
    [
      [21, 'b', 'm'],
      [25, 'w', 'm'],
    ],
    'black',
  );

  it('jediný tah je proměna-a-stop, na cíli dáma na proměnné řadě', () => {
    const moves = legalMoves(pos, RUSSIAN_RULESET);
    expect(moves).toEqual([{ from: 21, path: [30], captures: [25] }]);
    const after = applyMove(pos, moves[0]!, RUSSIAN_RULESET);
    expect(after.board[29]).toEqual({ color: 'black', kind: 'king' }); // sq30 = index 29
    expect(after.board[24]).toBeNull(); // sq25 braný pryč
    expect(squareToCoords(30).row).toBe(PROMO_ROW.black);
  });
});

// Perftové cross-checky moves.ts+apply proti nezávislému oracle (rozšířenému o
// mid-capture) žijí v perft-russian.test.ts. Tady se testuje TVAR tahu a deska.

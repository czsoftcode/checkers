/**
 * Perft fixture pro RUSKOU dámu (Russian draughts) – ověření generátoru přes
 * počet listů stromu legálních tahů.
 *
 * ZDROJ OVĚŘENÍ: NEZÁVISLÁ druhá implementace (`pool-reference-gen.ts`) v
 * souřadnicích (row, col), rozšířená o proměnu UPROSTŘED braní (`midPromote`).
 * Publikovaná ruská 8×8 perft čísla z otevírací pozice se najít nepodařilo (jen
 * 10×10 mezinárodní – viz hlavička perft-pool), takže brána padá na oracle, jako
 * u pool. Zafixovaná otevírací čísla se NESMÍ upravovat podle generátoru –
 * nesedící číslo = chyba v generátoru, ne ve fixtuře.
 *
 * CO TENTO SOUBOR UZAVÍRÁ (otázka z fáze 96): kde přesně se otevírací strom
 * pool a ruské rozejde. Fáze 96 uměla dokázat jen shodu do hloubky 6 a že v
 * hloubce 7 je první MOŽNÁ divergence. S implementovanou ruskou proměnou se
 * ukazuje: stromy jsou shodné do hloubky 7 VČETNĚ a poprvé se rozcházejí až v
 * hloubce 8 (929907 ≠ 929902). Otevírací perft je přitom slabý test featury
 * (muži jsou daleko od proměny) – reálný test mid-capture je v
 * russian-mid-capture.test.ts.
 *
 * Hloubka gate: otevírací shoda moves.ts ↔ oracle do hloubky 8 (křižuje bod
 * divergence). Hloubky 9–10 byly ověřeny ručně (moves.ts == oracle: 4570712,
 * 22456537), do commitu nejdou kvůli běhu (~30 s).
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Position } from '../src/index.js';
import {
  POOL_RULESET,
  RUSSIAN_RULESET,
  initialPosition,
  perft,
} from '../src/index.js';
import { fromPosition, perftRef } from './pool-reference-gen.js';

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

describe('ruská perft – otevírací pozice (brána proti zafixovanému oracle)', () => {
  // Zafixovaná ruská čísla z výchozí pozice, hloubka 1–8. Shodují se s pool do
  // hloubky 7 (jediný rozdíl pravidel – proměna uprostřed braní – do té doby
  // nenastane jako LIST); hloubka 8 je první divergence (929907 vs pool 929902).
  const EXPECTED_RUSSIAN: readonly number[] = [7, 49, 302, 1469, 7482, 37986, 190146, 929907];

  it.each(EXPECTED_RUSSIAN.map((nodes, i) => [i + 1, nodes] as const))(
    'perft ruská(%i) = %i',
    (depth, nodes) => {
      expect(perft(initialPosition(), depth, RUSSIAN_RULESET)).toBe(nodes);
    },
  );

  it('shoda s nezávislým oracle (mid-capture) do hloubky 8', () => {
    const start = initialPosition();
    for (let d = 1; d <= 8; d++) {
      expect(perft(start, d, RUSSIAN_RULESET)).toBe(perftRef(fromPosition(start), d, true, true));
    }
  });

  it('hranice divergence pool↔ruská: shoda do hloubky 7, rozchod v hloubce 8', () => {
    const start = initialPosition();
    // Do hloubky 7 se otevírací stromy pool a ruské PROKAZATELNĚ shodují
    // (proměna uprostřed braní se jako list neprojeví).
    for (let d = 1; d <= 7; d++) {
      expect(perft(start, d, RUSSIAN_RULESET)).toBe(perft(start, d, POOL_RULESET));
    }
    // Hloubka 8: první reálná divergence – ruská bere v jedné sekvenci víc.
    const rus8 = perft(start, 8, RUSSIAN_RULESET);
    const pool8 = perft(start, 8, POOL_RULESET);
    expect(rus8).toBe(929907);
    expect(pool8).toBe(929902);
    expect(rus8).not.toBe(pool8);
  });
});

describe('ruská perft – crafted mid-capture pozice (oracle cross-check)', () => {
  // Pozice, kde ruská proměna uprostřed braní REÁLNĚ nastává napříč stromem –
  // tam, kde je otevírací perft slepá. moves.ts+apply.ts vs nezávislý oracle,
  // navíc kontrola, že se strom liší od POOL (jinak by mid-capture nic neměnil).
  const positions: [string, Position, readonly number[], readonly number[]][] = [
    // Dva černí muži u proměny proti třem bílým: promoce, turecký úder i větvení.
    [
      'dva muži u proměny + tři soupeři',
      board(
        [
          [22, 'b', 'm'],
          [23, 'b', 'm'],
          [26, 'w', 'm'],
          [27, 'w', 'm'],
          [30, 'w', 'm'],
        ],
        'black',
      ),
      [3, 5, 29, 65, 491], // ruská
      [2, 2, 14, 47], // pool (liší se od ruské už v hloubce 1)
    ],
    // Hustší materiál obou stran: víc promujících linií i pokračování po proměně.
    [
      'tři muži vs čtyři soupeři u proměny',
      board(
        [
          [21, 'b', 'm'],
          [22, 'b', 'm'],
          [6, 'b', 'm'],
          [25, 'w', 'm'],
          [26, 'w', 'm'],
          [17, 'w', 'm'],
          [10, 'w', 'm'],
        ],
        'black',
      ),
      [9, 14, 28, 126, 700], // ruská
      [6, 7, 20, 104], // pool (liší se od ruské už v hloubce 1)
    ],
  ];

  it.each(positions)('%s: moves.ts+apply == oracle a ≠ pool (hloubka 1–5)', (_name, pos, russian, pool) => {
    for (let d = 1; d <= 5; d++) {
      const a = perft(pos, d, RUSSIAN_RULESET);
      expect(a).toBe(perftRef(fromPosition(pos), d, true, true)); // reálný kód == oracle
      expect(a).toBe(russian[d - 1]);
    }
    // Teeth: ruská se od pool liší už v malé hloubce (mid-capture reálně mění strom).
    for (let d = 1; d <= 4; d++) {
      expect(perft(pos, d, POOL_RULESET)).toBe(pool[d - 1]);
      expect(perft(pos, d, RUSSIAN_RULESET)).not.toBe(perft(pos, d, POOL_RULESET));
    }
  });
});

/**
 * Korektnostní brána transpoziční tabulky: `searchRoot` S transpoziční
 * tabulkou musí na dané FIXNÍ hloubce vrátit IDENTICKOU množinu nejlepších
 * tahů i skóre jako bez ní. TT je čistě optimalizace počtu uzlů; kdyby změnila
 * výsledek, tiše by rozbila kalibraci remíz (kořen sbírá všechny shodně
 * nejlepší tahy). Viz .mini/discuss/phase-017.md a hlavička search.ts.
 *
 * Zuby (proč to není jen „proběhne to"):
 * - Kdyby se skóre z TT přebíralo při `entry.depth >= depth` místo `=== depth`,
 *   transpozice by do mělčího uzlu vnesla hlubší výsledek → skóre/tahy by se
 *   od běhu bez TT rozešly a srovnání níž spadne.
 * - Test s TranspositionTable(1) (2 pole → skoro všechno koliduje na stejný
 *   index) prověřuje ověření plného klíče a náhradu: bez kontroly `key === key`
 *   by kolidující pozice vracely cizí skóre a výsledek by se rozešel.
 */

import { describe, expect, it } from 'vitest';

import { searchRoot } from '../src/search.js';
import { TranspositionTable } from '../src/transposition.js';

import { makePosition, randomPlayedPosition } from './support/position.js';
import type { PieceCode } from './support/position.js';

/** Fixtures: mix rozehraných pozic (seed, půltahy) a taktických sestav. */
const MIDGAME = [
  { seed: 1, plies: 8 },
  { seed: 2, plies: 10 },
  { seed: 3, plies: 12 },
  { seed: 4, plies: 14 },
  { seed: 5, plies: 16 },
  { seed: 7, plies: 6 },
  { seed: 11, plies: 18 },
] as const;

/** Taktické pozice s povinným braním (prověří interakci TT × quiescence). */
const TACTICAL: { turn: 'black' | 'white'; pieces: Record<number, PieceCode> }[] = [
  { turn: 'black', pieces: { 1: 'bm', 10: 'bm', 14: 'wm', 15: 'wm', 16: 'wk' } },
  { turn: 'black', pieces: { 13: 'bm', 21: 'bm', 22: 'bm', 29: 'wm' } },
  { turn: 'black', pieces: { 11: 'bm', 12: 'bm', 15: 'wm', 16: 'wm', 23: 'wm' } },
];

const DEPTHS = [2, 3, 4, 5, 6];

const positions = [
  ...MIDGAME.map(({ seed, plies }) => randomPlayedPosition(seed, plies)),
  ...TACTICAL.map(({ turn, pieces }) => makePosition(turn, pieces)),
];

describe('searchRoot – TT nemění výsledek fixní hloubky', () => {
  let totalWith = 0;
  let totalWithout = 0;

  for (const [index, position] of positions.entries()) {
    for (const depth of DEPTHS) {
      it(`pozice #${index}, hloubka ${depth}: shodné bestMoves i score`, () => {
        const withoutTt = searchRoot(position, depth);
        const withTt = searchRoot(position, depth, undefined, new TranspositionTable(16));

        expect(withTt.score).toBe(withoutTt.score);
        expect(withTt.bestMoves).toEqual(withoutTt.bestMoves);

        totalWith += withTt.nodes;
        totalWithout += withoutTt.nodes;
      });
    }
  }

  it('agregát: TT prohledá méně uzlů než běh bez TT (TT skutečně zabírá)', () => {
    // Běží po ostatních testech (sčítají do totalWith/totalWithout). Kdyby TT
    // nic neušetřila, není co reportovat jako bránu úbytku.
    expect(totalWithout).toBeGreaterThan(0);
    expect(totalWith).toBeLessThan(totalWithout);
  });
});

describe('searchRoot – ověření klíče má zuby (extrémní kolize kbelíku)', () => {
  for (const [index, position] of positions.entries()) {
    it(`pozice #${index}, hloubka 5: TranspositionTable(1) drží shodný výsledek`, () => {
      const withoutTt = searchRoot(position, 5);
      // 2 pole → drtivá většina klíčů koliduje na stejný index. Výsledek se
      // smí lišit jen tehdy, když ověření klíče/náhrada selžou.
      const tiny = searchRoot(position, 5, undefined, new TranspositionTable(1));
      expect(tiny.score).toBe(withoutTt.score);
      expect(tiny.bestMoves).toEqual(withoutTt.bestMoves);
    });
  }
});

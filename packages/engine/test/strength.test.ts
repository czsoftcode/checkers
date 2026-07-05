import type { Move } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { chooseMove, searchRoot } from '../src/search.js';
import type { RankedMove } from '../src/search.js';
import { makePosition, randomPlayedPosition } from './support/position.js';

/** Počítadlo losů rng – ověřuje, kolikrát chooseMove sáhne na náhodu. */
function countingRng(values: number[]): { rng: () => number; calls: () => number } {
  let i = 0;
  return {
    rng: () => {
      const v = values[i] ?? 0;
      i += 1;
      return v;
    },
    calls: () => i,
  };
}

describe('searchRoot – ranked režim (skóre všech kořenových tahů)', () => {
  it('mimo ranked režim rankedMoves chybí (kořen se pruuje)', () => {
    const pos = makePosition('black', { 1: 'bm', 10: 'bm', 14: 'wm', 15: 'wm', 16: 'wk' });
    expect(searchRoot(pos, 3).rankedMoves).toBeUndefined();
  });

  it('v ranked režimu vrací PŘESNÉ skóre všech tahů, seřazené sestupně', () => {
    // Táž taktická pozice jako v search.test.ts: v hloubce 3 je 10×17 (přes 14)
    // ostře lepší než 10×19 (přes 15), po kterém přijde zpětné braní. Ranked
    // režim musí dát skóre OBOU tahů (běžný search 10×19 ořízne) a seřadit je.
    const pos = makePosition('black', { 1: 'bm', 10: 'bm', 14: 'wm', 15: 'wm', 16: 'wk' });
    const result = searchRoot(pos, 3, undefined, null, true);
    const ranked = result.rankedMoves;
    if (ranked === undefined) {
      throw new Error('ranked režim musí vrátit rankedMoves');
    }
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.move).toEqual({ from: 10, path: [17], captures: [14] });
    expect(ranked[1]?.move).toEqual({ from: 10, path: [19], captures: [15] });
    // Přesná skóre, ne jen pořadí: nejlepší je ostře vyšší (podklad „druhé úrovně“).
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    // rankedMoves je nadmnožina bestMoves (nejlepší úroveň).
    expect(ranked[0]?.move).toEqual(result.bestMoves[0]);
  });

  it('má zuby: hloubka mění vybrané tahy (mělká vidí remízu tam, kde hluboká výhodu)', () => {
    // Seedovaná rozehraná pozice, empiricky depth-citlivá: v hloubce 1 je 7 tahů
    // se shodným (plochým) skóre, v hloubce 6 se to zúží na jediný nejlepší
    // 16→20. Kdyby maxDepth do searche neprošlo, obě hloubky by daly totéž.
    const pos = randomPlayedPosition(4, 6);
    const shallow = searchRoot(pos, 1).bestMoves;
    const deep = searchRoot(pos, 6).bestMoves;
    expect(shallow.length).toBeGreaterThan(1);
    expect(deep).toEqual([{ from: 16, path: [20], captures: [] }]);
    expect(deep).not.toEqual(shallow);
  });
});

describe('chooseMove – výběr tahu podle nepozornosti', () => {
  const A: Move = { from: 1, path: [5], captures: [] };
  const B: Move = { from: 2, path: [6], captures: [] };
  const C: Move = { from: 3, path: [7], captures: [] };
  const D: Move = { from: 4, path: [8], captures: [] };
  const ranked: RankedMove[] = [
    { move: A, score: 10 },
    { move: B, score: 5 },
    { move: C, score: 5 },
    { move: D, score: 1 },
  ];
  const bestMoves: Move[] = [A];

  it('carelessness 0 (Profesionál): hraje nejlepší a losuje rng JEN JEDNOU (tie-break)', () => {
    const { rng, calls } = countingRng([0.99]);
    expect(chooseMove(bestMoves, undefined, 0, rng)).toEqual(A);
    // Pořadí losů se nesmí posunout proti původnímu handleru: přesně jeden los.
    expect(calls()).toBe(1);
  });

  it('carelessness 1 (vždy nepozorný): hraje NEJLEPŠÍ z DRUHÉ úrovně, ne nejlepší', () => {
    // rng[0] = los „jsem nepozorný?" (0 < 1 → ano), rng[1] = tie-break druhé
    // úrovně (index 0 z [B, C]) → B. Nikdy A (to je první úroveň).
    const { rng } = countingRng([0, 0]);
    expect(chooseMove(bestMoves, ranked, 1, rng)).toEqual(B);
  });

  it('carelessness 1 s druhým tie-break indexem vybere druhý tah druhé úrovně', () => {
    // rng[1] = 0.6 → index Math.floor(0.6 * 2) = 1 z [B, C] → C.
    const { rng } = countingRng([0, 0.6]);
    expect(chooseMove(bestMoves, ranked, 1, rng)).toEqual(C);
  });

  it('nepozornostní los pod prahem nezabere → padá zpět na nejlepší tah', () => {
    // rng[0] = 0.8 ≥ carelessness 0.5 → nepozornost NEzabere; rng[1] tie-break
    // mezi bestMoves ([A]) → A. Dva losy (los nepozornosti + tie-break).
    const { rng, calls } = countingRng([0.8, 0.0]);
    expect(chooseMove(bestMoves, ranked, 0.5, rng)).toEqual(A);
    expect(calls()).toBe(2);
  });

  it('jediná úroveň skóre: nepozornost nemá co pokazit, hraje nejlepší', () => {
    // Všechny tahy stejné skóre → druhá úroveň prázdná → nejlepší (tie-break).
    const flat: RankedMove[] = [
      { move: A, score: 3 },
      { move: B, score: 3 },
    ];
    const { rng } = countingRng([0, 0]);
    // bestMoves = [A, B] (obě nejlepší); tie-break index 0 → A.
    expect(chooseMove([A, B], flat, 1, rng)).toEqual(A);
  });

  it('carelessness > 0 bez rankedMoves je programátorská chyba → RangeError', () => {
    // Kontrakt: nepozornost vyžaduje ranked režim searche. Tichý spád na
    // profesionální hru by zamaskoval špatné zapojení volajícího.
    expect(() => chooseMove(bestMoves, undefined, 0.5, () => 0)).toThrow(RangeError);
  });
});

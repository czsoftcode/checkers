import { applyMove, legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { evaluate } from '../src/evaluate.js';
import { searchRoot, WIN_SCORE } from '../src/search.js';
import { makePosition, randomPlayedPosition } from './support/position.js';

/**
 * Nezávislé orákulum pro vlastnostní test: čistý negamax BEZ ořezávání,
 * se stejnou specifikací quiescence (povinný skok na horizontu prodlužuje
 * o půltah). Záměrná duplicita logiky terminálu a horizontu – kdyby se
 * test opíral o search.ts, testoval by kód sám sebou.
 */
function plainNegamax(position: Position, depth: number, ply: number): number {
  const moves = legalMoves(position);
  if (moves.length === 0) {
    return -(WIN_SCORE - ply);
  }
  const forcedCapture = moves[0] !== undefined && moves[0].captures.length > 0;
  if (depth <= 0 && !forcedCapture) {
    return evaluate(position);
  }
  const childDepth = depth <= 0 ? 0 : depth - 1;
  let best = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    best = Math.max(best, -plainNegamax(applyMove(position, move), childDepth, ply + 1));
  }
  return best;
}

/** Kořen čistého negamaxu: skóre + všechny nejlepší tahy (v pořadí generátoru). */
function plainRoot(position: Position, depth: number): { bestMoves: Move[]; score: number } {
  let best = Number.NEGATIVE_INFINITY;
  let bestMoves: Move[] = [];
  for (const move of legalMoves(position)) {
    const value = -plainNegamax(applyMove(position, move), depth - 1, 1);
    if (value > best) {
      best = value;
      bestMoves = [move];
    } else if (value === best) {
      bestMoves.push(move);
    }
  }
  return { bestMoves, score: best };
}

describe('searchRoot – kontrakt vstupu', () => {
  it('neplatná hloubka (0, necelá) vyhazuje RangeError', () => {
    const position = makePosition('black', { 13: 'bm', 22: 'wm' });
    expect(() => searchRoot(position, 0)).toThrow(RangeError);
    expect(() => searchRoot(position, 1.5)).toThrow(RangeError);
  });

  it('pozice bez legálního tahu vyhazuje RangeError (handler ji odbavuje dřív)', () => {
    // Černý na tahu nemá žádný kámen.
    const position = makePosition('black', { 29: 'wm' });
    expect(() => searchRoot(position, 4)).toThrow(RangeError);
  });
});

describe('searchRoot – taktika s nezávisle ověřeným výsledkem', () => {
  it('najde výhru v 1 tahu (zablokování posledního kamene) se skóre WIN_SCORE - 1', () => {
    // Bílý má jen muže v rohu 29 (může jen na 25, skok přes 25 dopadá na 22).
    // Jediný vyhrávající tah černého je 21→25: obsadí 25 a dopad 22 zůstane
    // krytý → bílý bez tahu prohrává. Alternativy (13→17, 22→26 pouští
    // bílého ven, 22→25 uvolní dopad 22 a bílý černého na 25 přeskočí).
    const position = makePosition('black', { 13: 'bm', 21: 'bm', 22: 'bm', 29: 'wm' });
    const result = searchRoot(position, 2);
    expect(result.score).toBe(WIN_SCORE - 1);
    expect(result.bestMoves).toEqual([{ from: 21, path: [25], captures: [] }]);
  });

  it('mezi dvěma braními vybere to, po kterém nepřijde zpětné braní (2 půltahy dopředu)', () => {
    // Černý muž 10 MUSÍ brát: 10×17 (přes 14), nebo 10×19 (přes 15).
    // Po 10×19 bílá dáma 16 černého na 19 přeskočí zpět (16×23) – v hloubce 1
    // jsou obě braní materiálně stejná, rozdíl je vidět až o půltah dál.
    const position = makePosition('black', { 1: 'bm', 10: 'bm', 14: 'wm', 15: 'wm', 16: 'wk' });
    expect(legalMoves(position)).toHaveLength(2);
    const result = searchRoot(position, 3);
    expect(result.bestMoves).toEqual([{ from: 10, path: [17], captures: [14] }]);
  });

  it('quiescence: tah do braní, který statická evaluace přeceňuje, nevybere ani v hloubce 1', () => {
    // Horizont efekt: černá dáma 3 může na 7 nebo 8 – staticky nejlépe
    // ohodnocené děti (dáma neztrácí žádný bonus), jenže obě pole visí
    // do POVINNÉHO skoku bílého 11 a dáma (130) padá bez náhrady. Jediný
    // bezpečný tah je muž 1→6, staticky HORŠÍ (opouští zadní řadu, -8+1).
    // Pevná hloubka 1 bez quiescence by vybrala tahy dámou; quiescence
    // dohraje vynucenou výměnu za horizontem a ztrátu odhalí.
    const position = makePosition('black', { 1: 'bm', 3: 'bk', 5: 'wm', 11: 'wm' });
    const safeMove = { from: 1, path: [6], captures: [] };
    // Přibití předpokladu horizontu: dítě po tahu dámou je staticky lepší
    // (kdyby se evaluace změnila a přestalo to platit, test ztrácí smysl
    // a MÁ spadnout tady, ne tiše projít).
    const staticAfter = (move: Move): number => -evaluate(applyMove(position, move));
    expect(staticAfter({ from: 3, path: [7], captures: [] })).toBeGreaterThan(staticAfter(safeMove));

    const result = searchRoot(position, 1);
    expect(result.bestMoves).toEqual([safeMove]);
  });

  it('dvě stejně dobrá braní vrací obě (podklad pro tie-break v handleru)', () => {
    // Muži 9 i 10 mohou přeskočit téhož posledního bílého muže 14 –
    // oba tahy okamžitě vyhrávají, skóre je identické.
    const position = makePosition('black', { 9: 'bm', 10: 'bm', 14: 'wm' });
    const result = searchRoot(position, 2);
    expect(result.score).toBe(WIN_SCORE - 1);
    expect(result.bestMoves).toEqual([
      { from: 9, path: [18], captures: [14] },
      { from: 10, path: [17], captures: [14] },
    ]);
  });
});

describe('searchRoot – shoda s čistým negamaxem bez ořezávání', () => {
  const seeds = [3, 11, 42, 77, 123, 500, 2024, 31337];

  it.each(seeds)('rozehraná pozice (seed %i): stejné skóre i množina nejlepších tahů', (seed) => {
    const position = randomPlayedPosition(seed, 4 + (seed % 25));
    const expected = plainRoot(position, 3);
    const actual = searchRoot(position, 3);
    expect(actual.score).toBe(expected.score);
    expect(actual.bestMoves).toEqual(expected.bestMoves);
  });

  it('shoda platí i v hloubce 4 na výchozí pozici', () => {
    const position = randomPlayedPosition(1, 0);
    const expected = plainRoot(position, 4);
    const actual = searchRoot(position, 4);
    expect(actual.score).toBe(expected.score);
    expect(actual.bestMoves).toEqual(expected.bestMoves);
  });
});

describe('searchRoot – legalita vybraných tahů', () => {
  it.each([5, 60, 700])('všechny bestMoves jsou prvky legalMoves (seed %i)', (seed) => {
    const position = randomPlayedPosition(seed, 12);
    const legal = legalMoves(position);
    for (const move of searchRoot(position, 4).bestMoves) {
      expect(legal).toContainEqual(move);
    }
  });
});

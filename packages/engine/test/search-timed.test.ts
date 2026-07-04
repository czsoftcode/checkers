/**
 * Testy searchTimed: iterativní prohlubování s měkkým limitem.
 *
 * Determinismus: čas dodávají falešné hodiny (injektovaný `now`), takže
 * dosažená hloubka nezávisí na rychlosti stroje. Klíčová vlastnost napříč
 * testy: VÝSLEDEK searchTimed (nejlepší tahy + skóre) je VŽDY identický
 * s netimovaným searchRoot(pozice, vrácená hloubka) – tedy poslední KOMPLETNÍ
 * iterace, nikdy slepenec s částečnými výsledky přerušené iterace. Pole
 * `nodes` se liší (searchTimed sčítá práci všech iterací) → viz expectSameResult.
 */

import { initialPosition, legalMoves } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { MAX_SEARCH_DEPTH, searchRoot, searchTimed } from '../src/search.js';
import type { SearchResult } from '../src/search.js';
import { makePosition, randomPlayedPosition } from './support/position.js';

/**
 * Ověří, že výsledek searchTimed nese TÝŽ VÝSLEDEK jako netimovaný searchRoot
 * na dané hloubce: shodné nejlepší tahy i skóre. Pole `nodes` se záměrně
 * neporovnává – searchTimed ho sčítá přes všechny iterace, searchRoot je
 * jediný běh, takže se legitimně liší.
 */
function expectSameResult(result: SearchResult, expected: SearchResult): void {
  expect(result.bestMoves).toEqual(expected.bestMoves);
  expect(result.score).toBe(expected.score);
}

/** Hodiny vracející hodnoty z fronty; po vyčerpání poslední hodnotu. */
function queueClock(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    if (value === undefined) {
      throw new RangeError('queueClock: prázdná fronta hodnot');
    }
    return value;
  };
}

/** Hodiny postupující o `stepMs` při KAŽDÉM odečtu (deterministické). */
function steppingClock(stepMs: number): () => number {
  let t = 0;
  return () => {
    t += stepMs;
    return t;
  };
}

describe('searchTimed – kontrakt vstupu', () => {
  const position = makePosition('black', { 13: 'bm', 22: 'wm' });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'neplatný timeMs (%s) vyhazuje RangeError',
    (timeMs) => {
      expect(() => searchTimed(position, { timeMs })).toThrow(RangeError);
    },
  );

  it.each([0, -1, 2.5])('neplatný maxDepth (%s) vyhazuje RangeError', (maxDepth) => {
    expect(() => searchTimed(position, { timeMs: 100, maxDepth })).toThrow(RangeError);
  });

  it('pozice bez legálního tahu vyhazuje RangeError (handler ji odbavuje dřív)', () => {
    const dead = makePosition('black', { 29: 'wm' });
    expect(() => searchTimed(dead, { timeMs: 100 })).toThrow(RangeError);
  });
});

describe('searchTimed – záruky iterativního prohlubování', () => {
  it('hloubka 1 se dokončí vždy: i když hodiny přetečou hned po startu', () => {
    // První odečet (start) vrátí 0, každý další je dávno za deadline –
    // heuristika druhou iteraci ani nezačne. Výsledek přesto existuje
    // a odpovídá kompletní hloubce 1.
    const clock = queueClock([0, 1_000_000_000]);
    const position = initialPosition();
    const result = searchTimed(position, { timeMs: 1, now: clock });
    expect(result.depth).toBe(1);
    expectSameResult(result, searchRoot(position, 1));
  });

  it('stojící hodiny: doběhne až na maxDepth a výsledek sedí s searchRoot', () => {
    // Hodiny se nehýbou → čas nikdy nedojde → jediný strop je maxDepth.
    const position = initialPosition();
    const result = searchTimed(position, { timeMs: 100, maxDepth: 4, now: () => 0 });
    expect(result.depth).toBe(4);
    expectSameResult(result, searchRoot(position, 4));
  });

  it('měkký limit MEZI iteracemi: heuristika další iteraci nezačne', () => {
    // Fronta hodin: start, konec hloubky 1, heuristika hloubky 2, jedna
    // kontrola hodin uvnitř hloubky 2 (85 uzlů → jedna kontrola na 64.),
    // konec hloubky 2 – všechno 0. Šestý odečet (heuristika hloubky 3)
    // vrátí čas dávno za deadline → iterace 3 se vůbec nezačne.
    // Výsledkem musí být kompletní hloubka 2.
    const clock = queueClock([0, 0, 0, 0, 0, 1_000_000_000]);
    const position = initialPosition();
    const result = searchTimed(position, { timeMs: 100, maxDepth: 10, now: clock });
    expect(result.depth).toBe(2);
    expectSameResult(result, searchRoot(position, 2));
  });

  it('přerušení UPROSTŘED iterace (SearchAborted): neúplná iterace se zahodí', () => {
    // Samokalibrace místo natvrdo spočítaných uzlů (počty se s vývojem
    // searche hýbou): dvěma běhy se stojícími hodinami se změří počet
    // odečtů hodin do konce hloubky TARGET-1 a TARGET. Rozpětí navíc
    // patří iteraci TARGET: 1. odečet je heuristika, poslední je konec
    // iterace, VŠECHNO mezi tím jsou kontroly hodin uvnitř searche.
    const position = initialPosition();
    const TARGET = 5;

    const countCalls = (maxDepth: number): number => {
      let calls = 0;
      searchTimed(position, {
        timeMs: 100,
        maxDepth,
        now: () => {
          calls += 1;
          return 0;
        },
      });
      return calls;
    };
    const callsToPrev = countCalls(TARGET - 1);
    const callsToTarget = countCalls(TARGET);
    // Ochrana kalibrace: iterace TARGET musí mít aspoň jednu kontrolu
    // hodin uvnitř (jinak by test tiše testoval jinou větev – viz níž).
    expect(callsToTarget - callsToPrev).toBeGreaterThan(2);

    // Hodiny přeteču PŘESNĚ na první kontrole uvnitř iterace TARGET:
    // všechny heuristiky do té doby viděly 0 (iterace se legálně začala),
    // takže jediná cesta k depth === TARGET-1 je vyhozené a chycené
    // SearchAborted se zahozením rozpracované iterace.
    const flipAt = callsToPrev + 2;
    let calls = 0;
    const flippingClock = (): number => {
      calls += 1;
      return calls >= flipAt ? 1_000_000_000 : 0;
    };
    const result = searchTimed(position, { timeMs: 100, maxDepth: TARGET, now: flippingClock });
    expect(result.depth).toBe(TARGET - 1);
    expectSameResult(result, searchRoot(position, TARGET - 1));
  });

  it.each([
    [0.05, 8],
    [0.5, 21],
    [5, 60],
  ])(
    'žádný průsak neúplné iterace: krokující hodiny (krok %s ms, seed %i)',
    (stepMs, seed) => {
      // Vlastnost: ať search skončí kdekoli, vrácený výsledek se musí
      // PŘESNĚ rovnat netimovanému searchRoot na vrácené hloubce – jinak
      // protekl částečný výsledek. Tyto parametrizace končí heuristikou
      // před iterací nebo stropem maxDepth; přerušení UVNITŘ iterace
      // deterministicky pokrývá samokalibrační test výš.
      const position = randomPlayedPosition(seed, 10);
      const result = searchTimed(position, { timeMs: 10, maxDepth: 8, now: steppingClock(stepMs) });
      expect(result.depth).toBeGreaterThanOrEqual(1);
      expect(result.depth).toBeLessThanOrEqual(8);
      const reference = searchRoot(position, result.depth);
      expect(result.bestMoves).toEqual(reference.bestMoves);
      expect(result.score).toBe(reference.score);
    },
  );

  it('skutečné hodiny: na výchozí pozici prohloubí aspoň na 2 a vrací legální tahy', () => {
    const position = initialPosition();
    const started = performance.now();
    const result = searchTimed(position, { timeMs: 50 });
    const elapsed = performance.now() - started;
    expect(result.depth).toBeGreaterThanOrEqual(2);
    expect(result.depth).toBeLessThanOrEqual(MAX_SEARCH_DEPTH);
    // Měkký limit + režie; 500 ms rezerva kvůli rozptylu CI, ne kontrakt.
    expect(elapsed).toBeLessThan(50 + 500);
    const legal = legalMoves(position);
    for (const move of result.bestMoves) {
      expect(legal).toContainEqual(move);
    }
  });
});

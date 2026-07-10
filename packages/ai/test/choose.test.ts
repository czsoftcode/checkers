/**
 * Jednotkové testy orchestrátoru `computeAiMove` (fáze 86).
 *
 * ZUBY:
 *  - vrací legální tah (prvek `legalMoves`, ne důvěra ve search),
 *  - knižní pozice → PŘESNĚ knižní tah a BEZ hledání (rng se nesmí dotknout –
 *    ověřeno rng, které při zavolání vyhodí),
 *  - NELEGÁLNÍ knižní tah → fallback na search (vrátí legální tah, ne knižní),
 *  - offline strop `maxDepth` se opravdu aplikuje na hledání (stejný výsledek
 *    jako úrovňový `strength.maxDepth` téže hloubky – kdyby se strop ignoroval,
 *    levá strana by hledala neomezeně a tah by se rozešel).
 *
 * Shodu HLEDACÍ větve se serverem přibíjí `choose-contract.test.ts`; tady jde o
 * základní chování a větvení book/fallback/strop.
 */

import { describe, expect, it } from 'vitest';

import { initialPosition, legalMoves, positionKey } from '@checkers/rules';
import type { Cell, Move, Position } from '@checkers/rules';

import { computeAiMove, OPENING_BOOK, lookupBookMove } from '../src/index.js';
import type { OpeningBook } from '../src/index.js';
import { mulberry32 } from './support/prng.js';

/** Pevné konstantní hodiny → search doběhne na strop hloubky deterministicky. */
const fixedNow = (): number => 0;

describe('computeAiMove', () => {
  it('vrací legální tah (Profesionál, bez knihy)', () => {
    const position = initialPosition();
    const move = computeAiMove(
      position,
      { strength: {}, timeMs: 1000, maxDepth: 4, now: fixedNow },
      mulberry32(1),
    );
    const legal = legalMoves(position).some(
      (m) => m.from === move.from && samePath(m.path, move.path),
    );
    expect(legal).toBe(true);
  });

  it('knižní pozice → knižní tah, bez hledání (rng se nedotkne)', () => {
    const position = initialPosition();
    const expected = lookupBookMove(OPENING_BOOK, position);
    expect(expected).toBeDefined();

    // rng, které při JAKÉMKOLI zavolání vyhodí: knižní větev nesmí hledat ani losovat.
    const rngThatMustNotRun = (): number => {
      throw new Error('rng nesmí být zavoláno na knižní pozici');
    };
    const move = computeAiMove(
      position,
      { strength: {}, timeMs: 1000, book: OPENING_BOOK, now: fixedNow },
      rngThatMustNotRun,
    );
    expect(move).toEqual(expected);
  });

  it('nelegální knižní tah → fallback na hledání (vrátí legální tah)', () => {
    const position = initialPosition();

    // Kniha vrátí tah z pole, které v pozici nemá žádný legální tah → re-validace
    // ho zahodí a orchestrátor musí hledat (ne vrátit nelegální knižní tah).
    const usedFroms = new Set(legalMoves(position).map((m) => m.from));
    const freeFrom = firstUnusedSquare(usedFroms);
    const illegalBookMove: Move = { from: freeFrom, path: [freeFrom], captures: [] };
    const poisonedBook: OpeningBook = new Map([[positionKey(position), [illegalBookMove]]]);

    const move = computeAiMove(
      position,
      { strength: {}, timeMs: 1000, maxDepth: 4, book: poisonedBook, now: fixedNow },
      mulberry32(1),
    );

    expect(move).not.toEqual(illegalBookMove);
    const legal = legalMoves(position).some(
      (m) => m.from === move.from && samePath(m.path, move.path),
    );
    expect(legal).toBe(true);
  });

  it('pozice bez legálního tahu → vyhodí (kontrakt: volající to hlídá dřív)', () => {
    // Strana na tahu (černý) nemá figuru → žádný legální tah. Server tento stav
    // odbaví dřív (`no_legal_moves`) a engine vůbec nevolá; orchestrátor NEmaskuje
    // – searchTimed vyhodí. Test přibíjí, ať se to chování nezmění tiše.
    const board: Cell[] = Array.from({ length: 32 }, () => null);
    board[0] = { color: 'white', kind: 'man' };
    const terminal: Position = { board, turn: 'black' };
    expect(legalMoves(terminal)).toHaveLength(0);
    expect(() =>
      computeAiMove(terminal, { strength: {}, timeMs: 1000, now: fixedNow }, mulberry32(1)),
    ).toThrow();
  });

  it('offline strop maxDepth se aplikuje na hledání (== úrovňový maxDepth)', () => {
    const position = initialPosition();
    // Levá: strop jen přes offline `maxDepth`; pravá: přes úrovňový `strength.maxDepth`.
    // Musí vyjít stejně (offline strop se do searchTimed propíše identicky). Kdyby
    // se offline strop ignoroval, levá strana hledá neomezeně → jiný tah → pád.
    const viaOfflineCap = computeAiMove(
      position,
      { strength: {}, timeMs: 1000, maxDepth: 1, now: fixedNow },
      mulberry32(7),
    );
    const viaLevelDepth = computeAiMove(
      position,
      { strength: { maxDepth: 1 }, timeMs: 1000, now: fixedNow },
      mulberry32(7),
    );
    expect(viaOfflineCap).toEqual(viaLevelDepth);
  });
});

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((sq, i) => sq === b[i]);
}

/** První pole 1..32, které není mezi `used` (nemá v pozici legální tah). */
function firstUnusedSquare(used: ReadonlySet<number>): number {
  for (let sq = 1; sq <= 32; sq++) {
    if (!used.has(sq)) {
      return sq;
    }
  }
  throw new Error('Všechna pole mají legální tah – nečekané ve výchozí pozici.');
}

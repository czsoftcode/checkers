import { gameResultFromState, initialPosition, legalMoves, positionKey } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { generateOpening, generateOpenings } from '../src/selfplay.js';

describe('generateOpening – randomizované zahájení', () => {
  it('je deterministické: stejný seed = stejné zahájení', () => {
    const a = generateOpening(42, 4);
    const b = generateOpening(42, 4);
    expect(b).toEqual(a);
  });

  it('reálně rozehraje pozici (liší se od výchozí) a partie pokračuje', () => {
    const opening = generateOpening(7, 4);
    expect(positionKey(opening.position)).not.toBe(positionKey(initialPosition()));
    // Zahájení musí být hratelné z obou barev → nesmí být rozhodnuté.
    expect(gameResultFromState(opening)).toBe('ongoing');
    expect(legalMoves(opening.position).length).toBeGreaterThan(0);
  });

  it('plies = 0 vrací výchozí pozici (žádný půltah)', () => {
    const opening = generateOpening(1, 0);
    expect(positionKey(opening.position)).toBe(positionKey(initialPosition()));
  });

  it('záporný počet půltahů vyhazuje RangeError', () => {
    expect(() => generateOpening(1, -1)).toThrow(RangeError);
  });
});

describe('generateOpenings – sada zahájení', () => {
  it('vrátí požadovaný počet a každé je hratelné (ongoing, má tahy)', () => {
    const openings = generateOpenings(1000, 20, 4);
    expect(openings).toHaveLength(20);
    for (const opening of openings) {
      expect(gameResultFromState(opening)).toBe('ongoing');
      expect(legalMoves(opening.position).length).toBeGreaterThan(0);
    }
  });

  it('různé seedy dávají převážně různá zahájení', () => {
    const openings = generateOpenings(1, 30, 4);
    const distinct = new Set(openings.map((o) => positionKey(o.position)));
    // Nevyžadujeme 100% unikátnost (kolize jsou možné), ale drtivou většinu.
    expect(distinct.size).toBeGreaterThanOrEqual(25);
  });

  it('nulový počet zahájení vyhazuje RangeError', () => {
    expect(() => generateOpenings(1, 0, 4)).toThrow(RangeError);
  });
});

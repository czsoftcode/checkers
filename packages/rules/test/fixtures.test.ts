import { describe, expect, it } from 'vitest';

import { formatMove, legalMoves, perft, positionKey } from '../src/index.js';
import { decodeBoard, loadFixtures, parseFixture } from './support/fixtures.js';

const fixtures = loadFixtures();

/** Známé fixtures – nová se přidá sem; smazaná/nenačtená se projeví hned. */
const EXPECTED_NAMES = [
  'blocked-position',
  'circular-king-jump',
  'initial-position',
  'man-no-backward-capture',
  'mandatory-capture',
  'multi-jump-branching',
  'no-stop-mid-branch',
  'promotion-ends-move',
] as const;

describe('fixtures – úplnost sady', () => {
  it('načetly se přesně známé fixtures (žádné tiché přeskočení)', () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual([...EXPECTED_NAMES]);
  });

  it('name odpovídá názvu souboru', () => {
    for (const fixture of fixtures) {
      expect(fixture.file).toBe(`${fixture.name}.json`);
    }
  });

  it('expectedMoves jsou setříděné lexikograficky (kontrakt formátu)', () => {
    for (const fixture of fixtures) {
      expect(fixture.expectedMoves, fixture.file).toEqual([...fixture.expectedMoves].sort());
    }
  });

  it('kódování desky je totožné s positionKey (sdílený literál .mkMK)', () => {
    // Fixtures i positionKey kódují pole stejnými znaky. Tenhle test přibíjí
    // kontrakt přes reálný kód obou stran – rozjedou-li se, padne tady.
    for (const fixture of fixtures) {
      expect(positionKey(fixture.position), fixture.file).toBe(
        `${fixture.turn}:${fixture.board}`,
      );
    }
  });
});

describe('fixtures – legální tahy sedí na generátor', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const generated = legalMoves(fixture.position)
      .map((move) => formatMove(move))
      .sort();
    expect(generated).toEqual([...fixture.expectedMoves]);
  });
});

describe('fixtures – perft hodnoty', () => {
  const withPerft = fixtures.filter((f) => f.perft !== undefined);

  it('aspoň jedna fixture perft hodnoty má', () => {
    expect(withPerft.length).toBeGreaterThan(0);
  });

  it.each(withPerft.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    for (const [i, nodes] of (fixture.perft ?? []).entries()) {
      expect(perft(fixture.position, i + 1), `hloubka ${String(i + 1)}`).toBe(nodes);
    }
  });
});

describe('fixtures – poškozený vstup loader hlasitě odmítá', () => {
  const valid = {
    name: 'x',
    description: 'y',
    board: '.'.repeat(32),
    turn: 'black',
    expectedMoves: [],
  };

  it('vadný řetězec desky', () => {
    expect(() => decodeBoard('.'.repeat(31), 'f')).toThrow(/31 znaků/);
    expect(() => decodeBoard('?' + '.'.repeat(31), 'f')).toThrow(/neznámý znak/);
  });

  it('chybějící či vadná pole objektu', () => {
    expect(() => parseFixture(null, 'f')).toThrow(/není objekt/);
    expect(() => parseFixture({ ...valid, name: '' }, 'f')).toThrow(/name/);
    expect(() => parseFixture({ ...valid, description: undefined }, 'f')).toThrow(/description/);
    expect(() => parseFixture({ ...valid, board: 42 }, 'f')).toThrow(/board/);
    expect(() => parseFixture({ ...valid, turn: 'red' }, 'f')).toThrow(/turn/);
    expect(() => parseFixture({ ...valid, expectedMoves: [1] }, 'f')).toThrow(/expectedMoves/);
    expect(() => parseFixture({ ...valid, perft: [] }, 'f')).toThrow(/perft/);
    expect(() => parseFixture({ ...valid, perft: [1.5] }, 'f')).toThrow(/perft/);
  });

  it('neznámý klíč (překlep nepovinného pole) je tvrdá chyba', () => {
    expect(() => parseFixture({ ...valid, pertf: [7] }, 'f')).toThrow(/neznámé klíče: pertf/);
  });
});

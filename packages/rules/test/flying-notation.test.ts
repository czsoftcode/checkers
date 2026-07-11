import { describe, expect, it } from 'vitest';

import type { Move, Ruleset } from '../src/index.js';
import { formatMove, parseMove } from '../src/index.js';

const FLYING: Ruleset = { manCaptureBackward: false, king: 'flying' };

describe('notace – klouzavý prostý tah létavé dámy', () => {
  it('formatMove zapíše dlouhý prostý tah pomlčkou (18-5)', () => {
    const move: Move = { from: 18, path: [5], captures: [] };
    expect(formatMove(move, FLYING)).toBe('18-5');
  });

  it('parseMove přečte dlouhý prostý tah po diagonále', () => {
    expect(parseMove('18-5', FLYING)).toEqual({ from: 18, path: [5], captures: [] });
  });

  it('roundtrip Move → text → Move pro dlouhý tah je identita', () => {
    const move: Move = { from: 18, path: [5], captures: [] };
    expect(parseMove(formatMove(move, FLYING), FLYING)).toEqual(move);
  });

  it('flying relaxace je strukturální: mimo diagonálu (18-19) odmítne obojí', () => {
    const teleport: Move = { from: 18, path: [19], captures: [] };
    expect(() => formatMove(teleport, FLYING)).toThrow(RangeError);
    expect(() => parseMove('18-19', FLYING)).toThrow(RangeError);
  });

  it("king:'short' (default) dlouhý prostý tah NEpřijme (americká notace beze změny)", () => {
    const move: Move = { from: 18, path: [5], captures: [] };
    expect(() => formatMove(move)).toThrow(RangeError);
    expect(() => parseMove('18-5')).toThrow(RangeError);
    // Krátký tah projde v obou variantách stejně.
    expect(formatMove({ from: 18, path: [14], captures: [] })).toBe('18-14');
    expect(formatMove({ from: 18, path: [14], captures: [] }, FLYING)).toBe('18-14');
  });
});

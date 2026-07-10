import { describe, expect, it } from 'vitest';
import { advanceState, initialGameState, legalMoves } from '@checkers/rules';
import type { GameState, Move, Position } from '@checkers/rules';
import {
  OPENING_BOOK,
  STRENGTH_BY_LEVEL,
  computeAiMove,
  levelUsesBook,
} from '@checkers/ai';
import type { GameLevel } from '@checkers/ai';
import {
  DEFAULT_SEARCH_TIME_MS,
  MAX_OFFLINE_DEPTH,
  computeEngineMove,
  strengthFor,
} from '../../src/local/compute-move.js';
import { mulberry32 } from '../../src/local/prng.js';

/**
 * Čerstvé injektovatelné hodiny pro `searchTimed`. Vrací monotónně rostoucí čas
 * s velkým krokem: první tik (start) je 0, každý další skočí o `step`. S malým
 * `timeMs` tak search DETERMINISTICKY zastaví hned po hloubce 1 (uplynulý čas
 * překročí deadline), nezávisle na rychlosti stroje. Obě porovnávané cesty
 * dostanou VLASTNÍ čerstvé hodiny se stejným chováním → identická sekvence.
 */
function makeClock(step = 1_000_000): () => number {
  let t = -step;
  return () => {
    t += step;
    return t;
  };
}

/** Pozice po odehrání `n` prvních legálních tahů z výchozího rozestavění (off-book). */
function advancePlies(n: number): GameState {
  let state = initialGameState();
  for (let i = 0; i < n; i++) {
    const [move] = legalMoves(state.position);
    if (move === undefined) {
      throw new Error(`Pozice bez tahu po ${String(i)} půltazích`);
    }
    state = advanceState(state, move);
  }
  return state;
}

const ALL_LEVELS: readonly GameLevel[] = [
  'championship',
  'professional',
  'intermediate',
  'beginner',
  'education',
];

describe('strengthFor – offline politika síly', () => {
  it('silné úrovně (bez serverových pák) dostanou offline strop maxDepth 12 bez nepozornosti', () => {
    for (const level of ['professional', 'championship', 'education'] as const) {
      expect(STRENGTH_BY_LEVEL[level]).toBeUndefined();
      expect(strengthFor(level)).toEqual({ maxDepth: MAX_OFFLINE_DEPTH });
    }
  });

  it('Začátečník a Střední zůstávají beze změny (jejich strop je nižší než 12)', () => {
    // Zuby: kdyby offline strop úroveň ZESÍLIL (min špatně / bez min), tady by
    // maxDepth vyskočil na 12 a rovnost padla.
    expect(strengthFor('beginner')).toEqual(STRENGTH_BY_LEVEL.beginner);
    expect(strengthFor('intermediate')).toEqual(STRENGTH_BY_LEVEL.intermediate);
    expect(strengthFor('beginner').maxDepth).toBe(1);
    expect(strengthFor('intermediate').maxDepth).toBe(3);
  });
});

describe('computeEngineMove – shoda s computeAiMove při stejné Strength', () => {
  const positions: readonly Position[] = [
    initialGameState().position, // výchozí pozice (v knize pro silné úrovně)
    advancePlies(5).position, // mimo knihu → skutečné hledání
  ];

  it('vrátí týž tah jako computeAiMove(strengthFor(level)) pro každou úroveň a pozici', () => {
    const seed = 0x1234abcd;
    const timeMs = 1;
    for (const level of ALL_LEVELS) {
      for (const position of positions) {
        const mine = computeEngineMove({ position, level, seed, timeMs }, makeClock());
        const book = levelUsesBook(level) ? { book: OPENING_BOOK } : {};
        const reference = computeAiMove(
          position,
          { strength: strengthFor(level), timeMs, ...book, now: makeClock() },
          mulberry32(seed),
        );
        expectSameMove(mine, reference, `${level} @ ${position.turn}`);
      }
    }
  });

  it('výchozí časový limit je 1 s (shodný se serverem)', () => {
    expect(DEFAULT_SEARCH_TIME_MS).toBe(1000);
  });
});

function expectSameMove(a: Move, b: Move, ctx: string): void {
  expect(a.from, ctx).toBe(b.from);
  expect([...a.path], ctx).toEqual([...b.path]);
}

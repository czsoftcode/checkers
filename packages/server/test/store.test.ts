/**
 * Unit testy úložiště: evidence odehraných tahů a příznak `archived`.
 * Bez těchhle dvou věcí nejde sestavit archivní PDN (fáze 23), proto se
 * fixují přímo na reálném `GameStore`, ne na mocku.
 */

import { describe, expect, it } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move } from '@checkers/rules';
import { GameStore } from '../src/index.js';

/** Odehraje na store první legální tah aktuální pozice a vrátí ho. */
function playFirstLegal(store: GameStore, id: string): Move {
  const record = store.get(id);
  if (record === undefined) {
    throw new Error('partie zmizela');
  }
  const move = legalMoves(record.state.position)[0];
  if (move === undefined) {
    throw new Error('žádný legální tah');
  }
  store.applyMove(id, move);
  return move;
}

describe('GameStore – historie tahů', () => {
  it('nová partie nemá žádné tahy a není archivovaná', () => {
    const store = new GameStore();
    const rec = store.create();
    expect(rec.moves).toEqual([]);
    expect(rec.archived).toBe(false);
  });

  it('applyMove ukládá tahy v pořadí, jak byly zahrány', () => {
    const store = new GameStore();
    const { id } = store.create();
    const m1 = playFirstLegal(store, id);
    const m2 = playFirstLegal(store, id);
    const m3 = playFirstLegal(store, id);

    const rec = store.get(id);
    expect(rec?.moves).toEqual([m1, m2, m3]);
  });

  it('applyMove neexistující partie nic nepřidá (vrací undefined)', () => {
    const store = new GameStore();
    const move: Move = { from: 11, path: [15], captures: [] };
    expect(store.applyMove('neexistuje', move)).toBeUndefined();
  });
});

describe('GameStore – markArchived (právě jednou)', () => {
  it('poprvé překlopí na true, podruhé už vrací false', () => {
    const store = new GameStore();
    const { id } = store.create();
    expect(store.markArchived(id)).toBe(true);
    expect(store.markArchived(id)).toBe(false);
    expect(store.get(id)?.archived).toBe(true);
  });

  it('neexistující partie → false', () => {
    const store = new GameStore();
    expect(store.markArchived('neexistuje')).toBe(false);
  });
});

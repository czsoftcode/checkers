/**
 * Unit testy úložiště: evidence odehraných tahů a příznak `archived`.
 * Bez těchhle dvou věcí nejde sestavit archivní PDN (fáze 23), proto se
 * fixují přímo na reálném `GameStore`, ne na mocku.
 */

import { describe, expect, it } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move } from '@checkers/rules';
import { GameStore, effectiveResult } from '../src/index.js';

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

describe('GameStore – úroveň partie', () => {
  it('create() bez argumentu → výchozí Profesionál', () => {
    const store = new GameStore();
    expect(store.create().level).toBe('professional');
  });

  it('create("beginner") uloží úroveň a ta přežije applyMove i get', () => {
    const store = new GameStore();
    const { id, level } = store.create('beginner');
    expect(level).toBe('beginner');
    playFirstLegal(store, id);
    expect(store.get(id)?.level).toBe('beginner');
  });
});

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

describe('GameStore – vzdání (forcedResult)', () => {
  it('nová partie nemá vynucený výsledek a je ongoing', () => {
    const store = new GameStore();
    const rec = store.create();
    expect(rec.forcedResult).toBeNull();
    expect(effectiveResult(rec)).toBe('ongoing');
  });

  it('resign nastaví white-wins a efektivní výsledek se překlopí', () => {
    const store = new GameStore();
    const { id } = store.create();
    const rec = store.resign(id);
    expect(rec).not.toBe('not-found');
    expect(rec).not.toBe('already-over');
    if (rec === 'not-found' || rec === 'already-over') {
      throw new Error('resign měl uspět');
    }
    expect(rec.forcedResult).toBe('white-wins');
    expect(effectiveResult(rec)).toBe('white-wins');
    // vynucený výsledek nemění stav pravidel – pozice zůstává rozehraná
    expect(rec.state.position.turn).toBe('black');
  });

  it('druhé vzdání už vrací "already-over" a výsledek se nemění', () => {
    const store = new GameStore();
    const { id } = store.create();
    store.resign(id);
    expect(store.resign(id)).toBe('already-over');
    expect(store.get(id)?.forcedResult).toBe('white-wins');
  });

  it('vzdání neexistující partie → "not-found"', () => {
    const store = new GameStore();
    expect(store.resign('neexistuje')).toBe('not-found');
  });

  it('effectiveResult bez vynuceného výsledku plyne z pozice (ongoing)', () => {
    const store = new GameStore();
    const rec = store.create();
    // forcedResult === null → efektivní výsledek = gameResultFromState
    expect(effectiveResult({ forcedResult: null, state: rec.state })).toBe('ongoing');
  });
});

describe('GameStore – přijetí remízy (acceptDraw)', () => {
  it('acceptDraw nastaví draw a efektivní výsledek se překlopí', () => {
    const store = new GameStore();
    const { id } = store.create();
    const rec = store.acceptDraw(id);
    if (rec === 'not-found' || rec === 'already-over') {
      throw new Error('acceptDraw měl uspět');
    }
    expect(rec.forcedResult).toBe('draw');
    expect(effectiveResult(rec)).toBe('draw');
    // vynucený výsledek nemění stav pravidel – pozice zůstává rozehraná
    expect(rec.state.position.turn).toBe('black');
  });

  it('druhé přijetí už vrací "already-over" a výsledek se nemění', () => {
    const store = new GameStore();
    const { id } = store.create();
    store.acceptDraw(id);
    expect(store.acceptDraw(id)).toBe('already-over');
    expect(store.get(id)?.forcedResult).toBe('draw');
  });

  it('přijetí už vzdané partie → "already-over" (draw nepřepíše white-wins)', () => {
    const store = new GameStore();
    const { id } = store.create();
    store.resign(id);
    expect(store.acceptDraw(id)).toBe('already-over');
    expect(store.get(id)?.forcedResult).toBe('white-wins');
  });

  it('přijetí neexistující partie → "not-found"', () => {
    const store = new GameStore();
    expect(store.acceptDraw('neexistuje')).toBe('not-found');
  });
});

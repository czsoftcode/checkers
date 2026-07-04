import type { Move } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { TranspositionTable } from '../src/transposition.js';

const MOVE_A: Move = { from: 11, path: [15], captures: [] };
const MOVE_B: Move = { from: 22, path: [18], captures: [] };

describe('TranspositionTable – kontrakt konstruktoru', () => {
  it('odmítne neplatný exponent velikosti', () => {
    expect(() => new TranspositionTable(0)).toThrow(RangeError);
    expect(() => new TranspositionTable(25)).toThrow(RangeError);
    expect(() => new TranspositionTable(1.5)).toThrow(RangeError);
  });
});

describe('TranspositionTable – zápis a čtení', () => {
  it('uložený záznam se přečte zpět celý', () => {
    const tt = new TranspositionTable(8);
    tt.store(12345, 4, 42, 'exact', MOVE_A);
    const entry = tt.probe(12345);
    expect(entry).not.toBeNull();
    expect(entry).toEqual({ key: 12345, depth: 4, score: 42, bound: 'exact', bestMove: MOVE_A });
  });

  it('neexistující klíč vrací null', () => {
    const tt = new TranspositionTable(8);
    tt.store(1, 3, 10, 'lower', null);
    expect(tt.probe(2)).toBeNull();
  });

  it('clear() vyprázdní tabulku', () => {
    const tt = new TranspositionTable(8);
    tt.store(7, 3, 10, 'exact', MOVE_A);
    tt.clear();
    expect(tt.probe(7)).toBeNull();
  });
});

describe('TranspositionTable – ověření plného klíče (kolize kbelíku)', () => {
  it('dva klíče na stejném poli se nezamění; čte se jen shodný klíč', () => {
    const size = 2 ** 8; // 256
    const tt = new TranspositionTable(8);
    const key = 5;
    const collidingKey = key + size; // stejný index (key % size), jiný klíč
    expect(collidingKey % size).toBe(key % size);

    // Uložíme HLUBŠÍ záznam pod collidingKey; probe(key) ho nesmí vrátit.
    tt.store(collidingKey, 6, 99, 'exact', MOVE_B);
    expect(tt.probe(key)).toBeNull();
    expect(tt.probe(collidingKey)?.score).toBe(99);
  });
});

describe('TranspositionTable – náhrada preferuj hlubší', () => {
  it('mělčí záznam nepřepíše hlubší na stejném poli', () => {
    const size = 2 ** 8;
    const tt = new TranspositionTable(8);
    const key = 3;
    const collidingKey = key + size;

    tt.store(key, 5, 50, 'exact', MOVE_A); // hluboký
    tt.store(collidingKey, 2, 20, 'exact', MOVE_B); // mělčí, stejné pole → zahozen
    expect(tt.probe(key)?.depth).toBe(5);
    expect(tt.probe(collidingKey)).toBeNull();
  });

  it('hlubší (nebo shodně hluboký) záznam přepíše', () => {
    const size = 2 ** 8;
    const tt = new TranspositionTable(8);
    const key = 3;
    const collidingKey = key + size;

    tt.store(key, 2, 20, 'exact', MOVE_A);
    tt.store(collidingKey, 4, 40, 'lower', MOVE_B); // hlubší → přepíše
    expect(tt.probe(key)).toBeNull();
    expect(tt.probe(collidingKey)?.score).toBe(40);
  });
});

import { initialPosition, legalMoves } from '@checkers/rules';
import type { Cell, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { handleLine } from '../src/handler.js';
import { mulberry32 } from '../src/prng.js';
import { ENGINE_ID, PROTOCOL_VERSION } from '../src/protocol.js';
import { makePosition } from './support/position.js';

/** Zavolá handleLine s čerstvým seedovaným PRNG (rng = tie-break searche). */
function handle(raw: string, seed = 1) {
  return handleLine(raw, mulberry32(seed));
}

/** Deska z `count` prázdných polí (typované, ať lint nevidí any[]). */
function emptyBoard(count: number): null[] {
  return Array.from({ length: count }, () => null);
}

/** Pozice, kde hráč na tahu nemá žádný kámen → žádný legální tah. */
function positionWithoutMoves(): Position {
  const board: Cell[] = Array.from({ length: 32 }, () => null);
  board[0] = { color: 'white', kind: 'man' };
  return { board, turn: 'black' };
}

describe('handleLine – hello', () => {
  it('vrací protocol, engine id a echo id', () => {
    expect(handle(JSON.stringify({ type: 'hello', id: 'h-1' }))).toEqual({
      type: 'hello',
      id: 'h-1',
      protocol: PROTOCOL_VERSION,
      engine: ENGINE_ID,
    });
  });
});

describe('handleLine – bestmove', () => {
  it('vrací legální tah z výchozí pozice s echo id', () => {
    const raw = JSON.stringify({ type: 'bestmove', id: 'm-1', position: initialPosition() });
    const response = handle(raw);
    expect(response.type).toBe('bestmove');
    expect(response.id).toBe('m-1');
    if (response.type !== 'bestmove') {
      throw new Error('nedosažitelné, zúžení typu');
    }
    expect(legalMoves(initialPosition())).toContainEqual(response.move);
  });

  it('stejný seed vybírá stejný tah (reprodukovatelnost)', () => {
    const raw = JSON.stringify({ type: 'bestmove', id: 'm-2', position: initialPosition() });
    expect(handle(raw, 42)).toEqual(handle(raw, 42));
  });

  it('tah vybírá search, ne náhoda: jedinou výhru v 1 vrací při každém seedu', () => {
    // Stejná pozice jako v search.test.ts: jediný vyhrávající tah je 21→25
    // (zablokuje posledního bílého muže v rohu). Náhodný výběr ze 4 legálních
    // tahů by přes 5 seedů skoro jistě aspoň jednou uhnul.
    const position = makePosition('black', { 13: 'bm', 21: 'bm', 22: 'bm', 29: 'wm' });
    const raw = JSON.stringify({ type: 'bestmove', id: 'm-4', position });
    for (const seed of [1, 2, 42, 777, 123456]) {
      expect(handle(raw, seed)).toEqual({
        type: 'bestmove',
        id: 'm-4',
        move: { from: 21, path: [25], captures: [] },
      });
    }
  });

  it('pozice bez legálních tahů vrací error no_legal_moves', () => {
    const raw = JSON.stringify({ type: 'bestmove', id: 'm-3', position: positionWithoutMoves() });
    expect(handle(raw)).toMatchObject({ type: 'error', id: 'm-3', code: 'no_legal_moves' });
  });
});

describe('handleLine – chybové větve vstupu', () => {
  it('nevalidní JSON vrací invalid_json s id null', () => {
    expect(handle('tohle není json')).toMatchObject({
      type: 'error',
      id: null,
      code: 'invalid_json',
    });
  });

  it.each([
    ['číslo', '42'],
    ['string', '"zprava"'],
    ['null', 'null'],
    ['pole', '[{"type":"hello","id":"a"}]'],
  ])('JSON, který není objekt (%s), vrací invalid_message', (_label, raw) => {
    expect(handle(raw)).toMatchObject({ type: 'error', id: null, code: 'invalid_message' });
  });

  it('chybějící id vrací invalid_message s id null', () => {
    expect(handle(JSON.stringify({ type: 'hello' }))).toMatchObject({
      type: 'error',
      id: null,
      code: 'invalid_message',
    });
  });

  it('nestringové id vrací invalid_message s id null (id se nepřebírá)', () => {
    expect(handle(JSON.stringify({ type: 'hello', id: 7 }))).toMatchObject({
      type: 'error',
      id: null,
      code: 'invalid_message',
    });
  });

  it('chybějící type vrací invalid_message s echo id', () => {
    expect(handle(JSON.stringify({ id: 'x-1' }))).toMatchObject({
      type: 'error',
      id: 'x-1',
      code: 'invalid_message',
    });
  });

  it('neznámý typ zprávy vrací unknown_type s echo id', () => {
    expect(handle(JSON.stringify({ type: 'ponder', id: 'x-2' }))).toMatchObject({
      type: 'error',
      id: 'x-2',
      code: 'unknown_type',
    });
  });

  it.each([
    ['chybějící position', { type: 'bestmove', id: 'p-1' }],
    ['position není objekt', { type: 'bestmove', id: 'p-1', position: 'e4' }],
    ['board není pole', { type: 'bestmove', id: 'p-1', position: { board: 32, turn: 'black' } }],
    [
      'board má špatnou délku',
      { type: 'bestmove', id: 'p-1', position: { board: emptyBoard(31), turn: 'black' } },
    ],
    [
      'nevalidní kámen na desce',
      {
        type: 'bestmove',
        id: 'p-1',
        position: {
          board: [{ color: 'red', kind: 'man' }, ...emptyBoard(31)],
          turn: 'black',
        },
      },
    ],
    [
      'nevalidní turn',
      { type: 'bestmove', id: 'p-1', position: { board: emptyBoard(32), turn: 'green' } },
    ],
  ])('%s vrací invalid_position s echo id', (_label, message) => {
    expect(handle(JSON.stringify(message))).toMatchObject({
      type: 'error',
      id: 'p-1',
      code: 'invalid_position',
    });
  });
});

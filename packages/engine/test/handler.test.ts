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

/**
 * Deterministická varianta: krokující falešné hodiny (postup o 0,5 ms při
 * každém odečtu), takže dosažená hloubka searche nezávisí na rychlosti
 * stroje a dva běhy se stejným seedem vrací identickou odpověď.
 */
function handleDeterministic(raw: string, seed = 1) {
  let t = 0;
  return handleLine(raw, mulberry32(seed), () => {
    t += 0.5;
    return t;
  });
}

/** Rychlý měkký limit pro testovací bestmove zprávy. */
const TIME_MS = 25;

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
  it('verze protokolu je přibitá literálem (zvednutí = vědomá změna kontraktu)', () => {
    // Ostatní testy porovnávají proti importované konstantě – to je vůči
    // omylem změněné verzi tautologie; tady se kontrakt přibíjí natvrdo.
    expect(PROTOCOL_VERSION).toBe(3);
  });

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
    const raw = JSON.stringify({ type: 'bestmove', id: 'm-1', position: initialPosition(), timeMs: TIME_MS });
    const response = handle(raw);
    expect(response.type).toBe('bestmove');
    expect(response.id).toBe('m-1');
    if (response.type !== 'bestmove') {
      throw new Error('nedosažitelné, zúžení typu');
    }
    expect(legalMoves(initialPosition())).toContainEqual(response.move);
  });

  it('stejný seed vybírá stejný tah (reprodukovatelnost s falešnými hodinami)', () => {
    // Se skutečnými hodinami by dva běhy mohly dosáhnout různé hloubky
    // a vybrat různé tahy – determinismus platí při stejném seedu I čase.
    const raw = JSON.stringify({ type: 'bestmove', id: 'm-2', position: initialPosition(), timeMs: TIME_MS });
    expect(handleDeterministic(raw, 42)).toEqual(handleDeterministic(raw, 42));
  });

  it('tah vybírá search, ne náhoda: jedinou výhru v 1 vrací při každém seedu', () => {
    // Stejná pozice jako v search.test.ts: jediný vyhrávající tah je 21→25
    // (zablokuje posledního bílého muže v rohu). Náhodný výběr ze 4 legálních
    // tahů by přes 5 seedů skoro jistě aspoň jednou uhnul. Výsledek nezávisí
    // na dosažené hloubce: výhra v 1 má WIN_SCORE - 1 v každé hloubce ≥ 1.
    const position = makePosition('black', { 13: 'bm', 21: 'bm', 22: 'bm', 29: 'wm' });
    const raw = JSON.stringify({ type: 'bestmove', id: 'm-4', position, timeMs: TIME_MS });
    for (const seed of [1, 2, 42, 777, 123456]) {
      expect(handle(raw, seed)).toEqual({
        type: 'bestmove',
        id: 'm-4',
        move: { from: 21, path: [25], captures: [] },
      });
    }
  });

  it('pozice bez legálních tahů vrací error no_legal_moves', () => {
    const raw = JSON.stringify({ type: 'bestmove', id: 'm-3', position: positionWithoutMoves(), timeMs: TIME_MS });
    expect(handle(raw)).toMatchObject({ type: 'error', id: 'm-3', code: 'no_legal_moves' });
  });

  it.each([
    ['chybějící timeMs', { type: 'bestmove', id: 't-1', position: initialPosition() }],
    ['timeMs není číslo', { type: 'bestmove', id: 't-1', position: initialPosition(), timeMs: '100' }],
    ['timeMs nula', { type: 'bestmove', id: 't-1', position: initialPosition(), timeMs: 0 }],
    ['timeMs záporné', { type: 'bestmove', id: 't-1', position: initialPosition(), timeMs: -50 }],
    ['timeMs necelé', { type: 'bestmove', id: 't-1', position: initialPosition(), timeMs: 1.5 }],
    ['timeMs null', { type: 'bestmove', id: 't-1', position: initialPosition(), timeMs: null }],
  ])('%s vrací invalid_message s echo id', (_label, message) => {
    expect(handle(JSON.stringify(message))).toMatchObject({
      type: 'error',
      id: 't-1',
      code: 'invalid_message',
    });
  });

  it('vadný timeMs má přednost před vadnou pozicí (kontrola obálky dřív)', () => {
    const raw = JSON.stringify({ type: 'bestmove', id: 't-2', position: 'e4', timeMs: 0 });
    expect(handle(raw)).toMatchObject({ type: 'error', id: 't-2', code: 'invalid_message' });
  });
});

describe('handleLine – evaluate', () => {
  it('vrací skóre pozice s echo id (score je číslo)', () => {
    const raw = JSON.stringify({ type: 'evaluate', id: 'e-1', position: initialPosition(), timeMs: TIME_MS });
    const response = handle(raw);
    expect(response.type).toBe('evaluate');
    expect(response.id).toBe('e-1');
    if (response.type !== 'evaluate') {
      throw new Error('nedosažitelné, zúžení typu');
    }
    expect(typeof response.score).toBe('number');
  });

  it('skóre je z pohledu strany na tahu: strana s vyhranou pozicí má výrazně kladné', () => {
    // Táž pozice jako u bestmove: černý na tahu vyhrává v 1 (21→25). Skóre z
    // pohledu STRANY NA TAHU (černý) musí být výrazně kladné (mat-skóre).
    // Kdyby handler vracel skóre s obráceným znaménkem, tenhle test padne.
    const position = makePosition('black', { 13: 'bm', 21: 'bm', 22: 'bm', 29: 'wm' });
    const raw = JSON.stringify({ type: 'evaluate', id: 'e-2', position, timeMs: TIME_MS });
    const response = handle(raw);
    if (response.type !== 'evaluate') {
      throw new Error(`čekal evaluate, přišlo ${response.type}`);
    }
    expect(response.score).toBeGreaterThan(1000);
  });

  it('opačná strana na tahu v materiálně prohrané pozici má výrazně záporné skóre', () => {
    // Stejné rozestavění, ale na tahu je bílý s jediným mužem proti třem –
    // materiálně prohrává, skóre z jeho pohledu musí být výrazně záporné.
    // Dvojice testů přibíjí ZNAMÉNKO: kladné pro vedoucí, záporné pro prohrávající.
    const position = makePosition('white', { 13: 'bm', 21: 'bm', 22: 'bm', 29: 'wm' });
    const raw = JSON.stringify({ type: 'evaluate', id: 'e-3', position, timeMs: TIME_MS });
    const response = handle(raw);
    if (response.type !== 'evaluate') {
      throw new Error(`čekal evaluate, přišlo ${response.type}`);
    }
    expect(response.score).toBeLessThan(0);
  });

  it('pozice bez legálních tahů vrací error no_legal_moves', () => {
    const raw = JSON.stringify({ type: 'evaluate', id: 'e-4', position: positionWithoutMoves(), timeMs: TIME_MS });
    expect(handle(raw)).toMatchObject({ type: 'error', id: 'e-4', code: 'no_legal_moves' });
  });

  it.each([
    ['chybějící timeMs', { type: 'evaluate', id: 'et-1', position: initialPosition() }],
    ['timeMs není číslo', { type: 'evaluate', id: 'et-1', position: initialPosition(), timeMs: '100' }],
    ['timeMs nula', { type: 'evaluate', id: 'et-1', position: initialPosition(), timeMs: 0 }],
    ['timeMs necelé', { type: 'evaluate', id: 'et-1', position: initialPosition(), timeMs: 1.5 }],
  ])('%s vrací invalid_message s echo id', (_label, message) => {
    expect(handle(JSON.stringify(message))).toMatchObject({
      type: 'error',
      id: 'et-1',
      code: 'invalid_message',
    });
  });

  it('nevalidní pozice vrací invalid_position s echo id', () => {
    const raw = JSON.stringify({ type: 'evaluate', id: 'ep-1', position: 'e4', timeMs: TIME_MS });
    expect(handle(raw)).toMatchObject({ type: 'error', id: 'ep-1', code: 'invalid_position' });
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
    // timeMs je validní, aby se došlo až ke kontrole pozice (obálka jde dřív)
    expect(handle(JSON.stringify({ ...message, timeMs: TIME_MS }))).toMatchObject({
      type: 'error',
      id: 'p-1',
      code: 'invalid_position',
    });
  });
});

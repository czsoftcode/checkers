import { AMERICAN_RULESET, POOL_RULESET, initialPosition, legalMoves } from '@checkers/rules';
import type { Cell, Move, Position } from '@checkers/rules';
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

  it.each([
    ['maxDepth nula', { maxDepth: 0 }],
    ['maxDepth záporné', { maxDepth: -3 }],
    ['maxDepth necelé', { maxDepth: 2.5 }],
    ['maxDepth není číslo', { maxDepth: '4' }],
    ['maxDepth null', { maxDepth: null }],
    ['carelessness pod rozsahem', { carelessness: -0.1 }],
    ['carelessness nad rozsahem', { carelessness: 1.5 }],
    ['carelessness není číslo', { carelessness: '0.5' }],
    ['carelessness NaN', { carelessness: Number.NaN }],
  ])('vadná páka síly (%s) vrací invalid_message s echo id', (_label, extra) => {
    const raw = JSON.stringify({
      type: 'bestmove',
      id: 's-1',
      position: initialPosition(),
      timeMs: TIME_MS,
      ...extra,
    });
    expect(handle(raw)).toMatchObject({ type: 'error', id: 's-1', code: 'invalid_message' });
  });

  it('platné páky síly (maxDepth, carelessness) vrací legální tah', () => {
    const raw = JSON.stringify({
      type: 'bestmove',
      id: 's-2',
      position: initialPosition(),
      timeMs: TIME_MS,
      maxDepth: 1,
      carelessness: 0.5,
    });
    const response = handle(raw);
    if (response.type !== 'bestmove') {
      throw new Error(`čekal bestmove, přišlo ${response.type}`);
    }
    expect(legalMoves(initialPosition())).toContainEqual(response.move);
  });

  it('carelessness > 0 odkloní výběr: přes handler jiný tah než Profesionál (integrační zub)', () => {
    // Pozice se dvěma úrovněmi skóre: nejlepší 10×17 (přes 14), o úroveň horší
    // 10×19 (přes 15, přijde zpětné braní). Profesionál hraje 10×17; s
    // carelessness 1 MUSÍ handler přes ranked režim searchTimed + chooseMove
    // vybrat 10×19. Kdyby se carelessness/maxDepth do searche a výběru
    // nepředaly (spojka handler→search/chooseMove), tahy by byly shodné.
    const position = makePosition('black', { 1: 'bm', 10: 'bm', 14: 'wm', 15: 'wm', 16: 'wk' });
    const pro = handleDeterministic(
      JSON.stringify({ type: 'bestmove', id: 'c', position, timeMs: TIME_MS }),
      3,
    );
    const careless = handleDeterministic(
      JSON.stringify({ type: 'bestmove', id: 'c', position, timeMs: TIME_MS, carelessness: 1 }),
      3,
    );
    expect(pro).toMatchObject({ move: { from: 10, path: [17], captures: [14] } });
    expect(careless).toMatchObject({ move: { from: 10, path: [19], captures: [15] } });
  });

  it('chybějící páky síly = Profesionál: shodné s dnešním chováním (beze změny)', () => {
    // Bez maxDepth/carelessness musí handler vybrat týž tah jako holá zpráva –
    // pojistka, že přidání polí neposunulo losování rng ani default hloubky.
    const position = makePosition('black', { 13: 'bm', 21: 'bm', 22: 'bm', 29: 'wm' });
    const bare = JSON.stringify({ type: 'bestmove', id: 'p', position, timeMs: TIME_MS });
    const withZero = JSON.stringify({
      type: 'bestmove', id: 'p', position, timeMs: TIME_MS, carelessness: 0,
    });
    expect(handle(bare, 7)).toEqual(handle(withZero, 7));
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

/**
 * Plumbing varianty přes protokol (fáze 100). Pozice: černý muž 18, bílý muž 14
 * SEVERNĚ (za zády). V POOL musí černý brát VZAD (jediný legální tah
 * {18→9, bere 14}); v AMERICKÉ muž vzad nebere → prosté tahy vpřed. Tím se na
 * jedné pozici pozná, jestli engine reálně počítá pravidly VARIANTY, ne americky.
 *
 * ZUBY: kdyby handler variantu ignoroval a hledal americky, na pool požadavku by
 * vrátil prostý tah bez braní (nebo tah nelegální v poolu) a `expect` na braní
 * padne. Kdyby naopak default nebyl americký, americký požadavek by vrátil braní.
 */
describe('handleLine – varianta (plumbing)', () => {
  // Sdílená s ruleset-seam.test.ts (rules): 18 černý muž, 14 bílý muž.
  const backwardCapture = makePosition('black', { 18: 'bm', 14: 'wm' });

  /** Je `move` prvkem `legalMoves(position, ruleset)` (strukturální shoda)? */
  function isMemberOf(move: Move, moves: readonly Move[]): boolean {
    return moves.some(
      (m) =>
        m.from === move.from &&
        m.path.length === move.path.length &&
        m.path.every((p, i) => p === move.path[i]) &&
        m.captures.length === move.captures.length &&
        m.captures.every((c, i) => c === move.captures[i]),
    );
  }

  it('bestmove variant:pool → vrátí LEGÁLNÍ pool tah (braní vzad)', () => {
    const res = handleDeterministic(
      JSON.stringify({
        type: 'bestmove',
        id: 'v-1',
        position: backwardCapture,
        timeMs: TIME_MS,
        variant: 'pool',
      }),
    );
    expect(res.type).toBe('bestmove');
    if (res.type !== 'bestmove') return;
    // Tah je legální v POOL a NENÍ legální v AMERICKÉ (braní vzad) – důkaz, že
    // engine počítal pool pravidly.
    expect(isMemberOf(res.move, legalMoves(backwardCapture, POOL_RULESET))).toBe(true);
    expect(isMemberOf(res.move, legalMoves(backwardCapture, AMERICAN_RULESET))).toBe(false);
    expect(res.move.captures.length).toBeGreaterThan(0);
  });

  it('bestmove BEZ variant → americká (žádné braní vzad)', () => {
    const res = handleDeterministic(
      JSON.stringify({
        type: 'bestmove',
        id: 'v-2',
        position: backwardCapture,
        timeMs: TIME_MS,
      }),
    );
    expect(res.type).toBe('bestmove');
    if (res.type !== 'bestmove') return;
    expect(isMemberOf(res.move, legalMoves(backwardCapture, AMERICAN_RULESET))).toBe(true);
    expect(res.move.captures.length).toBe(0);
  });

  it('evaluate variant:pool → skóre bez chyby (plumbing i pro evaluate)', () => {
    const res = handleDeterministic(
      JSON.stringify({
        type: 'evaluate',
        id: 'v-3',
        position: backwardCapture,
        timeMs: TIME_MS,
        variant: 'pool',
      }),
    );
    expect(res.type).toBe('evaluate');
    if (res.type !== 'evaluate') return;
    expect(Number.isInteger(res.score)).toBe(true);
  });

  it('neznámá varianta → invalid_message (NEdefaultuje na americkou)', () => {
    const res = handleDeterministic(
      JSON.stringify({
        type: 'bestmove',
        id: 'v-4',
        position: backwardCapture,
        timeMs: TIME_MS,
        variant: 'checkers',
      }),
    );
    expect(res).toMatchObject({ type: 'error', id: 'v-4', code: 'invalid_message' });
  });
});

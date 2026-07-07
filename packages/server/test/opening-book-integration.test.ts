/**
 * Integrační testy knihy zahájení v cestě tahu soupeře (fáze 56), přes
 * `app.inject`. Kniha se injektuje řízeně (`buildApp({ openingBook })`), takže
 * testy nezávisí na obsahu produkčního seedu.
 *
 * Engine je STUB, který POČÍTÁ volání `bestmove` – to je jádro zubů: při zásahu
 * knihy se engine NESMÍ volat (jinak by kniha nic nešetřila a „hraje z knihy" by
 * byla iluze). Scénář: člověk (černý) zahraje první tah, pak je na tahu engine
 * (bílý) v pozici P; podle toho, co je v knize a jaká je úroveň, se ověří, zda
 * engine dostal dotaz.
 *
 * Pokrytí:
 *  1) zásah na plnosilové úrovni → engine.bestmove se NEVOLÁ, aplikuje se knižní tah,
 *  2) mimo knihu → engine.bestmove SE volá (fallback),
 *  3) oslabená úroveň (beginner) na pozici, co JE v knize → engine se přesto volá,
 *  4) nelegální knižní tah → fallback na engine, bez pádu.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { applyMove, initialPosition, legalMoves, positionKey } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import type { FastifyInstance } from 'fastify';

import { buildApp, findLegalMove } from '../src/index.js';
import type { EngineMover, GameDto, GameLevel } from '../src/index.js';

/** Stub enginu, který počítá volání bestmove a jinak vrací první legální tah. */
interface SpyEngine extends EngineMover {
  calls: number;
}
function spyEngine(): SpyEngine {
  const engine: SpyEngine = {
    calls: 0,
    bestmove(position: Position): Promise<Move> {
      engine.calls += 1;
      const move = legalMoves(position)[0];
      return move === undefined
        ? Promise.reject(new Error('spy: pozice bez tahu'))
        : Promise.resolve(move);
    },
    evaluate: () => Promise.resolve({ score: 0 }),
  };
  return engine;
}

/** Prostý tah `from`-`to` z reálných pravidel. */
function simpleMove(position: Position, from: number, to: number): Move {
  const move = legalMoves(position).find(
    (m) => m.from === from && m.path.length === 1 && m.path[0] === to && m.captures.length === 0,
  );
  if (move === undefined) {
    throw new Error(`Testovací tah ${from}-${to} není legální`);
  }
  return move;
}

// Deterministický první tah člověka (černého) = první legální tah výchozí pozice.
// Z něj plyne pozice P, kde je na tahu engine (bílý). Kniha se klíčuje podle P.
const BLACK_FIRST = simpleMove(initialPosition(), legalMoves(initialPosition())[0]!.from, legalMoves(initialPosition())[0]!.path[0]!);
const POS_ENGINE_TO_MOVE: Position = applyMove(initialPosition(), BLACK_FIRST);
// Knižní tah bílého v P (legální) – jiný než ten, co by vrátil stub (stub bere
// legalMoves[0]); vezmeme poslední legální tah, ať se od stubu odliší.
const WHITE_BOOK_MOVE: Move = (() => {
  const moves = legalMoves(POS_ENGINE_TO_MOVE);
  return moves[moves.length - 1]!;
})();

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

async function pollUntil(
  id: string,
  predicate: (dto: GameDto) => boolean,
  timeoutMs = 2000,
): Promise<GameDto> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const dto = (await app.inject({ method: 'GET', url: `/games/${id}` })).json<GameDto>();
    if (predicate(dto)) {
      return dto;
    }
    if (Date.now() > deadline) {
      throw new Error(`polling timeout, poslední stav: ${JSON.stringify(dto)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Založí partii dané úrovně (člověk černý → engine bílý) a zahraje první tah člověka. */
async function createAndPlayFirst(level: GameLevel): Promise<string> {
  const game = (
    await app.inject({ method: 'POST', url: '/games', payload: { level } })
  ).json<GameDto>();
  const res = await app.inject({
    method: 'POST',
    url: `/games/${game.id}/moves`,
    payload: { from: BLACK_FIRST.from, path: BLACK_FIRST.path },
  });
  expect(res.statusCode).toBe(200);
  return game.id;
}

/** Obsah pole (1–32); `undefined` mimo rozsah (noUncheckedIndexedAccess). */
function cellAt(pos: Position, square: number): Position['board'][number] | undefined {
  return pos.board[square - 1];
}

describe('kniha zahájení v cestě tahu soupeře', () => {
  it('1) zásah na profesionálovi → engine.bestmove se NEVOLÁ, hraje se knižní tah', async () => {
    const engine = spyEngine();
    const book = new Map<string, Move>([[positionKey(POS_ENGINE_TO_MOVE), WHITE_BOOK_MOVE]]);
    app = buildApp({ engine, openingBook: book });

    const id = await createAndPlayFirst('professional');
    const done = await pollUntil(id, (d) => d.engineStatus === 'idle' && d.position.turn === 'black');

    expect(engine.calls).toBe(0); // ← zuby: engine se při zásahu neptá
    // Aplikoval se KNIŽNÍ tah: cíl obsazený bílým, výchozí pole prázdné.
    const dest = WHITE_BOOK_MOVE.path[WHITE_BOOK_MOVE.path.length - 1]!;
    expect(cellAt(done.position, dest)).toEqual({ color: 'white', kind: 'man' });
    expect(cellAt(done.position, WHITE_BOOK_MOVE.from)).toBeNull();
    expect(done.result).toBe('ongoing');
  });

  it('2) mimo knihu → engine.bestmove SE volá (fallback)', async () => {
    const engine = spyEngine();
    app = buildApp({ engine, openingBook: new Map() }); // prázdná kniha = vždy miss

    const id = await createAndPlayFirst('professional');
    await pollUntil(id, (d) => d.engineStatus === 'idle' && d.position.turn === 'black');

    expect(engine.calls).toBe(1); // ← fallback: engine dostal dotaz
  });

  it('3) beginner na pozici, co JE v knize → engine se přesto volá (gate)', async () => {
    const engine = spyEngine();
    // Kniha OBSAHUJE P, ale beginner ji nesmí použít.
    const book = new Map<string, Move>([[positionKey(POS_ENGINE_TO_MOVE), WHITE_BOOK_MOVE]]);
    app = buildApp({ engine, openingBook: book });

    const id = await createAndPlayFirst('beginner');
    await pollUntil(id, (d) => d.engineStatus === 'idle' && d.position.turn === 'black');

    expect(engine.calls).toBe(1); // ← oslabená úroveň knihu ignoruje
  });

  it('4) nelegální knižní tah → fallback na engine, bez pádu', async () => {
    const engine = spyEngine();
    // Tah z pole 1 (černý kámen, ne bílý) není v bílých legalMoves(P) → nelegální.
    const illegal: Move = { from: 1, path: [5], captures: [] };
    expect(findLegalMove(POS_ENGINE_TO_MOVE, illegal.from, illegal.path)).toBeUndefined(); // precondition
    const book = new Map<string, Move>([[positionKey(POS_ENGINE_TO_MOVE), illegal]]);
    app = buildApp({ engine, openingBook: book });

    const id = await createAndPlayFirst('professional');
    const done = await pollUntil(id, (d) => d.engineStatus === 'idle' && d.position.turn === 'black');

    expect(engine.calls).toBe(1); // ← nelegální knižní tah spadl do fallbacku, ne do 'error'
    expect(done.result).toBe('ongoing');
  });
});

/**
 * Napojení enginu na server (background tah z POST /moves) + kontrakt
 * `engineStatus` v GameDto. Engine je tady in-process STUB (EngineMover) –
 * orchestrace podprocesu se testuje jinde; sem patří logika handleru:
 * thinking → idle, ověření tahu přes rules, error cesty, opt-in bez enginu.
 *
 * Zuby: kdyby handler tah enginu neaplikoval / neověřoval, testy „engine
 * dotáhne tah" a „nelegální tah → error, neaplikuje se" spadnou.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import type { EngineMover, GameDto } from '../src/index.js';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

/** Stub: vždy vrátí první legální tah dané pozice (autorita ho pak ověří). */
const legalStub: EngineMover = {
  bestmove: (position: Position): Promise<Move> => {
    const move = legalMoves(position)[0];
    if (move === undefined) {
      return Promise.reject(new Error('stub: pozice bez tahu'));
    }
    return Promise.resolve(move);
  },
  evaluate: () => Promise.resolve({ score: 0 }), // nevyužito v testech tahu enginu
};

async function createGame(): Promise<GameDto> {
  const res = await app.inject({ method: 'POST', url: '/games' });
  return res.json<GameDto>();
}

async function playFirstHumanMove(game: GameDto): Promise<GameDto> {
  const first = game.legalMoves[0];
  if (first === undefined) {
    throw new Error('výchozí partie musí mít legální tah');
  }
  const res = await app.inject({
    method: 'POST',
    url: `/games/${game.id}/moves`,
    payload: { from: first.from, path: first.path },
  });
  expect(res.statusCode).toBe(200);
  return res.json<GameDto>();
}

/** Poll GET, dokud predikát nesedí (nebo timeout). Modeluje klientský polling. */
async function pollUntil(
  id: string,
  predicate: (dto: GameDto) => boolean,
  timeoutMs = 2000,
): Promise<GameDto> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/games/${id}` });
    const dto = res.json<GameDto>();
    if (predicate(dto)) {
      return dto;
    }
    if (Date.now() > deadline) {
      throw new Error(`polling timeout, poslední stav: ${JSON.stringify(dto)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('kontrakt engineStatus v GameDto', () => {
  it('nová partie i GET nesou engineStatus "idle"', async () => {
    app = buildApp();
    const game = await createGame();
    expect(game.engineStatus).toBe('idle');
    const got = await app.inject({ method: 'GET', url: `/games/${game.id}` });
    expect(got.json<GameDto>().engineStatus).toBe('idle');
  });
});

describe('bez enginu (opt-in) – server zůstává manuální', () => {
  it('po tahu člověka se nic nespustí, engineStatus zůstane idle, bílý na tahu', async () => {
    app = buildApp(); // žádný engine
    const game = await createGame();
    const after = await playFirstHumanMove(game);
    expect(after.position.turn).toBe('white');
    expect(after.engineStatus).toBe('idle');
  });
});

describe('s enginem – background tah', () => {
  it('POST vrátí HNED stav po tahu člověka s engineStatus "thinking"', async () => {
    app = buildApp({ engine: legalStub });
    const game = await createGame();
    const after = await playFirstHumanMove(game);
    // Odpověď nese stav po tahu ČLOVĚKA (bílý na tahu), engine ještě nedotáhl.
    expect(after.position.turn).toBe('white');
    expect(after.engineStatus).toBe('thinking');
  });

  it('engine dotáhne tah na pozadí: GET nakonec ukáže černého a idle', async () => {
    app = buildApp({ engine: legalStub });
    const game = await createGame();
    await playFirstHumanMove(game);
    const done = await pollUntil(
      game.id,
      (dto) => dto.engineStatus === 'idle' && dto.position.turn === 'black',
    );
    expect(done.result).toBe('ongoing');
    // Engine opravdu táhl – deska už není v pozici hned po tahu člověka.
    expect(done.position.turn).toBe('black');
  });

  it('autorita barvy: člověk nesmí táhnout, když je na tahu engine (bílý) → 409 not_your_turn', async () => {
    // Stub, který nikdy nedotáhne → partie zůstane na tahu bílého (engine „přemýšlí").
    const hangStub: EngineMover = {
      bestmove: (): Promise<Move> => new Promise<Move>(() => undefined),
      evaluate: () => Promise.resolve({ score: 0 }),
    };
    app = buildApp({ engine: hangStub });
    const game = await createGame();
    const after = await playFirstHumanMove(game);
    expect(after.position.turn).toBe('white');
    expect(after.engineStatus).toBe('thinking');

    // Člověk se pokusí zahrát BÍLÝ tah (23→18 je legální pro bílého), ale není
    // na tahu – autorita ho musí odmítnout, jinak přepíše enginu pozici.
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: 23, path: [18] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_your_turn');
  });

  it('nelegální tah enginu → engineStatus "error", tah se NEaplikuje', async () => {
    const illegalStub: EngineMover = {
      bestmove: (): Promise<Move> => Promise.resolve({ from: 99, path: [99], captures: [] }),
      evaluate: () => Promise.resolve({ score: 0 }),
    };
    app = buildApp({ engine: illegalStub });
    const game = await createGame();
    await playFirstHumanMove(game);
    const errored = await pollUntil(game.id, (dto) => dto.engineStatus === 'error');
    // Partie zůstala stát na tahu bílého (engine netáhl), server nespadl.
    expect(errored.position.turn).toBe('white');
  });

  it('pád enginu (reject) → engineStatus "error", partie přežije', async () => {
    const rejectStub: EngineMover = {
      bestmove: (): Promise<Move> => Promise.reject(new Error('boom')),
      evaluate: () => Promise.resolve({ score: 0 }),
    };
    app = buildApp({ engine: rejectStub });
    const game = await createGame();
    await playFirstHumanMove(game);
    const errored = await pollUntil(game.id, (dto) => dto.engineStatus === 'error');
    expect(errored.position.turn).toBe('white');
  });
});

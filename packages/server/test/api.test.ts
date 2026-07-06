/**
 * Integrační testy HTTP API přes app.inject() (bez reálného portu).
 * Pokrývají happy path i unhappy path a fixují drátový kontrakt (tvar Move,
 * tvar chybové obálky), na který se navěsí web klient.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';
import { applyMove, initialPosition } from '@checkers/rules';
import { buildApp, findLegalMove, mulberry32 } from '../src/index.js';
import type { GameDto, MoveDto } from '../src/index.js';

let app: FastifyInstance;

beforeEach(() => {
  app = buildApp();
});

afterEach(async () => {
  await app.close();
});

async function createGame(): Promise<GameDto> {
  const res = await app.inject({ method: 'POST', url: '/games' });
  expect(res.statusCode).toBe(201);
  return res.json<GameDto>();
}

describe('POST /games', () => {
  it('založí partii ve výchozím rozestavění (černý na tahu, ongoing)', async () => {
    const game = await createGame();
    expect(typeof game.id).toBe('string');
    expect(game.id.length).toBeGreaterThan(0);
    expect(game.position.turn).toBe('black');
    expect(game.result).toBe('ongoing');
    expect(game.legalMoves.length).toBeGreaterThan(0);
    // Kontrakt tvaru tahu.
    const move = game.legalMoves[0];
    if (move === undefined) {
      throw new Error('výchozí partie musí mít legální tah');
    }
    expect(Object.keys(move).sort()).toEqual(['captures', 'from', 'path']);
  });

  it('dvě partie mají různé id', async () => {
    const a = await createGame();
    const b = await createGame();
    expect(a.id).not.toBe(b.id);
  });

  it('neballotová partie: ballotMoves je null', async () => {
    const game = await createGame();
    expect(game.ballotIndex).toBeNull();
    expect(game.ballotMoves).toBeNull();
  });
});

describe('POST /games – Mistrovství: ballotMoves v DTO', () => {
  it('championship DTO nese tři ballot tahy, jejichž odehrání z výchozí desky dá servírovanou pozici', async () => {
    // Seedovaný rng → deterministický ballot; engine chybí, takže se nespustí a
    // pozice zůstane popballotová (bílý na tahu). Zub cross-module kontraktu
    // server↔klient: klient z `ballotMoves` skládá mezipozice od `initialPosition`
    // a MUSÍ skončit přesně na `dto.position`. Kdyby dtoFor poslal jiné tahy než
    // ty, které nasadil (špatný slice historie), odehrání by na `position` nedošlo.
    const seeded = buildApp({ rng: mulberry32(7) });
    try {
      const res = await seeded.inject({ method: 'POST', url: '/games', payload: { level: 'championship' } });
      expect(res.statusCode).toBe(201);
      const game = res.json<GameDto>();
      expect(game.level).toBe('championship');
      expect(game.ballotIndex).not.toBeNull();
      expect(game.ballotMoves).not.toBeNull();
      const ballotMoves = game.ballotMoves;
      if (ballotMoves === null) {
        throw new Error('championship partie musí mít ballotMoves');
      }
      expect(ballotMoves).toHaveLength(3);
      for (const move of ballotMoves) {
        expect(Object.keys(move).sort()).toEqual(['captures', 'from', 'path']);
      }
      // Odehraj tři ballot tahy z výchozího rozestavění reálnou cestou rules.
      let position = initialPosition();
      for (const move of ballotMoves) {
        const resolved = findLegalMove(position, move.from, move.path);
        expect(resolved).toBeDefined();
        if (resolved === undefined) {
          throw new Error(`ballot tah ${move.from}->${move.path.join(',')} není legální`);
        }
        position = applyMove(position, resolved);
      }
      expect(position).toEqual(game.position);
      expect(position.turn).toBe('white');
    } finally {
      await seeded.close();
    }
  });
});

describe('GET /games/:id', () => {
  it('vrátí stav existující partie', async () => {
    const created = await createGame();
    const res = await app.inject({ method: 'GET', url: `/games/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<GameDto>().id).toBe(created.id);
  });

  it('neexistující id → 404 game_not_found', async () => {
    const res = await app.inject({ method: 'GET', url: '/games/neexistuje' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('game_not_found');
  });
});

describe('neznámá routa / metoda', () => {
  it('zachová jednotnou obálku (error.code, ne holý string) → 404 not_found', async () => {
    const res = await app.inject({ method: 'GET', url: '/nesmysl' });
    expect(res.statusCode).toBe(404);
    // Kontrakt: i default 404 musí mít strojově čitelný error.code, jinak by
    // klient na překlepnutém URL dostal jiný tvar než u ostatních chyb.
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(typeof body.error).toBe('object');
    expect(body.error.code).toBe('not_found');
  });

  it('nepovolená metoda na existující cestě → 404 not_found (jednotná obálka)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/games/cokoli' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });
});

describe('POST /games/:id/moves – happy path', () => {
  it('legální tah projde, strana na tahu se přehodí', async () => {
    const game = await createGame();
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
    const next = res.json<GameDto>();
    expect(next.position.turn).toBe('white');
    // Stav se opravdu uložil (GET vrátí bílého na tahu).
    const got = await app.inject({ method: 'GET', url: `/games/${game.id}` });
    expect(got.json<GameDto>().position.turn).toBe('white');
  });

  it('klientem podvržené captures/nadbytečné klíče se ignorují (server je autorita)', async () => {
    const game = await createGame();
    const first = game.legalMoves[0];
    if (first === undefined) {
      throw new Error('výchozí partie musí mít legální tah');
    }
    // Klient přiloží nesmyslné captures a cizí klíč. Schéma je zahodí, server
    // si braní odvodí sám – tah prostého otevíracího tahu má captures [].
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: first.from, path: first.path, captures: [999], garbage: true },
    });
    expect(res.statusCode).toBe(200);
    const played = res
      .json<GameDto>()
      .legalMoves.length; // jen kontrola, že odpověď je platný stav
    expect(played).toBeGreaterThan(0);
  });
});

describe('POST /games/:id/moves – unhappy path', () => {
  it('neexistující partie → 404 game_not_found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/games/neexistuje/moves',
      payload: { from: 9, path: [13] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('game_not_found');
  });

  it('tělo mimo schéma (from mimo 1–32) → 400 invalid_request', async () => {
    const game = await createGame();
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: 99, path: [13] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('invalid_request');
  });

  it('prázdné tělo → 400 invalid_request', async () => {
    const game = await createGame();
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('invalid_request');
  });

  it('rozbité JSON tělo → 400 invalid_request (přes error handler)', async () => {
    const game = await createGame();
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      headers: { 'content-type': 'application/json' },
      payload: '{ rozbité',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('invalid_request');
  });

  it('nelegální tah (setrvání na místě) → 409 illegal_move + legalMoves', async () => {
    const game = await createGame();
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: 9, path: [9] },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: { code: string }; legalMoves: MoveDto[] }>();
    expect(body.error.code).toBe('illegal_move');
    // Kontrakt: 409 illegal_move přikládá aktuální legální tahy pro zotavení klienta.
    expect(Array.isArray(body.legalMoves)).toBe(true);
    expect(body.legalMoves.length).toBeGreaterThan(0);
  });

  it('tah druhé strany (bílý kámen, když je na tahu černý) → 409 illegal_move', async () => {
    const game = await createGame();
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: 23, path: [18] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('illegal_move');
  });
});

describe('POST /games/:id/moves – konec partie', () => {
  it('po skončení partie → 409 game_over', async () => {
    const game = await createGame();
    let state = game;
    // Odehraj partii vždy prvním legálním tahem, dokud neskončí. 80-půltahové
    // remízové pravidlo zaručuje terminaci, takže smyčka nemůže běžet věčně.
    let guard = 0;
    while (state.result === 'ongoing') {
      if (++guard > 1000) {
        throw new Error('partie nedospěla ke konci ani po 1000 tazích');
      }
      const move = state.legalMoves[0];
      if (move === undefined) {
        throw new Error('ongoing partie musí mít legální tah');
      }
      const res = await app.inject({
        method: 'POST',
        url: `/games/${game.id}/moves`,
        payload: { from: move.from, path: move.path },
      });
      expect(res.statusCode).toBe(200);
      state = res.json<GameDto>();
    }
    expect(state.result).not.toBe('ongoing');

    // Hazard, kvůli kterému se game_over kontroluje PŘED hledáním legálního
    // tahu: remíza (80 půltahů / opakování) může mít pořád legální tahy. Když
    // sem partie dojede remízou, ověř, že legální tahy existují – jinak by test
    // ten pořadový hazard vůbec neprošel.
    if (state.result === 'draw') {
      expect(state.legalMoves.length).toBeGreaterThan(0);
    }

    // Další tah do skončené partie musí odmítnout jako game_over.
    const after = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: 1, path: [5] },
    });
    expect(after.statusCode).toBe(409);
    expect(after.json<{ error: { code: string } }>().error.code).toBe('game_over');
  });
});

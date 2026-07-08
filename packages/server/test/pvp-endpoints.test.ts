/**
 * Fáze 68 + 70: chování engine-orientovaných REST endpointů na PvP partii.
 *
 * PvP partie (dva lidé, žádný engine) vzniká párováním přes WS. ČTENÍ stavu už
 * funguje (fáze 70): GET /games/:id vrací PvP DTO (bez engine polí). Zápisové /
 * engine-závislé cesty (tah přes REST, vzdání, remíza, nápověda) PvP dál odmítají
 * distinktním 409 `pvp_not_playable` – PvP se hraje výhradně přes room WS (todo 36)
 * a končí až s todo 40. Ani jedna z nich nesmí spadnout 500 na chybějící pole.
 *
 * PvP partii sem dodá přímo `gameStore` přes dekoraci app (REST endpoint pro její
 * založení není – vzniká jen párováním). Ověřuje se přes `app.inject` (bez WS).
 *
 * Zuby: kdyby guard `mode === 'pvp'` na zápisové cestě zmizel, endpoint by na PvP
 * záznamu spadl (500 z engineColorOf/store.resign, nebo z RangeError) → test padne.
 * A kdyby se čtení rozbilo (dtoFor by PvP neuměl), GET by nevrátil 200 DTO.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Move, Position } from '@checkers/rules';

import { buildApp } from '../src/index.js';
import type { EngineMover, GameStore, OpeningBook } from '../src/index.js';

const NO_BOOK: OpeningBook = new Map();

// Engine stub jen aby offer-draw/hint prošly branou „server bez enginu" a DOSÁHLY
// na kontrolu módu (jinak by vrátily draw_offer_unavailable/hint_unavailable dřív).
const engineStub: EngineMover = {
  bestmove: (position: Position): Promise<Move> => {
    // Nedosažitelné v tomhle testu (PvP guard je před voláním enginu); kdyby se
    // přesto zavolal, vrátíme cokoli legálního-vypadajícího, ať se nezasekne.
    void position;
    return Promise.resolve({ from: 1, path: [1], captures: [] });
  },
  evaluate: () => Promise.resolve({ score: 0 }),
};

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

function store(): GameStore {
  return (app as unknown as { gameStore: GameStore }).gameStore;
}

describe('PvP partie na engine REST endpointech (fáze 68)', () => {
  it('GET /games/:id vrátí 200 PvP DTO (fáze 70: čtení stavu funguje), ne 409 ani 500', async () => {
    app = buildApp({ openingBook: NO_BOOK });
    const { id } = store().createPvp('A', 'B');
    const res = await app.inject({ method: 'GET', url: `/games/${id}` });
    expect(res.statusCode).toBe(200);
    const dto = res.json<Record<string, unknown>>();
    expect(dto.mode).toBe('pvp');
    expect(dto.id).toBe(id);
    expect((dto.position as { turn: string }).turn).toBe('black');
    expect(dto.result).toBe('ongoing');
    expect(Array.isArray(dto.legalMoves)).toBe(true);
    // Engine-specifická pole se do PvP DTO nesmí protáhnout (ne falešně null).
    expect(Object.keys(dto).sort()).toEqual(['id', 'legalMoves', 'mode', 'position', 'result']);
  });

  it('POST /games/:id/moves vrátí 409 pvp_not_playable, ne 500', async () => {
    app = buildApp({ openingBook: NO_BOOK });
    const { id } = store().createPvp('A', 'B');
    const res = await app.inject({
      method: 'POST',
      url: `/games/${id}/moves`,
      payload: { from: 9, path: [13] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('pvp_not_playable');
  });

  it('POST /games/:id/resign vrátí 409 pvp_not_playable, ne 500 (store.resign by jinak throwl)', async () => {
    app = buildApp({ openingBook: NO_BOOK });
    const { id } = store().createPvp('A', 'B');
    const res = await app.inject({ method: 'POST', url: `/games/${id}/resign` });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('pvp_not_playable');
  });

  it('POST /games/:id/offer-draw (se zapojeným enginem) vrátí 409 pvp_not_playable', async () => {
    app = buildApp({ openingBook: NO_BOOK, engine: engineStub });
    const { id } = store().createPvp('A', 'B');
    const res = await app.inject({ method: 'POST', url: `/games/${id}/offer-draw` });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('pvp_not_playable');
  });

  it('GET /games/:id/hint (se zapojeným enginem) vrátí 409 pvp_not_playable', async () => {
    app = buildApp({ openingBook: NO_BOOK, engine: engineStub });
    const { id } = store().createPvp('A', 'B');
    const res = await app.inject({ method: 'GET', url: `/games/${id}/hint` });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('pvp_not_playable');
  });

  it('neexistující partie zůstává 404 (PvP guard nepřebíjí not-found)', async () => {
    app = buildApp({ openingBook: NO_BOOK });
    const res = await app.inject({ method: 'GET', url: '/games/neexistuje' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('game_not_found');
  });
});

/**
 * Fáze 70 + 90: čtení stavu PvP partie přes jediný zbylý REST endpoint partie.
 *
 * PvP partie (dva lidé, žádný engine) vzniká párováním přes WS. ČTENÍ stavu
 * funguje: GET /games/:id vrací PvP DTO (bez engine polí). Zápis PvP (tah,
 * vzdání, remíza) i snapshot+push jdou přes room WS a `/games/:id/ws`; serverové
 * AI REST endpointy (POST /games, /moves, /resign, /offer-draw, /hint) byly s
 * fází 90 odstraněny (AI se počítá v prohlížeči).
 *
 * PvP partii sem dodá přímo `gameStore` přes dekoraci app (REST endpoint pro její
 * založení není – vzniká jen párováním). Ověřuje se přes `app.inject` (bez WS).
 *
 * Zuby: kdyby se čtení rozbilo (dtoFor by PvP neuměl), GET by nevrátil 200 DTO;
 * kdyby PvP DTO protáhlo engine pole, kontrakt kláves by neseděl.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/index.js';
import type { GameStore } from '../src/index.js';

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

function store(): GameStore {
  return (app as unknown as { gameStore: GameStore }).gameStore;
}

describe('PvP partie na REST endpointu čtení (fáze 70 + 90)', () => {
  it('GET /games/:id vrátí 200 PvP DTO (čtení stavu funguje), ne 409 ani 500', async () => {
    app = buildApp();
    const { id } = store().createPvp('A', 'B');
    const res = await app.inject({ method: 'GET', url: `/games/${id}` });
    expect(res.statusCode).toBe(200);
    const dto = res.json<Record<string, unknown>>();
    expect(dto.mode).toBe('pvp');
    expect(dto.id).toBe(id);
    expect((dto.position as { turn: string }).turn).toBe('black');
    expect(dto.result).toBe('ongoing');
    expect(dto.reason).toBeNull(); // fáze 78: běžící partie → žádný důvod konce
    expect(dto.variant).toBe('american'); // fáze 104: default partie nese american
    expect(Array.isArray(dto.legalMoves)).toBe(true);
    // Engine-specifická pole se do PvP DTO nesmí protáhnout (ne falešně null).
    // `reason` je součástí PvP kontraktu (fáze 78), `variant` od fáze 104 – oba musí být.
    expect(Object.keys(dto).sort()).toEqual([
      'id',
      'legalMoves',
      'mode',
      'position',
      'reason',
      'result',
      'variant',
    ]);
  });

  it('neexistující partie zůstává 404 (not-found má přednost)', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/games/neexistuje' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('game_not_found');
  });
});

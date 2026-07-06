/**
 * Integrační testy nabídky remízy (fáze 25) přes `app.inject`.
 *
 * Nabídku dává člověk (černý) na svém tahu; rozhoduje engine (bílý) svým skórem,
 * práh přijetí drží server (`DRAW_ACCEPT_MAX_ENGINE_SCORE = 0`: engine přijme, jen
 * když pozici nehodnotí jako svou výhru). Testy fixují:
 *  - ZNAMÉNKO: skóre je z pohledu strany na tahu; server ho na tahu černého
 *    obrací na pohled bílého. Dvojice testů (odmítnutí × přijetí) má zuby –
 *    kdyby se negace zrušila, obě by se překlopily do opačného výsledku.
 *  - přijetí → `draw` + `<id>.pdn` s tokenem 1/2-1/2, dvojí přijetí → 409 +
 *    právě jeden soubor,
 *  - bez enginu → 409 draw_offer_unavailable; engine přemýšlí → 409 engine_busy;
 *  - selhání enginu při vyhodnocení → 503 engine_unavailable, partie beze změny.
 *
 * Stub enginu vrací PEVNÉ skóre a pozici ignoruje: testuje se serverový kontrakt
 * (negace + práh), ne engine. Vlastní znaménko skóre enginu hlídá handler.test.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import type { EngineMover, GameDto } from '../src/index.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'checkers-offerdraw-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface StubOptions {
  /** Skóre z pohledu STRANY NA TAHU, které stub vrátí z evaluate. */
  readonly score?: number;
  /** evaluate selže (simuluje timeout/pád/protokolovou chybu enginu). */
  readonly evaluateFails?: boolean;
  /** bestmove se nikdy nedotáhne (partie uvázne na tahu bílého = „thinking"). */
  readonly bestmoveHangs?: boolean;
  /** bestmove selže → engineStatus 'error', bílý zůstane na tahu (idle≠thinking). */
  readonly bestmoveRejects?: boolean;
}

function stubEngine(opts: StubOptions = {}): EngineMover {
  return {
    bestmove: (position: Position): Promise<Move> => {
      if (opts.bestmoveHangs === true) {
        return new Promise<Move>(() => undefined);
      }
      if (opts.bestmoveRejects === true) {
        return Promise.reject(new Error('stub: bestmove selhal'));
      }
      const move = legalMoves(position)[0];
      return move === undefined
        ? Promise.reject(new Error('stub: pozice bez tahu'))
        : Promise.resolve(move);
    },
    evaluate: () =>
      opts.evaluateFails === true
        ? Promise.reject(new Error('stub: engine boom'))
        : Promise.resolve({ score: opts.score ?? 0 }),
  };
}

async function createGame(app: FastifyInstance): Promise<GameDto> {
  const res = await app.inject({ method: 'POST', url: '/games' });
  expect(res.statusCode).toBe(201);
  return res.json<GameDto>();
}

async function playFirstHumanMove(app: FastifyInstance, game: GameDto): Promise<GameDto> {
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

async function pollUntil(
  app: FastifyInstance,
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

interface OfferResult {
  readonly accepted: boolean;
  readonly game: GameDto;
}

describe('POST /games/:id/offer-draw – rozhodnutí enginu', () => {
  it('bílý vede (skóre černého záporné) → nabídka ODMÍTNUTA, partie běží dál', async () => {
    // Černý na tahu, skóre z jeho pohledu -500 → bílý vede o 500. Server po
    // negaci vidí whiteScore=+500 > 0 → odmítne. ZUBY na znaménko: bez negace by
    // whiteScore=-500 a nabídka by se chybně PŘIJALA.
    const app = buildApp({ engine: stubEngine({ score: -500 }), pdnDir: dir });
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(res.statusCode).toBe(200);
      const body = res.json<OfferResult>();
      expect(body.accepted).toBe(false);
      expect(body.game.result).toBe('ongoing');
      // Nic se neuložilo (partie běží) ani nezměnilo.
      expect(await readdir(dir)).toHaveLength(0);
      expect((await app.inject({ method: 'GET', url: `/games/${game.id}` })).json<GameDto>().result).toBe(
        'ongoing',
      );
    } finally {
      await app.close();
    }
  });

  it('bílý nevede (skóre černého kladné) → nabídka PŘIJATA → draw + PDN 1/2-1/2', async () => {
    // Skóre černého +50 → po negaci whiteScore=-50 ≤ 0 → přijme. ZUBY na znaménko:
    // bez negace by whiteScore=+50 > 0 a nabídka by se chybně ODMÍTLA.
    const app = buildApp({ engine: stubEngine({ score: 50 }), pdnDir: dir });
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(res.statusCode).toBe(200);
      const body = res.json<OfferResult>();
      expect(body.accepted).toBe(true);
      expect(body.game.result).toBe('draw');

      const files = await readdir(dir);
      expect(files).toEqual([`${game.id}.pdn`]);
      const pdn = await readFile(join(dir, `${game.id}.pdn`), 'utf8');
      expect(pdn).toContain('1/2-1/2');
    } finally {
      await app.close();
    }
  });

  it('bílý NA TAHU (engine v erroru): skóre se NEneguje → druhá větev znaménka má zuby', async () => {
    // Když je na tahu bílý, server skóre neobrací (score už je z pohledu bílého).
    // Sem se dostaneme tak, že enginu selže bestmove → engineStatus 'error', bílý
    // zůstane na tahu (ne 'thinking', takže guard nabídku pustí). Skóre bílého +500
    // → whiteScore +500 > 0 → ODMÍTNUTO. ZUBY: kdyby se i tady negovalo, byla by
    // whiteScore -500 a nabídka by se chybně PŘIJALA.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = buildApp({ engine: stubEngine({ bestmoveRejects: true, score: 500 }), pdnDir: dir });
    try {
      const game = await createGame(app);
      await playFirstHumanMove(app, game); // engine selže → error, bílý na tahu
      await pollUntil(app, game.id, (dto) => dto.engineStatus === 'error');

      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(res.statusCode).toBe(200);
      expect(res.json<OfferResult>().accepted).toBe(false);
      expect(res.json<OfferResult>().game.result).toBe('ongoing');
    } finally {
      await app.close();
    }
  });

  it('práh je ostrý na nule: skóre černého 0 → whiteScore 0 ≤ 0 → přijme', async () => {
    const app = buildApp({ engine: stubEngine({ score: 0 }), pdnDir: dir });
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(res.json<OfferResult>().accepted).toBe(true);
      expect(res.json<OfferResult>().game.result).toBe('draw');
    } finally {
      await app.close();
    }
  });

  it('dvojí přijetí → druhé 409 game_over a PRÁVĚ jeden PDN soubor', async () => {
    const app = buildApp({ engine: stubEngine({ score: 50 }), pdnDir: dir });
    try {
      const game = await createGame(app);
      const first = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(first.statusCode).toBe(200);
      expect(first.json<OfferResult>().accepted).toBe(true);

      const second = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(second.statusCode).toBe(409);
      expect(second.json<{ error: { code: string } }>().error.code).toBe('game_over');

      expect(await readdir(dir)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('POST /games/:id/offer-draw – guardy a selhání', () => {
  it('neexistující partie → 404 game_not_found', async () => {
    const app = buildApp({ engine: stubEngine({ score: 0 }) });
    try {
      const res = await app.inject({ method: 'POST', url: '/games/neexistuje/offer-draw' });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('game_not_found');
    } finally {
      await app.close();
    }
  });

  it('bez enginu (manuální režim) → 409 draw_offer_unavailable', async () => {
    const app = buildApp(); // žádný engine
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('draw_offer_unavailable');
    } finally {
      await app.close();
    }
  });

  it('skončená partie (po vzdání) → 409 game_over, engine se ani neptá', async () => {
    const app = buildApp({ engine: stubEngine({ score: 50 }), pdnDir: dir });
    try {
      const game = await createGame(app);
      await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('game_over');
    } finally {
      await app.close();
    }
  });

  it('engine přemýšlí (na tahu bílý) → 409 engine_busy, stav beze změny', async () => {
    const app = buildApp({ engine: stubEngine({ bestmoveHangs: true }) });
    try {
      const game = await createGame(app);
      await playFirstHumanMove(app, game); // bílý na tahu, engine se zasekne v thinking
      await pollUntil(app, game.id, (dto) => dto.engineStatus === 'thinking');

      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('engine_busy');
      // Partie pořád běží (nabídka ji neukončila).
      expect((await app.inject({ method: 'GET', url: `/games/${game.id}` })).json<GameDto>().result).toBe(
        'ongoing',
      );
    } finally {
      await app.close();
    }
  });

  it('engine selže při vyhodnocení → 503 engine_unavailable, partie beze změny', async () => {
    const app = buildApp({ engine: stubEngine({ evaluateFails: true }), pdnDir: dir });
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('engine_unavailable');
      // Selhání NENÍ „engine řekl ne": žádná remíza, žádný zápis na disk.
      expect((await app.inject({ method: 'GET', url: `/games/${game.id}` })).json<GameDto>().result).toBe(
        'ongoing',
      );
      expect(await readdir(dir)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

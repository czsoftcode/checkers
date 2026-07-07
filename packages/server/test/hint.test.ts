/**
 * Integrační testy nápovědy tahu (fáze 44, mód „Výuka") přes `app.inject`.
 *
 * `GET /games/:id/hint` vrátí enginem doporučený legální tah pro člověka (stranu
 * na tahu). Read-only: stav partie se nemění. Testy fixují kontrakt:
 *  - happy path → 200 { move: MoveDto } a stav partie ZŮSTANE beze změny,
 *  - engine je nedůvěryhodný: nelegální doporučený tah se NEPODÁ (503),
 *  - guardy: 404 (neexistuje), 409 game_over, 409 not_your_turn, 409
 *    hint_unavailable (bez enginu), 503 engine_unavailable (pád enginu).
 *
 * Stub enginu ignoruje sílu i většinu pozice: testuje se serverový kontrakt, ne
 * engine. Zuby: u nelegálního výstupu stub vrací záměrně nesmyslný tah – kdyby
 * server výstup enginu neověřoval, test spadne (podal by nelegální nápovědu).
 */

import { describe, expect, it, vi } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import type { EngineMover, GameDto, MoveDto, Strength, OpeningBook } from '../src/index.js';

// Cvičí ENGINE (nápověda tahu, guardy), ne knihu zahájení: partie stavíme s
// PRÁZDNOU knihou, aby knižní zkrat (od fáze 59 je i 9-13 v knize) nepředběhl
// engine. Viz engine-move.test.ts.
const NO_BOOK: OpeningBook = new Map();
const build = (opts: Parameters<typeof buildApp>[0] = {}): FastifyInstance =>
  buildApp({ openingBook: NO_BOOK, ...opts });

interface StubOptions {
  /** bestmove vrátí NELEGÁLNÍ tah (engine se „zbláznil") → server ho musí odmítnout. */
  readonly illegalMove?: boolean;
  /** bestmove selže (simuluje timeout/pád/protokolovou chybu enginu). */
  readonly bestmoveRejects?: boolean;
  /** bestmove se nikdy nedotáhne (partie uvázne na tahu bílého = „thinking"). */
  readonly bestmoveHangs?: boolean;
  /** Zavolá se s hodnotou `strength`, se kterou server bestmove pozval (zuby na plnou sílu). */
  readonly onBestmove?: (strength: Strength | undefined) => void;
}

/** Nelegální tah pro libovolnou pozici: z pole na sebe sama, bez braní. */
const ILLEGAL_MOVE: Move = { from: 1, path: [1], captures: [] };

function stubEngine(opts: StubOptions = {}): EngineMover {
  return {
    bestmove: (position: Position, strength?: Strength): Promise<Move> => {
      opts.onBestmove?.(strength);
      if (opts.bestmoveHangs === true) {
        return new Promise<Move>(() => undefined);
      }
      if (opts.bestmoveRejects === true) {
        return Promise.reject(new Error('stub: bestmove selhal'));
      }
      if (opts.illegalMove === true) {
        return Promise.resolve(ILLEGAL_MOVE);
      }
      const move = legalMoves(position)[0];
      return move === undefined
        ? Promise.reject(new Error('stub: pozice bez tahu'))
        : Promise.resolve(move);
    },
    evaluate: () => Promise.resolve({ score: 0 }),
  };
}

async function createGame(app: FastifyInstance, level?: string): Promise<GameDto> {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    ...(level === undefined ? {} : { payload: { level } }),
  });
  expect(res.statusCode).toBe(201);
  return res.json<GameDto>();
}

async function playFirstHumanMove(app: FastifyInstance, game: GameDto): Promise<void> {
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

interface HintResult {
  readonly move: MoveDto;
}

describe('GET /games/:id/hint – happy path', () => {
  it('vrátí legální tah (200) a stav partie NEZMĚNÍ (read-only)', async () => {
    // Zachytíme sílu, se kterou server pozve bestmove: nápověda MUSÍ jet plnou
    // silou (undefined), ne silou úrovně partie. Zuby: kdyby produkce omylem
    // předala STRENGTH_BY_LEVEL[record.level], tvrzení níž spadne.
    const strengths: (Strength | undefined)[] = [];
    const app = build({ engine: stubEngine({ onBestmove: (s) => strengths.push(s) }) });
    try {
      // Úroveň 'beginner' záměrně: STRENGTH_BY_LEVEL['beginner'] je DEFINOVANÁ, takže
      // regrese na `STRENGTH_BY_LEVEL[record.level]` by dala { maxDepth, carelessness }
      // ≠ undefined a tvrzení níž spadne. U 'professional' (undefined) by zub chyběl.
      const game = await createGame(app, 'beginner');
      const before = (await app.inject({ method: 'GET', url: `/games/${game.id}` })).json<GameDto>();

      const res = await app.inject({ method: 'GET', url: `/games/${game.id}/hint` });
      expect(res.statusCode).toBe(200);
      expect(strengths).toEqual([undefined]); // právě jedno zavolání, plnou silou
      const { move } = res.json<HintResult>();
      // Doporučený tah je skutečně jeden z legálních tahů aktuální pozice.
      const isLegal = before.legalMoves.some(
        (m) => m.from === move.from && JSON.stringify(m.path) === JSON.stringify(move.path),
      );
      expect(isLegal).toBe(true);

      // Read-only invariant: nic se nezměnilo – pozice, kdo je na tahu, ani engineStatus.
      const after = (await app.inject({ method: 'GET', url: `/games/${game.id}` })).json<GameDto>();
      expect(after.position).toEqual(before.position);
      expect(after.position.turn).toBe(before.position.turn);
      expect(after.engineStatus).toBe(before.engineStatus);
      expect(after.result).toBe('ongoing');
    } finally {
      await app.close();
    }
  });
});

describe('GET /games/:id/hint – guardy a selhání', () => {
  it('neexistující partie → 404 game_not_found', async () => {
    const app = build({ engine: stubEngine() });
    try {
      const res = await app.inject({ method: 'GET', url: '/games/neexistuje/hint' });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('game_not_found');
    } finally {
      await app.close();
    }
  });

  it('bez enginu (manuální režim) → 409 hint_unavailable', async () => {
    const app = build(); // žádný engine
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'GET', url: `/games/${game.id}/hint` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('hint_unavailable');
    } finally {
      await app.close();
    }
  });

  it('skončená partie (po vzdání) → 409 game_over, engine se ani neptá', async () => {
    const app = build({ engine: stubEngine() });
    try {
      const game = await createGame(app);
      await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
      const res = await app.inject({ method: 'GET', url: `/games/${game.id}/hint` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('game_over');
    } finally {
      await app.close();
    }
  });

  it('na tahu je engine (bílý) → 409 not_your_turn', async () => {
    // Engine zasekneme v thinking → po tahu člověka zůstane na tahu bílý.
    const app = build({ engine: stubEngine({ bestmoveHangs: true }) });
    try {
      const game = await createGame(app);
      await playFirstHumanMove(app, game);
      await pollUntil(app, game.id, (dto) => dto.engineStatus === 'thinking');

      const res = await app.inject({ method: 'GET', url: `/games/${game.id}/hint` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('not_your_turn');
    } finally {
      await app.close();
    }
  });

  it('engine selže při hledání → 503 engine_unavailable, partie beze změny', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = build({ engine: stubEngine({ bestmoveRejects: true }) });
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'GET', url: `/games/${game.id}/hint` });
      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('engine_unavailable');
      expect((await app.inject({ method: 'GET', url: `/games/${game.id}` })).json<GameDto>().result).toBe(
        'ongoing',
      );
    } finally {
      await app.close();
    }
  });

  it('engine vrátí NELEGÁLNÍ tah → 503 engine_unavailable (výstup se ověřuje)', async () => {
    // ZUBY: kdyby server výstup enginu neprověřoval přes findLegalMove, podal by
    // člověku nelegální nápovědu a test by dostal 200 místo 503.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = build({ engine: stubEngine({ illegalMove: true }) });
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'GET', url: `/games/${game.id}/hint` });
      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('engine_unavailable');
    } finally {
      await app.close();
    }
  });
});

/**
 * Integrační testy vzdání partie (fáze 24) přes `app.inject`. Vzdání je výsledek
 * MIMO pravidla: člověk (černý) se vzdá → vyhrává bílý (počítač), ale pozice
 * zůstává rozehraná. Testy fixují, že:
 *  - endpoint vrátí `white-wins` a partii uloží jako `<id>.pdn` s tokenem 1-0,
 *  - dvojí vzdání / vzdání skončené partie → 409 game_over, právě jeden soubor,
 *  - engine, který zrovna přemýšlí, po vzdání NEzahraje (guard přes efektivní
 *    výsledek) – tenhle test má zuby: kdyby guard četl `gameResultFromState`
 *    místo `effectiveResult`, engine by tah aplikoval a `turn` by se přehodil.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import type { EngineMover, GameDto, OpeningBook } from '../src/index.js';

// Cvičí ENGINE/vzdání, ne knihu zahájení: partie stavíme s PRÁZDNOU knihou, aby
// knižní zkrat (od fáze 59 je i 9-13 v knize) nepředběhl engine. Viz
// engine-move.test.ts.
const NO_BOOK: OpeningBook = new Map();
const build = (opts: Parameters<typeof buildApp>[0] = {}): FastifyInstance =>
  buildApp({ openingBook: NO_BOOK, ...opts });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'checkers-resign-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createGame(app: FastifyInstance): Promise<GameDto> {
  const res = await app.inject({ method: 'POST', url: '/games' });
  expect(res.statusCode).toBe(201);
  return res.json<GameDto>();
}

/** Odehraje první legální tah člověka (černého) přes POST /moves. */
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

/** Poll GET, dokud predikát nesedí (nebo timeout). Modeluje klientský polling. */
async function pollUntil(
  app: FastifyInstance,
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
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('POST /games/:id/resign – bez enginu (manuální režim)', () => {
  it('vzdání rozehrané partie → 200 white-wins, pozice zůstává rozehraná', async () => {
    const app = build();
    try {
      const game = await createGame(app);
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
      expect(res.statusCode).toBe(200);
      const dto = res.json<GameDto>();
      expect(dto.result).toBe('white-wins');
      // Vynucený výsledek NEmění stav pravidel – černý pořád „na tahu".
      expect(dto.position.turn).toBe('black');
      // A GET vidí totéž (výsledek se opravdu uložil do partie).
      const got = await app.inject({ method: 'GET', url: `/games/${game.id}` });
      expect(got.json<GameDto>().result).toBe('white-wins');
    } finally {
      await app.close();
    }
  });

  it('vzdání neexistující partie → 404 game_not_found', async () => {
    const app = build();
    try {
      const res = await app.inject({ method: 'POST', url: '/games/neexistuje/resign' });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('game_not_found');
    } finally {
      await app.close();
    }
  });
});

describe('POST /games/:id/resign – archivace do PDN', () => {
  it('vzdaná partie se zapíše jako <id>.pdn s tokenem 1-0', async () => {
    const app = build({ pdnDir: dir });
    try {
      const game = await createGame(app);
      // Odehraj pár tahů, ať PDN nese i movetext, ne jen samotný výsledek.
      await playFirstHumanMove(app, game);
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
      expect(res.statusCode).toBe(200);

      const content = await readFile(join(dir, `${game.id}.pdn`), 'utf8');
      expect(content).toContain('[Event "Checkers"]');
      expect(content).toContain('[Result "1-0"]');
      expect(content.trimEnd().endsWith('1-0')).toBe(true);
      // Žádný nedopsaný .tmp po sobě.
      expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('dvojí vzdání → 409 game_over a právě JEDEN soubor', async () => {
    const app = build({ pdnDir: dir });
    try {
      const game = await createGame(app);
      const first = await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
      expect(first.statusCode).toBe(200);
      const file = join(dir, `${game.id}.pdn`);
      const content = await readFile(file, 'utf8');

      const second = await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
      expect(second.statusCode).toBe(409);
      expect(second.json<{ error: { code: string } }>().error.code).toBe('game_over');
      // Soubor se nepřepsal a je pořád jen jeden.
      expect(await readFile(file, 'utf8')).toBe(content);
      expect((await readdir(dir)).filter((f) => f.endsWith('.pdn'))).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('vzdání skončené partie (přirozený konec) → 409 game_over', async () => {
    const app = build();
    try {
      const game = await createGame(app);
      // Dohraj partii do konce prvním legálním tahem (remízová pravidla terminují).
      let state = game;
      let guard = 0;
      while (state.result === 'ongoing') {
        if (++guard > 5000) {
          throw new Error('partie se nedohrála do stropu');
        }
        const move = state.legalMoves[0];
        if (move === undefined) {
          throw new Error('ongoing partie bez legálního tahu');
        }
        const res = await app.inject({
          method: 'POST',
          url: `/games/${game.id}/moves`,
          payload: { from: move.from, path: move.path },
        });
        expect(res.statusCode).toBe(200);
        state = res.json<GameDto>();
      }
      // Přirozeně skončenou partii nejde vzdát.
      const res = await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('game_over');
    } finally {
      await app.close();
    }
  });
});

/**
 * Engine s ovladatelnou bránou: `bestmove` se zablokuje, dokud test nezavolá
 * `release()`. Tím jde deterministicky nasimulovat „engine přemýšlí, mezitím se
 * člověk vzdá" a ověřit, že engine po probuzení tah NEzahraje.
 */
function gatedEngine(): { engine: EngineMover; release: () => void; called: Promise<void> } {
  // `doRelease` se přepisuje až uvnitř bestmove; vracený `release` proto MUSÍ
  // volat aktuální hodnotu přes obal, ne zachytit počáteční no-op (jinak by
  // `release()` z testu bránu nikdy neotevřel).
  let doRelease = (): void => undefined;
  let signalCalled = (): void => undefined;
  const called = new Promise<void>((resolve) => {
    signalCalled = resolve;
  });
  const engine: EngineMover = {
    bestmove: (position: Position): Promise<Move> => {
      const move = legalMoves(position)[0];
      return new Promise<Move>((resolve, reject) => {
        doRelease = (): void => {
          if (move === undefined) {
            reject(new Error('gated stub: pozice bez tahu'));
          } else {
            resolve(move);
          }
        };
        signalCalled();
      });
    },
    evaluate: () => Promise.resolve({ score: 0 }), // vzdání decidéra nepotřebuje
  };
  return { engine, release: () => doRelease(), called };
}

describe('POST /games/:id/resign – závod s přemýšlejícím enginem', () => {
  it('engine po vzdání NEzahraje (guard přes efektivní výsledek)', async () => {
    const gate = gatedEngine();
    const app = build({ engine: gate.engine, pdnDir: dir });
    try {
      const game = await createGame(app);
      // Tah člověka → bílý na tahu, engine začne přemýšlet (thinking) a zablokuje se.
      const afterHuman = await playFirstHumanMove(app, game);
      expect(afterHuman.position.turn).toBe('white');
      expect(afterHuman.engineStatus).toBe('thinking');
      await gate.called; // engine.bestmove je teď rozběhnutý a čeká na bránu

      // Člověk se vzdá, zatímco engine „přemýšlí".
      const resigned = await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
      expect(resigned.statusCode).toBe(200);
      expect(resigned.json<GameDto>().result).toBe('white-wins');

      // Teď engine dopočítá a chce zahrát – ale efektivní výsledek už je terminální.
      gate.release();
      const settled = await pollUntil(app, game.id, (dto) => dto.engineStatus === 'idle');

      // Zuby testu: kdyby guard v runEngineMove četl gameResultFromState místo
      // effectiveResult, engine by tah aplikoval a turn by se přehodil na 'black'.
      expect(settled.position.turn).toBe('white');
      expect(settled.result).toBe('white-wins');

      // Archivováno právě jednou (vzdáním), engine nic nepřepsal.
      expect((await readdir(dir)).filter((f) => f.endsWith('.pdn'))).toHaveLength(1);
      const content = await readFile(join(dir, `${game.id}.pdn`), 'utf8');
      expect(content).toContain('[Result "1-0"]');
    } finally {
      gate.release(); // ať nezůstane visící promise, i kdyby test spadl dřív
      await app.close();
    }
  });
});

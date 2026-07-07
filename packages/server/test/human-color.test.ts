/**
 * Integrační testy obrácené barvy (fáze 50): člověk BÍLÝ → engine ČERNÝ.
 * Fixují, že server řídí spouštění enginu, guard tahu, výsledek vzdání i práh
 * remízy podle ULOŽENÉ barvy člověka (`humanColor`), ne napevno „engine = bílý".
 *
 * Zuby: kdyby kterékoli místo zůstalo na ENGINE_COLOR='white', engine by se u
 * partie s bílým člověkem nespustil (černý na tahu ≠ bílý), vzdání by připsalo
 * white-wins straně, která se vzdala, a práh remízy by se počítal z pohledu bílého.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import type { FastifyInstance } from 'fastify';
import { buildApp, mulberry32 } from '../src/index.js';
import type { EngineMover, GameDto } from '../src/index.js';

/** Stub: vždy zahraje první legální tah pozice (autorita ho pak ověří). */
const legalStub: EngineMover = {
  bestmove: (position: Position): Promise<Move> => {
    const move = legalMoves(position)[0];
    if (move === undefined) {
      return Promise.reject(new Error('stub: pozice bez tahu'));
    }
    return Promise.resolve(move);
  },
  evaluate: () => Promise.resolve({ score: 0 }),
};

/** Stub, jehož tah se NIKDY nedopočítá – pozice tak zamrzne na enginově tahu. */
const pendingStub: EngineMover = {
  bestmove: () =>
    new Promise<Move>(() => {
      /* nikdy neresolvne – pozice zamrzne na enginově tahu */
    }),
  evaluate: () => Promise.reject(new Error('stub: nevyužito')),
};

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

describe('POST /games s humanColor', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  it('humanColor=white: DTO nese white a engine (černý) se spustí hned', async () => {
    app = buildApp({ engine: legalStub });
    const res = await app.inject({ method: 'POST', url: '/games', payload: { humanColor: 'white' } });
    expect(res.statusCode).toBe(201);
    const game = res.json<GameDto>();
    expect(game.humanColor).toBe('white');
    // Výchozí rozestavění = černý na tahu = engine → spustil se hned při založení
    // (dřív se to dělo jen u ballotu). engineStatus je synchronně `thinking`.
    expect(game.position.turn).toBe('black');
    expect(game.engineStatus).toBe('thinking');
    // Po dotažení enginova tahu je na tahu člověk (bílý) a engine je idle.
    const after = await pollUntil(app, game.id, (d) => d.engineStatus === 'idle');
    expect(after.position.turn).toBe('white');
  });

  it('bez barvy → humanColor "black" a engine (bílý) se nespustí (zpětná kompatibilita)', async () => {
    app = buildApp({ engine: legalStub });
    const res = await app.inject({ method: 'POST', url: '/games' });
    expect(res.statusCode).toBe(201);
    const game = res.json<GameDto>();
    expect(game.humanColor).toBe('black');
    expect(game.position.turn).toBe('black'); // člověk na tahu
    expect(game.engineStatus).toBe('idle'); // engine (bílý) není na tahu
  });

  it('neznámá barva → 400', async () => {
    app = buildApp({ engine: legalStub });
    const res = await app.inject({ method: 'POST', url: '/games', payload: { humanColor: 'red' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('guard tahu u obrácené barvy', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  it('člověk (bílý) nesmí zahrát tah enginu (černého) → 409 not_your_turn', async () => {
    // pendingStub: engine se spustí, ale netáhne → pozice zamrzne na černém (engine).
    // Prázdná kniha: guard barvy testujeme izolovaně od knihy zahájení (jinak by
    // engine ČERNÝ zahrál knižní tah z výchozí pozice a „zamrznutí" by nenastalo).
    app = buildApp({ engine: pendingStub, openingBook: new Map<string, Move>() });
    const res = await app.inject({ method: 'POST', url: '/games', payload: { humanColor: 'white' } });
    const game = res.json<GameDto>();
    expect(game.position.turn).toBe('black'); // engine na tahu, přemýšlí
    const enginesMove = game.legalMoves[0];
    if (enginesMove === undefined) {
      throw new Error('výchozí pozice musí mít legální tah');
    }
    const move = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: enginesMove.from, path: enginesMove.path },
    });
    expect(move.statusCode).toBe(409);
    expect(move.json<{ error: { code: string } }>().error.code).toBe('not_your_turn');
  });

  it('nápověda: člověk (bílý) ji nedostane, když je na tahu engine (černý) → 409', async () => {
    // Prázdná kniha: viz test výše – bez ní by engine zahrál knižní tah a nebyl by
    // na tahu, takže by se netestoval guard nápovědy „na tahu je počítač".
    app = buildApp({ engine: pendingStub, openingBook: new Map<string, Move>() });
    const res = await app.inject({ method: 'POST', url: '/games', payload: { humanColor: 'white' } });
    const game = res.json<GameDto>();
    expect(game.position.turn).toBe('black'); // engine na tahu
    const hint = await app.inject({ method: 'GET', url: `/games/${game.id}/hint` });
    expect(hint.statusCode).toBe(409);
    expect(hint.json<{ error: { code: string } }>().error.code).toBe('not_your_turn');
  });
});

describe('Mistrovství + humanColor=white', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  it('po ballotu je na tahu bílý = člověk → engine (černý) NEtáhne', async () => {
    // Zub bodu 5 fáze: ballot udělá 3 půltahy (černý-bílý-černý), po nichž je na
    // tahu BÍLÝ. Když je bílý člověk (engine černý), engine po ballotu SPRÁVNĚ
    // netáhne. Kdyby se vrátila logika „po ballotu vždy táhne engine", byl by tu
    // engineStatus 'thinking' a test padne.
    app = buildApp({ engine: legalStub, rng: mulberry32(7) });
    const res = await app.inject({
      method: 'POST',
      url: '/games',
      payload: { level: 'championship', humanColor: 'white' },
    });
    expect(res.statusCode).toBe(201);
    const game = res.json<GameDto>();
    expect(game.humanColor).toBe('white');
    expect(game.ballotIndex).not.toBeNull();
    expect(game.ballotMoves).toHaveLength(3);
    expect(game.position.turn).toBe('white'); // po ballotu na tahu člověk
    expect(game.engineStatus).toBe('idle'); // engine (černý) po ballotu netáhne

    // Člověk (bílý) legálně táhne → teprve pak se spustí engine (černý).
    const humanMove = game.legalMoves[0];
    if (humanMove === undefined) {
      throw new Error('po ballotu musí mít člověk legální tah');
    }
    const played = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: humanMove.from, path: humanMove.path },
    });
    expect(played.statusCode).toBe(200);
    const after = await pollUntil(app, game.id, (d) => d.engineStatus === 'idle');
    expect(after.position.turn).toBe('white'); // engine (černý) dotáhl, zas člověk
  });
});

describe('vzdání u obrácené barvy', () => {
  let app: FastifyInstance;
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'checkers-humancolor-'));
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('člověk (bílý) se vzdá → black-wins a PDN token 0-1', async () => {
    app = buildApp({ engine: legalStub, pdnDir: dir });
    const created = await app.inject({ method: 'POST', url: '/games', payload: { humanColor: 'white' } });
    const game = created.json<GameDto>();
    // Počkej, až engine (černý) dotáhne první tah a je na tahu člověk.
    await pollUntil(app, game.id, (d) => d.engineStatus === 'idle');

    const res = await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
    expect(res.statusCode).toBe(200);
    // Zub: vzdání připíše výhru ENGINU (černému), ne straně, která se vzdala.
    expect(res.json<GameDto>().result).toBe('black-wins');

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const pdn = await readFile(join(dir, files[0] ?? ''), 'utf8');
    expect(pdn).toContain('0-1'); // black-wins token, ne 1-0
  });
});

describe('práh remízy z pohledu enginu (obrácená barva)', () => {
  let app: FastifyInstance;
  let score = 0;
  const evalStub: EngineMover = {
    bestmove: (position: Position) => legalStub.bestmove(position),
    evaluate: () => Promise.resolve({ score }),
  };
  afterEach(async () => {
    await app.close();
  });

  /** Založí partii s bílým člověkem a dojede na tah člověka (engine idle). */
  async function whiteHumanAtTurn(): Promise<GameDto> {
    const created = await app.inject({ method: 'POST', url: '/games', payload: { humanColor: 'white' } });
    const game = created.json<GameDto>();
    return pollUntil(app, game.id, (d) => d.engineStatus === 'idle' && d.position.turn === 'white');
  }

  it('engine (černý) prohrává z pohledu bílého na tahu → přijme remízu', async () => {
    app = buildApp({ engine: evalStub });
    const game = await whiteHumanAtTurn();
    // Na tahu je bílý (člověk); skóre je z pohledu strany na tahu (bílého). +100 =
    // bílý vede → engine (černý) po přepočtu vidí −100 ≤ 0 → NEvyhrává → přijme.
    // Kdyby se práh počítal z pohledu bílého (starý bug), +100 > 0 → odmítl by.
    score = 100;
    const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ accepted: boolean; game: GameDto }>();
    expect(body.accepted).toBe(true);
    expect(body.game.result).toBe('draw');
  });

  it('engine (černý) vyhrává z pohledu bílého na tahu → odmítne remízu', async () => {
    app = buildApp({ engine: evalStub });
    const game = await whiteHumanAtTurn();
    // −100 z pohledu bílého na tahu = engine (černý) vede → přepočet +100 > 0 → odmítne.
    score = -100;
    const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ accepted: boolean; game: GameDto }>();
    expect(body.accepted).toBe(false);
    expect(body.game.result).toBe('ongoing');
  });
});

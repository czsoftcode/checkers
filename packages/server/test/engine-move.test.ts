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
import { buildApp, STRENGTH_BY_LEVEL } from '../src/index.js';
import type { EngineMover, GameDto, Strength, OpeningBook } from '../src/index.js';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

// Tenhle test cvičí ENGINE (background tah, error cesty, autorita barvy), NE
// knihu zahájení. Od fáze 59 je ale `legalMoves[0]` (9-13) v knize, takže by na
// úrovni Profesionál knižní tah engine zkratoval (stub by se nezavolal → tiché
// falešné úspěchy i timeouty). Proto všechny partie stavíme s PRÁZDNOU knihou –
// chování je pak identické jako před naplněním knihy a nezávislé na jejím růstu.
const NO_BOOK: OpeningBook = new Map();
const build = (opts: Parameters<typeof buildApp>[0] = {}): FastifyInstance =>
  buildApp({ openingBook: NO_BOOK, ...opts });

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
    app = build();
    const game = await createGame();
    expect(game.engineStatus).toBe('idle');
    const got = await app.inject({ method: 'GET', url: `/games/${game.id}` });
    expect(got.json<GameDto>().engineStatus).toBe('idle');
  });
});

describe('bez enginu (opt-in) – server zůstává manuální', () => {
  it('po tahu člověka se nic nespustí, engineStatus zůstane idle, bílý na tahu', async () => {
    app = build(); // žádný engine
    const game = await createGame();
    const after = await playFirstHumanMove(game);
    expect(after.position.turn).toBe('white');
    expect(after.engineStatus).toBe('idle');
  });
});

describe('s enginem – background tah', () => {
  it('POST vrátí HNED stav po tahu člověka s engineStatus "thinking"', async () => {
    app = build({ engine: legalStub });
    const game = await createGame();
    const after = await playFirstHumanMove(game);
    // Odpověď nese stav po tahu ČLOVĚKA (bílý na tahu), engine ještě nedotáhl.
    expect(after.position.turn).toBe('white');
    expect(after.engineStatus).toBe('thinking');
  });

  it('engine dotáhne tah na pozadí: GET nakonec ukáže černého a idle', async () => {
    app = build({ engine: legalStub });
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
    app = build({ engine: hangStub });
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
    app = build({ engine: illegalStub });
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
    app = build({ engine: rejectStub });
    const game = await createGame();
    await playFirstHumanMove(game);
    const errored = await pollUntil(game.id, (dto) => dto.engineStatus === 'error');
    expect(errored.position.turn).toBe('white');
  });
});

describe('úroveň partie protéká až do bestmove', () => {
  /** Stub, který si pamatuje `strength` z posledního bestmove a vrátí legální tah. */
  function recordingStub(): { mover: EngineMover; calls: (Strength | undefined)[] } {
    const calls: (Strength | undefined)[] = [];
    const mover: EngineMover = {
      bestmove: (position: Position, strength?: Strength): Promise<Move> => {
        calls.push(strength);
        const move = legalMoves(position)[0];
        return move === undefined
          ? Promise.reject(new Error('stub: pozice bez tahu'))
          : Promise.resolve(move);
      },
      evaluate: () => Promise.resolve({ score: 0 }),
    };
    return { mover, calls };
  }

  async function createGameWithLevel(level: string): Promise<GameDto> {
    const res = await app.inject({ method: 'POST', url: '/games', payload: { level } });
    expect(res.statusCode).toBe(201);
    return res.json<GameDto>();
  }

  it('bez těla (výchozí Profesionál) → engine dostane strength undefined', async () => {
    const { mover, calls } = recordingStub();
    app = build({ engine: mover });
    const game = await createGame(); // POST bez těla
    await playFirstHumanMove(game);
    await pollUntil(game.id, (dto) => dto.engineStatus === 'idle' && dto.position.turn === 'black');
    expect(calls[0]).toBeUndefined();
  });

  it('level "professional" → engine dostane strength undefined', async () => {
    const { mover, calls } = recordingStub();
    app = build({ engine: mover });
    const game = await createGameWithLevel('professional');
    await playFirstHumanMove(game);
    await pollUntil(game.id, (dto) => dto.engineStatus === 'idle' && dto.position.turn === 'black');
    expect(calls[0]).toBeUndefined();
  });

  it('level "beginner" → engine dostane páky z reálné mapy (zuby na protažení)', async () => {
    // Zuby: kdyby server úroveň zahodil a posílal pořád Profesionála, calls[0] by
    // bylo undefined a test spadne. Porovnává se s REÁLNOU mapou, ne kopií čísel.
    const { mover, calls } = recordingStub();
    app = build({ engine: mover });
    const game = await createGameWithLevel('beginner');
    await playFirstHumanMove(game);
    await pollUntil(game.id, (dto) => dto.engineStatus === 'idle' && dto.position.turn === 'black');
    expect(calls[0]).toEqual(STRENGTH_BY_LEVEL.beginner);
    expect(calls[0]?.carelessness).toBeGreaterThan(0);
  });

  it('level "intermediate" → engine dostane páky z reálné mapy, odlišné od beginner i professional', async () => {
    // Zuby: kdyby server pro Pokročilého tiše posílal páky Začátečníka (nebo je
    // zahodil na Profesionála = undefined), test spadne. Porovnává se REÁLNÁ mapa.
    const { mover, calls } = recordingStub();
    app = build({ engine: mover });
    const game = await createGameWithLevel('intermediate');
    await playFirstHumanMove(game);
    await pollUntil(game.id, (dto) => dto.engineStatus === 'idle' && dto.position.turn === 'black');
    expect(calls[0]).toEqual(STRENGTH_BY_LEVEL.intermediate);
    // Střed: jiné páky než Začátečník i než Profesionál (undefined = plná síla).
    expect(calls[0]).not.toBeUndefined();
    expect(calls[0]).not.toEqual(STRENGTH_BY_LEVEL.beginner);
    // Hloubka mezi Začátečníkem (1) a neomezenou; nepozornost mírnější než Začátečník.
    expect(calls[0]?.maxDepth).toBeGreaterThan(STRENGTH_BY_LEVEL.beginner?.maxDepth ?? 0);
    expect(calls[0]?.carelessness).toBeLessThan(STRENGTH_BY_LEVEL.beginner?.carelessness ?? 1);
  });

  it('GameDto vrací úroveň partie (výchozí professional i zvolený beginner)', async () => {
    app = build({ engine: recordingStub().mover });
    const def = await createGame(); // bez těla
    expect(def.level).toBe('professional');
    const beg = await createGameWithLevel('beginner');
    expect(beg.level).toBe('beginner');
    // Úroveň drží i GET (čte se ze záznamu, ne z těla požadavku).
    const got = await app.inject({ method: 'GET', url: `/games/${beg.id}` });
    expect(got.json<GameDto>().level).toBe('beginner');
  });

  it('neznámá úroveň → 400 invalid_request, partie se nezaloží', async () => {
    app = build({ engine: recordingStub().mover });
    const res = await app.inject({ method: 'POST', url: '/games', payload: { level: 'grandmaster' } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('invalid_request');
  });
});

describe('Mistrovství: ballot nasazen a engine (bílý) táhne PRVNÍ', () => {
  it('POST /games championship → 201, po ballotu bílý na tahu, engine se rozjede (thinking) a dotáhne', async () => {
    // Legální stub jako engine → autorita mu tah stejně ověří. Bez enginu by
    // partie po ballotu jen stála na tahu bílého a nikdo by nezačal.
    app = build({ engine: legalStub });
    const res = await app.inject({ method: 'POST', url: '/games', payload: { level: 'championship' } });
    expect(res.statusCode).toBe(201);
    const created = res.json<GameDto>();

    // Po ballotu: bílý (engine) na tahu, vylosovaný ballot je zaznamenaný.
    expect(created.level).toBe('championship');
    expect(created.position.turn).toBe('white');
    expect(created.ballotIndex).not.toBeNull();
    // Engine se spustil UŽ při založení (na rozdíl od ostatních úrovní, kde
    // začíná člověk/černý) → engineStatus 'thinking' hned v odpovědi.
    expect(created.engineStatus).toBe('thinking');

    // Engine dotáhne první tah na pozadí → deska se překlopí na černého (člověka).
    // To je zub „engine táhl PRVNÍ": kdyby POST engine nespustil, zůstal by
    // navždy bílý na tahu a polling by vypršel.
    const done = await pollUntil(
      created.id,
      (dto) => dto.engineStatus === 'idle' && dto.position.turn === 'black',
    );
    expect(done.result).toBe('ongoing');
    expect(done.ballotIndex).toBe(created.ballotIndex);
  });

  it('ostatní úroveň (professional): POST engine NEspustí, černý (člověk) na tahu, ballotIndex null', async () => {
    // Zpětná kompatibilita: neballotové partie se založením nemění – engine se
    // rozjede až po tahu člověka, ne hned.
    app = build({ engine: legalStub });
    const res = await app.inject({ method: 'POST', url: '/games', payload: { level: 'professional' } });
    expect(res.statusCode).toBe(201);
    const created = res.json<GameDto>();
    expect(created.position.turn).toBe('black');
    expect(created.engineStatus).toBe('idle');
    expect(created.ballotIndex).toBeNull();
  });
});

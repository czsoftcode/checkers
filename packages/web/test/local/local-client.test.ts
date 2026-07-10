import { describe, expect, it } from 'vitest';
import { createInProcessEngineWorker } from '../../src/local/engine-worker.js';
import { createLocalClient } from '../../src/local-client.js';
import { isGameDto } from '../../src/server-client.js';
import { mulberry32 } from '../../src/local/prng.js';
import { createBlockingWorker, createFailingWorker, makeClock, pollUntilSettled } from './helpers.js';

/** LocalClient s in-process workerem a plně deterministickými hodinami/seedy. */
function makeClient(overrides: { rng?: () => number } = {}) {
  const worker = createInProcessEngineWorker({ now: makeClock() });
  return createLocalClient(worker, {
    rng: overrides.rng ?? mulberry32(12345),
    seed: () => 0x1234_abcd,
    timeMs: 1,
    now: makeClock(),
  });
}

describe('LocalClient createGame (+ballot)', () => {
  it('vrátí GameDto platného tvaru (týž guard jako HTTP cesta) pro běžnou partii', async () => {
    const client = makeClient();
    const dto = await client.createGame('beginner', 'black');
    expect(isGameDto(dto)).toBe(true);
    expect(dto.level).toBe('beginner');
    expect(dto.humanColor).toBe('black');
    expect(dto.ballotMoves).toBeNull();
    expect(dto.ballotIndex).toBeNull();
    // Člověk černý začíná → engine (bílý) je na tahu až po něm → idle.
    expect(dto.position.turn).toBe('black');
    expect(dto.engineStatus).toBe('idle');
  });

  it('Mistrovství vrátí vylosovaný ballot (3 tahy + index) a engine (bílý) táhne první', async () => {
    const client = makeClient();
    const dto = await client.createGame('championship', 'black');
    expect(isGameDto(dto)).toBe(true);
    expect(dto.ballotMoves).not.toBeNull();
    expect(dto.ballotMoves).toHaveLength(3);
    expect(dto.ballotIndex).toEqual(expect.any(Number));
    // Po ballotu je na tahu bílý = engine (člověk černý) → engine táhne hned.
    expect(dto.position.turn).toBe('white');
    expect(dto.engineStatus).toBe('thinking');
  });

  it('člověk=bílý → engine (černý) je na tahu hned → engineStatus:thinking', async () => {
    const client = makeClient();
    const dto = await client.createGame('beginner', 'white');
    expect(dto.humanColor).toBe('white');
    expect(dto.position.turn).toBe('black'); // výchozí rozestavění, černý na tahu = engine
    expect(dto.engineStatus).toBe('thinking');
  });

  it('deterministický los: stejný seed rng → stejný ballotIndex', async () => {
    const a = await makeClient({ rng: mulberry32(777) }).createGame('championship', 'black');
    const b = await makeClient({ rng: mulberry32(777) }).createGame('championship', 'black');
    expect(a.ballotIndex).toBe(b.ballotIndex);
  });

  it('ballotIndex u ne-Mistrovství je chyba volajícího → invalid_request', async () => {
    const client = makeClient();
    await expect(client.createGame('beginner', 'black', 3)).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
    });
  });
});

describe('LocalClient postMove + poll (thinking → idle)', () => {
  it('tah člověka vrátí thinking, engine dotáhne, poll uvidí idle a nový tah', async () => {
    const client = makeClient();
    const created = await client.createGame('beginner', 'black');
    expect(created.engineStatus).toBe('idle');

    const [first] = created.legalMoves;
    if (first === undefined) {
      throw new Error('žádný legální tah');
    }
    // postMove vrátí stav HNED po tahu člověka: na tahu je bílý (engine) → thinking.
    const afterMove = await client.postMove(created.id, first.from, first.path);
    expect(afterMove.position.turn).toBe('white');
    expect(afterMove.engineStatus).toBe('thinking');

    // Poll dokud engine nedotáhne: tah enginu se aplikuje → zpět na tahu člověk, idle.
    const settled = await pollUntilSettled(client, created.id);
    expect(settled.engineStatus).toBe('idle');
    expect(settled.position.turn).toBe('black');
    // Engine skutečně táhl: pozice se od stavu „hned po mém tahu" liší.
    expect(settled.position).not.toEqual(afterMove.position);
  });

  it('tah mimo tah člověka (na tahu engine) → not_your_turn', async () => {
    // Blokující worker drží engine v thinking → engine (černý) zůstane na tahu,
    // takže se dostaneme ke guardu „na tahu je počítač" (in-process fake by táhl dřív).
    const client = createLocalClient(createBlockingWorker(), { seed: () => 1, timeMs: 1 });
    const created = await client.createGame('beginner', 'white');
    expect(created.position.turn).toBe('black'); // engine na tahu
    const [any] = created.legalMoves;
    if (any === undefined) {
      throw new Error('žádný legální tah');
    }
    await expect(client.postMove(created.id, any.from, any.path)).rejects.toMatchObject({
      code: 'not_your_turn',
    });
  });

  it('nelegální tah → illegal_move', async () => {
    const client = makeClient();
    const created = await client.createGame('beginner', 'black');
    await expect(client.postMove(created.id, 99, [100])).rejects.toMatchObject({
      code: 'illegal_move',
    });
  });

  it('getGame na neexistující partii → game_not_found', async () => {
    const client = makeClient();
    await expect(client.getGame('neexistuje')).rejects.toMatchObject({ code: 'game_not_found' });
  });

  it('selhání workeru při tahu enginu → engineStatus:error, partie stojí na tahu člověka', async () => {
    // Reálný worker může padnout (timeout, výjimka). runEngineMove to nesmí nechat
    // viset na 'thinking' ani shodit klienta – přepne na 'error' a partie zůstane hratelná.
    const client = createLocalClient(createFailingWorker(), { seed: () => 1, timeMs: 1 });
    const created = await client.createGame('beginner', 'white'); // engine (černý) táhne první
    const settled = await pollUntilSettled(client, created.id);
    expect(settled.engineStatus).toBe('error');
    // Pozice se nezměnila (engine netáhl), stále na tahu engine (černý) – ale partie žije.
    expect(settled.result).toBe('ongoing');
  });
});

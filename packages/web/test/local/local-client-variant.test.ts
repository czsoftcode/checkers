import { describe, expect, it } from 'vitest';
import { POOL_RULESET, legalMoves } from '@checkers/rules';
import type { Move } from '@checkers/rules';
import { createInProcessEngineWorker } from '../../src/local/engine-worker.js';
import type { EngineWorker } from '../../src/local/engine-worker.js';
import type { EngineMoveRequest } from '../../src/local/compute-move.js';
import { createLocalClient } from '../../src/local-client.js';
import { mulberry32 } from '../../src/local/prng.js';
import { makeClock, pollUntilSettled } from './helpers.js';

/**
 * Worker, který ZAZNAMENÁ každý request (kvůli ověření, že varianta doteče až
 * k výpočtu tahu) a jinak deleguje na reálné in-process jádro – vrácený tah je
 * tedy skutečně spočítaný pravidly té varianty, ne fake.
 */
function recordingWorker(): { worker: EngineWorker; requests: EngineMoveRequest[] } {
  const inner = createInProcessEngineWorker({ now: makeClock() });
  const requests: EngineMoveRequest[] = [];
  return {
    requests,
    worker: {
      computeMove(req: EngineMoveRequest): Promise<Move> {
        requests.push(req);
        return inner.computeMove(req);
      },
    },
  };
}

/** LocalClient s deterministickými hodinami/seedy pro danou variantu (nebo výchozí). */
function makeClient(variant?: 'american' | 'pool' | 'russian' | 'czech') {
  const { worker, requests } = recordingWorker();
  const client = createLocalClient(worker, {
    rng: mulberry32(12345),
    seed: () => 0x1234_abcd,
    timeMs: 1,
    now: makeClock(),
    ...(variant === undefined ? {} : { variant }),
  });
  return { client, requests };
}

describe('LocalClient – varianta partie', () => {
  it('výchozí (bez varianty) je americká: GameDto i request workeru nesou american', async () => {
    const { client, requests } = makeClient();
    // Člověk bílý → engine (černý) táhne první → worker dostane request.
    const dto = await client.createGame('beginner', 'white');
    expect(dto.variant).toBe('american');
    await pollUntilSettled(client, dto.id);
    expect(requests).not.toHaveLength(0);
    expect(requests[0]?.variant).toBe('american');
  });

  it('pool: varianta doteče do GameDto i do requestu workeru (computeAiMove)', async () => {
    const { client, requests } = makeClient('pool');
    const dto = await client.createGame('beginner', 'white');
    expect(dto.variant).toBe('pool');
    await pollUntilSettled(client, dto.id);
    expect(requests).not.toHaveLength(0);
    // TEETH: kdyby local-client variantu do requestu nepředal, spadlo by na undefined
    // (compute-move by default hrálo americky) a tenhle assert selže.
    expect(requests[0]?.variant).toBe('pool');
  });

  it('všech pět variant protečou do GameDto i do requestu workeru', async () => {
    for (const variant of ['american', 'pool', 'russian', 'czech', 'italian'] as const) {
      const { worker, requests } = recordingWorker();
      const client = createLocalClient(worker, {
        rng: mulberry32(12345),
        seed: () => 0x1234_abcd,
        timeMs: 1,
        now: makeClock(),
        variant,
      });
      const dto = await client.createGame('beginner', 'white'); // engine táhne první
      expect(dto.variant).toBe(variant);
      await pollUntilSettled(client, dto.id);
      expect(requests[0]?.variant).toBe(variant);
    }
  });

  it('pool AI partie proběhne programově: legální tahy pravidel pool + AI odpoví', async () => {
    const { client } = makeClient('pool');
    let dto = await client.createGame('beginner', 'black'); // člověk začíná (černý)
    expect(dto.variant).toBe('pool');
    // Legální tahy z DTO musí odpovídat rulesetu POOL (ne americké) – toDto je počítá
    // rulesetem varianty. Na výchozím rozestavění se sady shodují, ale kontrakt je pool.
    expect(dto.legalMoves.map((m) => [m.from, ...m.path])).toEqual(
      legalMoves(dto.position, POOL_RULESET).map((m) => [m.from, ...m.path]),
    );

    // Odehraj pár půltahů proti AI: člověk vezme první nabízený tah, engine odpoví.
    for (let ply = 0; ply < 4; ply++) {
      const my = dto.legalMoves[0];
      if (my === undefined) {
        break; // partie skončila
      }
      const after = await client.postMove(dto.id, my.from, my.path); // nesmí thrownout
      expect(after.engineStatus).toBe('thinking');
      const settled = await pollUntilSettled(client, dto.id);
      // Engine skutečně potáhl → zpět na tahu člověk (nebo konec partie).
      expect(settled.engineStatus).not.toBe('error');
      expect(settled.variant).toBe('pool');
      dto = settled;
      if (dto.result !== 'ongoing') {
        break;
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { initialGameState } from '@checkers/rules';
import { computeEngineMove } from '../../src/local/compute-move.js';
import { createInProcessEngineWorker } from '../../src/local/engine-worker.js';

function makeClock(step = 1_000_000): () => number {
  let t = -step;
  return () => {
    t += step;
    return t;
  };
}

describe('createInProcessEngineWorker', () => {
  it('computeMove vrátí Promise s týmž tahem jako přímé volání jádra', async () => {
    const position = initialGameState().position;
    const req = { position, level: 'beginner' as const, seed: 42, timeMs: 1 };
    const worker = createInProcessEngineWorker({ now: makeClock() });

    const promise = worker.computeMove(req);
    expect(promise).toBeInstanceOf(Promise);

    const move = await promise;
    const reference = computeEngineMove(req, makeClock());
    expect(move.from).toBe(reference.from);
    expect([...move.path]).toEqual([...reference.path]);
  });

  it('tah dorazí AŽ za await (mikrotask) – spouštěč mezitím doběhne', async () => {
    // Kontrakt pollingu: spouštěcí odpověď (createGame/postMove) odejde se stavem
    // 'thinking' DŘÍV, než worker dopočítá. In-process fake to drží tím, že .then
    // běží až jako mikrotask, ne synchronně uvnitř computeMove.
    const position = initialGameState().position;
    const worker = createInProcessEngineWorker({ now: makeClock() });
    const order: string[] = [];
    const done = worker
      .computeMove({ position, level: 'beginner', seed: 1, timeMs: 1 })
      .then(() => {
        order.push('worker');
      });
    order.push('caller');
    await done;
    expect(order).toEqual(['caller', 'worker']);
  });

  it('chyba jádra (pozice bez tahu) přijde jako ODMÍTNUTÁ promise, ne synchronní throw', async () => {
    // Prázdná deska → žádný legální tah → searchTimed vyhodí RangeError. Fake ho
    // musí překlopit na reject (stejný async kontrakt jako reálný worker), ať se
    // dá odchytit awaitem, ne try kolem synchronního volání.
    const emptyPosition = { board: Array<null>(32).fill(null), turn: 'black' as const };
    const worker = createInProcessEngineWorker();
    await expect(
      worker.computeMove({ position: emptyPosition, level: 'beginner', seed: 1, timeMs: 1 }),
    ).rejects.toBeInstanceOf(Error);
  });
});

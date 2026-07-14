import { describe, expect, it } from 'vitest';
import { ITALIAN_RULESET, legalMoves } from '@checkers/rules';
import type { Move } from '@checkers/rules';
import { createInProcessEngineWorker } from '../../src/local/engine-worker.js';
import type { EngineWorker } from '../../src/local/engine-worker.js';
import type { EngineMoveRequest } from '../../src/local/compute-move.js';
import { createLocalClient } from '../../src/local-client.js';
import type { GameDto } from '../../src/server-client.js';
import { mulberry32 } from '../../src/local/prng.js';
import { makeClock, pollUntilSettled } from './helpers.js';

/**
 * Worker, který ZAZNAMENÁ variantu každého requestu (kvůli důkazu, že engine
 * počítá italsky) a jinak deleguje na reálné in-process jádro – vrácený tah je
 * skutečně spočítaný pravidly italské, ne fake.
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

/**
 * Uzavírací E2E italské AIvP CELÉ v prohlížeči (LocalClient + in-process worker),
 * bez herního serveru: partie od zahájení až do TERMINÁLNÍHO výsledku.
 *
 * Determinismus: člověk hraje vždy PRVNÍ nabízený legální tah, engine odpoví
 * (seed + hodiny fixní). Deska musí dojet do konce (výhra/remíza) přes pravidla
 * remíz (80 půltahů bez pokroku / trojnásobné opakování), NE zamrznout ani
 * pustit nelegální tah.
 */
describe('LocalClient – italská AIvP kompletní partie do konce (IT-11)', () => {
  it('partie doběhne s terminálním výsledkem a každý tah člověka je legální italský', async () => {
    const { worker, requests } = recordingWorker();
    const client = createLocalClient(worker, {
      rng: mulberry32(0xabc1_2345),
      seed: () => 0x1234_abcd,
      timeMs: 1,
      now: makeClock(),
      variant: 'italian',
    });

    let dto: GameDto = await client.createGame('beginner', 'black'); // člověk začíná (černý)
    expect(dto.variant).toBe('italian');

    // Strop je pojistka proti zaseknutí, ne očekávaná délka: 80 půltahů bez pokroku
    // je remíza, takže reálná partie skončí dřív. Kdyby smyčka narazila na strop,
    // partie „nedoběhla" → test padne na assertu result !== 'ongoing' níž.
    const PLY_CAP = 600;
    let humanMovesPlayed = 0;
    let ply = 0;
    for (; ply < PLY_CAP && dto.result === 'ongoing'; ply++) {
      // Legální tahy z DTO MUSÍ přesně odpovídat ITALIAN_RULESET. Teeth (ověřeno
      // mutací): kdyby klient generoval tahy jinou variantou (americkou), sady se
      // v této partii rozejdou nejpozději na první capture pozici (italská geometrie
      // braní vs. americká) a assert padne – člověk by pak mohl zahrát tah, který
      // ITALIAN_RULESET zakazuje. POZN.: tato deterministická trajektorie nedovede
      // člověka k VOLBĚ mezi více braními různé délky, takže FID max-count/tie-break
      // NA TAHU ČLOVĚKA tu ověřen NENÍ – to pokrývají rules-level perft/fixtures (IT-5).
      // Zde jde o e2e důkaz „italský ruleset je zadrátovaný a partie pod ním doběhne".
      const italianMoves = legalMoves(dto.position, ITALIAN_RULESET).map((m) => [m.from, ...m.path]);
      expect(dto.legalMoves.map((m) => [m.from, ...m.path])).toEqual(italianMoves);

      const my = dto.legalMoves[0];
      if (my === undefined) {
        break; // žádný tah → partie končí (vyhodnotí se níž)
      }
      // postMove NESMÍ thrownout: kdyby první nabízený tah nebyl legální italský,
      // LocalClient by ho odmítl ServerError('illegal_move').
      const after = await client.postMove(dto.id, my.from, my.path);
      humanMovesPlayed++;
      // Engine buď přemýšlí (je na tahu), nebo partie po tahu člověka skončila.
      expect(['thinking', 'idle']).toContain(after.engineStatus);
      const settled = await pollUntilSettled(client, dto.id);
      expect(settled.engineStatus).not.toBe('error');
      expect(settled.variant).toBe('italian');
      dto = settled;
    }

    // Jádro brány: partie NEZAMRZLA a došla do terminálního stavu.
    expect(dto.result).not.toBe('ongoing');
    expect(['black-wins', 'white-wins', 'draw']).toContain(dto.result);
    expect(humanMovesPlayed).toBeGreaterThan(0);

    // Engine reálně počítal italsky (ne default american): každý request nesl variantu.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.variant === 'italian')).toBe(true);
  });
});

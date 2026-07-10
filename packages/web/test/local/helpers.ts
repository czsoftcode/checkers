import type { GameDto, ServerClient } from '../../src/server-client.js';
import type { EngineWorker } from '../../src/local/engine-worker.js';
import type { Move } from '@checkers/rules';

/**
 * Worker, jehož `computeMove` NIKDY nedoběhne (visící promise). Drží partii v
 * `thinking` s enginem na tahu – pro testy cest, které se v provozu spustí, jen
 * když engine ještě nedotáhl (guard „na tahu je počítač"). In-process fake by
 * dopočítal mikrotaskem dřív, než se ke guardu vůbec dostaneme.
 */
export function createBlockingWorker(): EngineWorker {
  return {
    computeMove(): Promise<Move> {
      return new Promise<Move>(() => {
        /* nikdy neresolvuje */
      });
    },
  };
}

/** Worker, jehož `computeMove` VŽDY selže – pro test chybové cesty (engineStatus='error'). */
export function createFailingWorker(): EngineWorker {
  return {
    computeMove(): Promise<Move> {
      return Promise.reject(new Error('worker enginu selhal (test)'));
    },
  };
}

/**
 * Čerstvé injektovatelné hodiny pro `searchTimed`: monotónně rostoucí čas s
 * velkým krokem. S malým `timeMs` search DETERMINISTICKY zastaví hned po hloubce 1
 * (nezávisle na rychlosti stroje). Absolutní hodnota hodin nehraje roli – každý
 * search si bere vlastní `start = now()`, takže dosažená hloubka závisí jen na
 * poměru krok/timeMs.
 */
export function makeClock(step = 1_000_000): () => number {
  let t = -step;
  return () => {
    t += step;
    return t;
  };
}

/**
 * Opakuje `getGame`, dokud engine přemýšlí (`thinking`), a vrátí první stav, kde
 * už engine dotáhl (idle/error) – model pollingu controlleru. In-process worker
 * dopočítá mikrotaskem, takže pár tiků stačí; strop je pojistka proti zaseknutí.
 */
export async function pollUntilSettled(
  client: ServerClient,
  id: string,
  maxTicks = 100,
): Promise<GameDto> {
  for (let i = 0; i < maxTicks; i++) {
    const dto = await client.getGame(id);
    if (dto.engineStatus !== 'thinking') {
      return dto;
    }
    await Promise.resolve();
  }
  throw new Error(`Engine nedotáhl po ${String(maxTicks)} ticích`);
}

/**
 * Transport výpočtu tahu enginu za INJEKTOVATELNÝM rozhraním `EngineWorker`
 * (fáze 87). `LocalClient` dostane implementaci zvenčí (stejný vzor jako dnešní
 * injektovatelný `fetchImpl` / `GameWebSocket`), takže:
 *  - PROVOZ dostane `createWebWorkerEngineWorker` (reálný Web Worker – ~1 s search
 *    mimo hlavní vlákno, UI nezmrzne),
 *  - TESTY dostanou `createInProcessEngineWorker` (jsdom nemá Web Worker; jádro
 *    běží in-process, deterministicky a s injektovatelnými hodinami).
 *
 * Rozhraní je úmyslně minimální (jen `computeMove`): nabídku remízy i nápovědu
 * řeší `LocalClient` jinými cestami, worker počítá výhradně tah.
 */

import type { Move } from '@checkers/rules';
import { computeEngineMove } from './compute-move.js';
import type { EngineMoveRequest } from './compute-move.js';
import type { WorkerRequest, WorkerResponse } from './engine-worker-protocol.js';

/**
 * Rozhraní výpočtu tahu enginu. `computeMove` vrací Promise – reálný worker
 * počítá asynchronně (odpověď dorazí zprávou), in-process fake resolvne
 * mikrotaskem. Volající (`LocalClient`) na to spoléhá: tah enginu je vždy až za
 * `await`, takže spouštěcí odpověď (`postMove`/`createGame`) odejde dřív se stavem
 * `thinking` (kontrakt pollingu, stejně jako server).
 *
 * `dispose` (volitelné) uvolní reálný worker; in-process fake ho nemá.
 */
export interface EngineWorker {
  computeMove(req: EngineMoveRequest): Promise<Move>;
  dispose?(): void;
}

/**
 * In-process implementace: jádro (`computeEngineMove`) běží na hlavním vlákně a
 * výsledek se vrátí jako již splněná Promise. `now` (volitelné) jsou injektovatelné
 * hodiny pro deterministický test (produkce by tuhle implementaci nepoužila –
 * blokovala by UI). Chybu jádra překlopí na ODMÍTNUTOU promise (ne synchronní
 * throw), ať má volající stejný async kontrakt jako u reálného workeru.
 */
export function createInProcessEngineWorker(options: { now?: () => number } = {}): EngineWorker {
  const { now } = options;
  return {
    computeMove(req: EngineMoveRequest): Promise<Move> {
      try {
        return Promise.resolve(computeEngineMove(req, now));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}

/**
 * Reálný Web Worker (provoz). Bundluje ho Vite z `engine-worker-entry.ts`. Víc
 * requestů najednou (tah + nápověda) se páruje přes rostoucí `id` – odpověď
 * dorazí správnému čekateli, ne prvnímu v pořadí. Globální selhání workeru
 * (`onerror`) ODMÍTNE všechny visící requesty, ať `LocalClient` nezůstane viset
 * na 'thinking'.
 *
 * NEpoužívá se v testech (jsdom nemá Web Worker); ověřuje se typecheckem + buildem
 * a ručně (přepnutí UI na LocalClient je fáze #49).
 */
export function createWebWorkerEngineWorker(): EngineWorker {
  const worker = new Worker(new URL('./engine-worker-entry.ts', import.meta.url), {
    type: 'module',
  });
  const pending = new Map<number, { resolve: (move: Move) => void; reject: (err: Error) => void }>();
  let nextId = 0;

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const { id, move, error } = event.data;
    const entry = pending.get(id);
    if (entry === undefined) {
      return; // neznámé/duplicitní id – nic k doručení
    }
    pending.delete(id);
    if (error !== undefined) {
      entry.reject(new Error(`Worker enginu selhal: ${error}`));
      return;
    }
    if (move === undefined) {
      entry.reject(new Error('Worker enginu vrátil odpověď bez tahu i bez chyby'));
      return;
    }
    entry.resolve(move);
  };

  worker.onerror = (event: ErrorEvent) => {
    const err = new Error(`Web Worker enginu selhal: ${event.message}`);
    for (const entry of pending.values()) {
      entry.reject(err);
    }
    pending.clear();
  };

  return {
    computeMove(req: EngineMoveRequest): Promise<Move> {
      const id = nextId++;
      return new Promise<Move>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const message: WorkerRequest = { id, req };
        worker.postMessage(message);
      });
    },
    dispose(): void {
      worker.terminate();
      const err = new Error('Web Worker enginu byl ukončen');
      for (const entry of pending.values()) {
        entry.reject(err);
      }
      pending.clear();
    },
  };
}

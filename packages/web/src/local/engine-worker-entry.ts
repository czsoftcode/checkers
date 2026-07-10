/// <reference lib="webworker" />
/**
 * Vstupní modul Web Workeru enginu (fáze 87) – běží na VLASTNÍM vlákně, ať ~1 s
 * search nezmrazí UI. Tenký transport: přijme zprávu, zavolá čisté jádro
 * (`computeEngineMove`) a pošle tah zpět. Žádná logika navíc – politika síly,
 * kniha i seed jsou v jádru.
 *
 * Bundluje ho Vite (`new Worker(new URL('./engine-worker-entry.ts', import.meta.url),
 * { type: 'module' })` v `engine-worker.ts`); přímo se neimportuje. `self` se castuje
 * na `DedicatedWorkerGlobalScope`, protože tsconfig webu má lib DOM (kvůli zbytku
 * klienta) – `/// <reference lib="webworker" />` doplní typy workeru pro tenhle soubor.
 */

import { computeEngineMove } from './compute-move.js';
import type { WorkerRequest, WorkerResponse } from './engine-worker-protocol.js';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, req } = event.data;
  try {
    const move = computeEngineMove(req);
    const response: WorkerResponse = { id, move };
    ctx.postMessage(response);
  } catch (error) {
    // Jádro vyhodilo (např. pozice bez tahu = programová chyba volajícího). Chyba
    // se přenese jako text zpět – hlavní vlákno ji přemapuje na odmítnutí promise,
    // ať LocalClient nezůstane viset na 'thinking'. Worker sám nespadne.
    const response: WorkerResponse = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(response);
  }
};

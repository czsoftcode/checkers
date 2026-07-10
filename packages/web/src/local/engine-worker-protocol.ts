/**
 * Drátový protokol mezi hlavním vláknem a Web Workerem enginu (fáze 87).
 *
 * SDÍLENÝ kontrakt dvou modulů (`engine-worker.ts` na hlavním vlákně a
 * `engine-worker-entry.ts` uvnitř workeru) – proto žije na JEDNOM místě jako typ,
 * ne jako duplikovaný literál v obou (jinak by se tvar zpráv mohl tiše rozejít).
 * `id` páruje odpověď k požadavku: worker může dostat víc requestů (tah + nápověda)
 * a hlavní vlákno musí odpověď doručit správnému čekateli, ne prvnímu v pořadí.
 */

import type { Move } from '@checkers/rules';
import type { EngineMoveRequest } from './compute-move.js';

/** Požadavek hlavního vlákna → worker: spočítej tah pro `req` a odpověz s `id`. */
export interface WorkerRequest {
  readonly id: number;
  readonly req: EngineMoveRequest;
}

/**
 * Odpověď workeru → hlavní vlákno. Právě jedno z `move`/`error` je vyplněné:
 * `move` při úspěchu, `error` (text) když jádro vyhodilo. `id` páruje k requestu.
 */
export interface WorkerResponse {
  readonly id: number;
  readonly move?: Move;
  readonly error?: string;
}

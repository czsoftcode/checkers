/**
 * TS engine americké dámy – samostatný proces za JSON Lines protokolem.
 *
 * Veřejné API balíčku: protokolové typy a konstanty (kontrakt pro server),
 * LineBuffer a handleLine pro testování bez procesu. Spustitelný vstup je
 * `src/main.ts` (tsx), ten se neimportuje.
 */

export {
  ENGINE_ID,
  PROTOCOL_VERSION,
  ERROR_CODES,
  type MessageId,
  type ErrorCode,
  type HelloRequest,
  type BestmoveRequest,
  type EngineRequest,
  type HelloResponse,
  type BestmoveResponse,
  type ErrorResponse,
  type EngineResponse,
} from './protocol.js';
export { LineBuffer } from './line-buffer.js';
export { handleLine } from './handler.js';

/**
 * Autoritativní server partie (Fastify + zod) – jediný zdroj pravdy.
 * Veřejné API balíčku.
 */

/** Výchozí port HTTP serveru. */
export const DEFAULT_PORT = 3000;

export { buildApp } from './app.js';
export type { BuildAppOptions } from './app.js';
export { formatGamePdn, writeGamePdn } from './archive.js';
export { GameStore, effectiveResult, opposite } from './store.js';
export type { GameRecord, EngineStatus } from './store.js';
export { moveToDto, legalMoveDtos, gameToDto, findLegalMove } from './dto.js';
export type { MoveDto, GameDto } from './dto.js';
export { ERROR_CODES, sendError } from './errors.js';
export type { ErrorCode, ErrorEnvelope } from './errors.js';
export {
  EngineClient,
  defaultEngineCommand,
  DEFAULT_ENGINE_TIME_MS,
  HARD_TIMEOUT_MARGIN_MS,
  EngineTimeoutError,
  EngineCrashError,
  EngineProtocolError,
  EngineClosedError,
} from './engine-client.js';
export type {
  EngineMover,
  EngineEvaluation,
  EngineClientOptions,
  SpawnCommand,
  Strength,
} from './engine-client.js';
export { LEVELS, DEFAULT_LEVEL, STRENGTH_BY_LEVEL, LEVELS_WITH_BOOK, levelUsesBook } from './levels.js';
export type { GameLevel } from './levels.js';
export { OPENING_BOOK, buildBook, lookupBookMove } from './opening-book.js';
export type { OpeningBook } from './opening-book.js';
export { mulberry32 } from './prng.js';

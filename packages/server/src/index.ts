/**
 * Autoritativní server partie (Fastify + zod) – jediný zdroj pravdy.
 * Veřejné API balíčku.
 */

/** Výchozí port HTTP serveru. */
export const DEFAULT_PORT = 3000;

export { buildApp } from './app.js';
export { GameStore } from './store.js';
export type { GameRecord } from './store.js';
export { moveToDto, legalMoveDtos, gameToDto, findLegalMove } from './dto.js';
export type { MoveDto, GameDto } from './dto.js';
export { ERROR_CODES, sendError } from './errors.js';
export type { ErrorCode, ErrorEnvelope } from './errors.js';

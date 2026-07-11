/**
 * Autoritativní server partie (Fastify + zod) – jediný zdroj pravdy.
 * Veřejné API balíčku.
 */

/** Výchozí port HTTP serveru. */
export const DEFAULT_PORT = 3000;

export { buildApp } from './app.js';
export type { BuildAppOptions } from './app.js';
export { formatGamePdn, writeGamePdn } from './archive.js';
export { GameStore, effectiveResult, endReason, opposite } from './store.js';
export type {
  GameRecord,
  EngineGameRecord,
  PvpGameRecord,
  PvpPlayers,
  EngineStatus,
  ForcedReason,
  EndReason,
} from './store.js';
export { ChallengeRegistry } from './challenges.js';
export type {
  Challenge,
  CreateChallengeResult,
  AcceptChallengeResult,
  RejectChallengeResult,
} from './challenges.js';
export { moveToDto, legalMoveDtos, gameToDto, pvpGameToDto, findLegalMove } from './dto.js';
export type { MoveDto, GameDto, PvpGameDto, AnyGameDto, GameStateMessage } from './dto.js';
export { GameHub } from './hub.js';
export type { HubSocket } from './hub.js';
export { RoomPresence, NICK_MAX_LENGTH } from './presence.js';
export type {
  RoomSocket,
  RoomPlayer,
  JoinResult,
  RoomServerMessage,
  RosterMessage,
  JoinedMessage,
  LeftMessage,
  NickTakenMessage,
  RoomErrorMessage,
  ChallengedMessage,
  ChallengeAcceptedMessage,
  ChallengeRejectedMessage,
  ChallengeCancelledMessage,
  DrawOfferedMessage,
  DrawRejectedMessage,
  RematchOfferedMessage,
  RematchDeclinedMessage,
  GameClosedMessage,
} from './presence.js';
export { ERROR_CODES, sendError } from './errors.js';
export type { ErrorCode, ErrorEnvelope } from './errors.js';
// Engine-client (podproces enginu) byl odstraněn s fází 90 – server AI nepočítá,
// běží v prohlížeči přes @checkers/ai. Re-export už tedy není.
// Úrovně a kniha zahájení žijí v `@checkers/ai` (fáze 86). Pass-through re-export
// drží veřejné API serveru beze změny pro testy i volající, které je importují
// z `@checkers/server`.
export { LEVELS, DEFAULT_LEVEL, STRENGTH_BY_LEVEL, LEVELS_WITH_BOOK, levelUsesBook } from '@checkers/ai';
export type { GameLevel } from '@checkers/ai';
export { OPENING_BOOK, buildBook, lookupBookMove } from '@checkers/ai';
export type { OpeningBook } from '@checkers/ai';
export { mulberry32 } from './prng.js';

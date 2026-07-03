/**
 * Knihovna pravidel americké dámy (English draughts).
 * Čistý TypeScript bez I/O – sdílí ji server, klient i TS engine.
 */

export type { Color, PieceKind, Piece, Cell, Square, Position, Move } from './types.js';
export {
  BOARD_SQUARES,
  BOARD_SIZE,
  isDarkSquare,
  squareToCoords,
  coordsToSquare,
  DIR,
  NEIGHBORS,
  JUMPS,
  neighborOf,
  jumpOf,
} from './board.js';
export type { Coords, Direction, DirTargets } from './board.js';
export { initialPosition } from './position.js';
// Jediné veřejné API generátoru tahů. Stavební bloky (simpleMovesFrom,
// jumpMovesFrom, generateSimpleMoves) se záměrně neexportují – ignorují
// povinnost braní a napojení na ně by tiše nabízelo nelegální tahy.
export { legalMoves } from './moves.js';
export { applyMove } from './apply.js';
export {
  MAX_PLIES_WITHOUT_PROGRESS,
  positionKey,
  initialGameState,
  advanceState,
} from './state.js';
export type { GameState } from './state.js';
export { gameResult, gameResultFromState } from './result.js';
export type { GameResult } from './result.js';
export { formatMove, parseMove } from './notation.js';
export { perft } from './perft.js';

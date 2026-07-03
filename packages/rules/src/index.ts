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
export { simpleMovesFrom, generateSimpleMoves } from './moves.js';

/**
 * Perft – počet listových uzlů stromu legálních tahů do dané hloubky.
 * Páteř ověření generátoru: hodnoty 1–6 z výchozí pozice se porovnávají
 * s publikovanými čísly nezávislého zdroje (viz test). Vícenásobný skok
 * je JEDEN tah (jeden uzel) – plyne z kontraktu legalMoves.
 *
 * Stejná čísla přibijí i případný budoucí Rust engine (řízená duplicita
 * generátoru) – proto je perft součástí veřejného API knihovny.
 */

import { applyMove } from './apply.js';
import { legalMoves } from './moves.js';
import type { Position } from './types.js';

/** Počet listů stromu legálních tahů v hloubce `depth` (0 = 1 list). */
export function perft(position: Position, depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new RangeError(`Neplatná hloubka perft: ${String(depth)}`);
  }
  if (depth === 0) {
    return 1;
  }
  let nodes = 0;
  for (const move of legalMoves(position)) {
    nodes += perft(applyMove(position, move), depth - 1);
  }
  return nodes;
}

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

/**
 * Tvrdý strop hloubky. Perft roste exponenciálně – hloubka bez stropu
 * z nedůvěryhodného vstupu (request, CLI argument) by zamrazila proces.
 * 12 stačí na ověření generátoru i případný benchmark; hlubší volání
 * je vždy chyba volajícího, ne legitimní použití.
 */
export const MAX_PERFT_DEPTH = 12;

/** Počet listů stromu legálních tahů v hloubce `depth` (0 = 1 list, max MAX_PERFT_DEPTH). */
export function perft(position: Position, depth: number): number {
  if (!Number.isInteger(depth) || depth < 0 || depth > MAX_PERFT_DEPTH) {
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

/**
 * Výsledek pozice.
 */

import { legalMoves } from './moves.js';
import type { Position } from './types.js';

/** Výsledek pozice: partie běží, nebo jedna strana vyhrála. */
export type GameResult = 'ongoing' | 'black-wins' | 'white-wins';

/**
 * Hráč na tahu bez legálního tahu prohrává – i s kameny na desce
 * (pat v americké dámě neexistuje, past z GDD 2.7). Staví na kontraktu
 * „prázdné legalMoves = žádný tah" zafixovaném testy fáze 4.
 *
 * Remízy (trojí opakování, 80 půltahů bez postupu) potřebují stav NAD
 * rámec jedné pozice (historii, čítač) a řeší se samostatně (todo 8).
 */
export function gameResult(position: Position): GameResult {
  if (legalMoves(position).length > 0) {
    return 'ongoing';
  }
  return position.turn === 'black' ? 'white-wins' : 'black-wins';
}

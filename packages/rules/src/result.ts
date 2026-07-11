/**
 * Výsledek pozice a výsledek stavu partie.
 */

import { legalMoves } from './moves.js';
import { AMERICAN_RULESET } from './ruleset.js';
import type { Ruleset } from './ruleset.js';
import type { GameState } from './state.js';
import { MAX_PLIES_WITHOUT_PROGRESS } from './state.js';
import type { Position } from './types.js';
import { rulesetForVariant } from './variant.js';

/**
 * Výsledek partie. `gameResult` (jen pozice) `'draw'` nikdy nevrátí –
 * remízy potřebují stav napříč tahy a umí je až `gameResultFromState`.
 */
export type GameResult = 'ongoing' | 'black-wins' | 'white-wins' | 'draw';

/**
 * Hráč na tahu bez legálního tahu prohrává – i s kameny na desce
 * (pat v americké dámě neexistuje, past z GDD 2.7). Staví na kontraktu
 * „prázdné legalMoves = žádný tah" zafixovaném testy fáze 4.
 */
export function gameResult(position: Position, ruleset: Ruleset = AMERICAN_RULESET): GameResult {
  if (legalMoves(position, ruleset).length > 0) {
    return 'ongoing';
  }
  return position.turn === 'black' ? 'white-wins' : 'black-wins';
}

/**
 * Výsledek stavu partie včetně remíz. Pořadí kontrol je rozhodnutí
 * z diskuse fáze 8: PROHRA MÁ PŘEDNOST – kdo nemá tah, prohrál, i kdyby
 * zároveň platila remízová podmínka. Pak remíza při 80 půltazích bez
 * pokroku, nebo když se KTERÁKOLI pozice v historii (od posledního pokroku)
 * vyskytla aspoň třikrát – ne jen aktuální. Konzument, který dávkově přehraje
 * víc půltahů a zkontroluje až konec, tak opakování v rámci úseku nepřejede.
 *
 * KONTRAKT: vyhodnocuj po KAŽDÉM půltahu (viz `advanceState`). Přes pokrok
 * detekce nedosáhne – braní/tah mužem nuluje čítač i historii, přejetá
 * remíza z čítače je pryč. Ručně poskládaný stav s nekonzistentní historií
 * nevede na falešnou remízu z aktuální pozice – ta se do historie počítá
 * jen tehdy, když v ní opravdu je.
 */
export function gameResultFromState(state: GameState): GameResult {
  // Konec „bez tahu" se počítá v rulesetu VARIANTY – jinak by neamerická partie
  // vyhodnocovala legalMoves americky a mohla hlásit prohru tam, kde tah existuje.
  const positional = gameResult(state.position, rulesetForVariant(state.variant));
  if (positional !== 'ongoing') {
    return positional;
  }
  if (state.pliesWithoutProgress >= MAX_PLIES_WITHOUT_PROGRESS) {
    return 'draw';
  }
  const occurrences = new Map<string, number>();
  for (const seen of state.repetitionHistory) {
    const count = (occurrences.get(seen) ?? 0) + 1;
    if (count >= 3) {
      return 'draw';
    }
    occurrences.set(seen, count);
  }
  return 'ongoing';
}

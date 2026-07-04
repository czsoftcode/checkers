/**
 * In-memory úložiště rozehraných partií. Jeden proces, žádná perzistence –
 * vědomé rozhodnutí v1 (partie žijí v paměti serveru, DB se nepřidává).
 */

import { randomUUID } from 'node:crypto';
import { advanceState, initialGameState } from '@checkers/rules';
import type { GameState, Move } from '@checkers/rules';

/** Záznam partie: id + její aktuální stav (podklad remízových pravidel). */
export interface GameRecord {
  readonly id: string;
  readonly state: GameState;
}

export class GameStore {
  private readonly games = new Map<string, GameState>();

  /** Založí novou partii ve výchozím rozestavění (černý na tahu). */
  create(): GameRecord {
    const id = randomUUID();
    const state = initialGameState();
    this.games.set(id, state);
    return { id, state };
  }

  get(id: string): GameRecord | undefined {
    const state = this.games.get(id);
    return state === undefined ? undefined : { id, state };
  }

  /**
   * Posune partii o OVĚŘENÝ legální tah a vrátí nový záznam. Volá se výhradně
   * s tahem, který prošel `findLegalMove`; `advanceState` na poškozeném vstupu
   * vyhodí RangeError – to by značilo chybu serveru, ne klienta, a nemaskuje se.
   * Vrací undefined jen když partie mezitím zmizela (v jednom procesu nenastane).
   */
  applyMove(id: string, move: Move): GameRecord | undefined {
    const state = this.games.get(id);
    if (state === undefined) {
      return undefined;
    }
    const next = advanceState(state, move);
    this.games.set(id, next);
    return { id, state: next };
  }
}

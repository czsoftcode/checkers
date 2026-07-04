/**
 * In-memory úložiště rozehraných partií. Jeden proces, žádná perzistence –
 * vědomé rozhodnutí v1 (partie žijí v paměti serveru, DB se nepřidává).
 *
 * Vedle stavu pravidel (`GameState`) drží partie i `engineStatus` – stav tahu
 * enginu na pozadí (idle/thinking/error). Není součást pravidel, je to čistě
 * serverová informace pro klienta (polling GET zjistí, jestli engine přemýšlí,
 * dotáhl tah, nebo selhal).
 */

import { randomUUID } from 'node:crypto';
import { advanceState, initialGameState } from '@checkers/rules';
import type { GameState, Move } from '@checkers/rules';

/**
 * Stav tahu enginu na pozadí:
 * - `idle` – engine nemá co dělat (na tahu je člověk, nebo je po partii),
 * - `thinking` – běží výpočet tahu enginu,
 * - `error` – engine selhal (timeout+retry vyčerpán, pád, nelegální tah);
 *   partie zůstává stát na tahu člověka, server nespadl.
 */
export type EngineStatus = 'idle' | 'thinking' | 'error';

/** Záznam partie: id + stav pravidel + stav tahu enginu. */
export interface GameRecord {
  readonly id: string;
  readonly state: GameState;
  readonly engineStatus: EngineStatus;
}

interface StoredGame {
  state: GameState;
  engineStatus: EngineStatus;
}

export class GameStore {
  private readonly games = new Map<string, StoredGame>();

  /** Založí novou partii ve výchozím rozestavění (černý na tahu, engine idle). */
  create(): GameRecord {
    const id = randomUUID();
    const game: StoredGame = { state: initialGameState(), engineStatus: 'idle' };
    this.games.set(id, game);
    return { id, ...game };
  }

  get(id: string): GameRecord | undefined {
    const game = this.games.get(id);
    return game === undefined ? undefined : { id, ...game };
  }

  /**
   * Posune partii o OVĚŘENÝ legální tah a vrátí nový záznam. Volá se výhradně
   * s tahem, který prošel `findLegalMove`; `advanceState` na poškozeném vstupu
   * vyhodí RangeError – to by značilo chybu serveru, ne klienta, a nemaskuje se.
   * Vrací undefined jen když partie mezitím zmizela (v jednom procesu nenastane).
   */
  applyMove(id: string, move: Move): GameRecord | undefined {
    const game = this.games.get(id);
    if (game === undefined) {
      return undefined;
    }
    game.state = advanceState(game.state, move);
    return { id, ...game };
  }

  /**
   * Nastaví stav tahu enginu. Vrací nový záznam, nebo undefined když partie
   * zmizela. Odděleno od applyMove: přechod na `thinking`/`error` mění jen
   * serverovou informaci, ne stav pravidel.
   */
  setEngineStatus(id: string, status: EngineStatus): GameRecord | undefined {
    const game = this.games.get(id);
    if (game === undefined) {
      return undefined;
    }
    game.engineStatus = status;
    return { id, ...game };
  }
}

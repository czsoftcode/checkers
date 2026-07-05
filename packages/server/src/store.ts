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
import { advanceState, gameResultFromState, initialGameState } from '@checkers/rules';
import type { GameResult, GameState, Move } from '@checkers/rules';
import { DEFAULT_LEVEL } from './levels.js';
import type { GameLevel } from './levels.js';

/**
 * Stav tahu enginu na pozadí:
 * - `idle` – engine nemá co dělat (na tahu je člověk, nebo je po partii),
 * - `thinking` – běží výpočet tahu enginu,
 * - `error` – engine selhal (timeout+retry vyčerpán, pád, nelegální tah);
 *   partie zůstává stát na tahu člověka, server nespadl.
 */
export type EngineStatus = 'idle' | 'thinking' | 'error';

/** Záznam partie: id + stav pravidel + stav tahu enginu + historie tahů. */
export interface GameRecord {
  readonly id: string;
  readonly state: GameState;
  readonly engineStatus: EngineStatus;
  /**
   * Odehrané tahy v pořadí. Drží je jen store – `GameState` je zahazuje
   * (nese pozici + čítače, ne seznam tahů), a z finální pozice se zpětně
   * zrekonstruovat nedají. Podklad pro archivní PDN celé partie (fáze 23).
   */
  readonly moves: readonly Move[];
  /** Byla partie už archivována na disk? Pojistka proti dvojímu zápisu. */
  readonly archived: boolean;
  /**
   * Vynucený výsledek partie MIMO pravidla (fáze 24). `null`, dokud se nikdo
   * nevzdal – pak výsledek plyne čistě z pozice (`gameResultFromState`). Po
   * vzdání drží `white-wins` (člověk = černý se vzdal). Efektivní výsledek celé
   * partie čte {@link effectiveResult} = `forcedResult ?? gameResultFromState`.
   */
  readonly forcedResult: GameResult | null;
  /**
   * Úroveň obtížnosti zvolená při založení partie (fáze 35). Fixní po celou
   * partii – tah enginu běží na pozadí (`runEngineMove`) a sílu čte odsud, ne z
   * klienta. Mapa úroveň → páky enginu žije v `levels.ts`.
   */
  readonly level: GameLevel;
}

interface StoredGame {
  state: GameState;
  engineStatus: EngineStatus;
  moves: Move[];
  archived: boolean;
  forcedResult: GameResult | null;
  level: GameLevel;
}

/**
 * Efektivní výsledek partie: vynucený (vzdání) má přednost, jinak se odvodí z
 * pozice. JEDINÝ zdroj pravdy o tom, jestli je partie u konce – všechny čtecí
 * cesty serveru (DTO, archivace, kontrola „je konec?", guardy tahu enginu) musí
 * jít přes něj, ne přímo přes `gameResultFromState`. Jinak by vzdání (které stav
 * pravidel NEmění – pozice zůstává `ongoing`) engine přehlédl a zahrál do už
 * vzdané partie. Typ parametru je strukturální, ať sedne na `GameRecord` i na
 * interní `StoredGame`.
 */
export function effectiveResult(game: {
  readonly forcedResult: GameResult | null;
  readonly state: GameState;
}): GameResult {
  return game.forcedResult ?? gameResultFromState(game.state);
}

export class GameStore {
  private readonly games = new Map<string, StoredGame>();

  /**
   * Snímek uloženého stavu do neměnného záznamu. `moves` se KOPÍRUJE, ne sdílí:
   * bez kopie by `record.moves` byl živý odkaz na pole, které store dál mutuje –
   * archivace by pak mohla vzít jiný seznam tahů, než jaký v partii byl v okamžiku
   * jejího konce. Move je readonly, stačí mělká kopie pole.
   */
  private toRecord(id: string, game: StoredGame): GameRecord {
    return {
      id,
      state: game.state,
      engineStatus: game.engineStatus,
      moves: [...game.moves],
      archived: game.archived,
      forcedResult: game.forcedResult,
      level: game.level,
    };
  }

  /**
   * Založí novou partii ve výchozím rozestavění (černý na tahu, engine idle).
   * `level` řídí sílu enginu; výchozí je Profesionál (dnešní chování), takže
   * volání bez argumentu zůstává zpětně kompatibilní.
   */
  create(level: GameLevel = DEFAULT_LEVEL): GameRecord {
    const id = randomUUID();
    const game: StoredGame = {
      state: initialGameState(),
      engineStatus: 'idle',
      moves: [],
      archived: false,
      forcedResult: null,
      level,
    };
    this.games.set(id, game);
    return this.toRecord(id, game);
  }

  get(id: string): GameRecord | undefined {
    const game = this.games.get(id);
    return game === undefined ? undefined : this.toRecord(id, game);
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
    // Nejdřív posun stavu (na poškozeném vstupu vyhodí RangeError PŘED zápisem
    // do historie – do `moves` se tak nikdy nedostane tah, který se neaplikoval).
    game.state = advanceState(game.state, move);
    game.moves.push(move);
    return this.toRecord(id, game);
  }

  /**
   * Vzdání partie: nastaví vynucený výsledek `white-wins` (člověk = černý se
   * vzdal → vyhrává bílý / počítač). Provede se JEN když je partie ještě
   * rozehraná podle efektivního výsledku – vzdát skončenou (přirozeně i už
   * vzdanou) partii nejde. Node je jednovláknový a mezi kontrolou a zápisem
   * není `await`, takže je to atomický check-and-set.
   *
   * Vrací nový záznam při úspěchu; `'not-found'` když partie neexistuje;
   * `'already-over'` když už byla terminální. Řetězcové signály (ne `undefined`)
   * ať volající rozliší 404 od 409, nedostane tichý `undefined` místo stavu.
   */
  resign(id: string): GameRecord | 'not-found' | 'already-over' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (effectiveResult(game) !== 'ongoing') {
      return 'already-over';
    }
    game.forcedResult = 'white-wins';
    return this.toRecord(id, game);
  }

  /**
   * Přijetí nabídky remízy: nastaví vynucený výsledek `draw`. Dvojče
   * {@link resign} – jediný rozdíl je hodnota výsledku. Provede se JEN když je
   * partie podle efektivního výsledku ještě rozehraná (přijmout skončenou nebo
   * už vzdanou partii nejde). Node je jednovláknový a mezi kontrolou a zápisem
   * není `await` → atomický check-and-set (o tom, KDY se remíza přijme,
   * rozhoduje volající přes engine; store jen bezpečně zapíše výsledek).
   *
   * Vrací nový záznam při úspěchu; `'not-found'` když partie neexistuje;
   * `'already-over'` když už byla terminální.
   */
  acceptDraw(id: string): GameRecord | 'not-found' | 'already-over' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (effectiveResult(game) !== 'ongoing') {
      return 'already-over';
    }
    game.forcedResult = 'draw';
    return this.toRecord(id, game);
  }

  /**
   * Označí partii za archivovanou. Vrací `true`, jen když se stav PRÁVĚ TEĎ
   * překlopil z false na true; `false` znamená „už archivováno" nebo „partie
   * zmizela". Slouží jako atomický check-and-set (Node je jednovláknový, mezi
   * čtením a zápisem není `await`) – zaručuje zápis PDN právě jednou.
   */
  markArchived(id: string): boolean {
    const game = this.games.get(id);
    if (game === undefined || game.archived) {
      return false;
    }
    game.archived = true;
    return true;
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
    return this.toRecord(id, game);
  }
}

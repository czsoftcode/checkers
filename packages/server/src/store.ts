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
import {
  THREE_MOVE_BALLOTS,
  advanceState,
  gameResultFromState,
  initialGameState,
  playBallot,
} from '@checkers/rules';
import type { Color, GameResult, GameState, Move } from '@checkers/rules';
import { DEFAULT_LEVEL } from './levels.js';
import type { GameLevel } from './levels.js';

/**
 * Opačná barva. Barvu enginu si server dopočítává z uložené barvy člověka
 * (`opposite(humanColor)`) – barva je JEDEN pojem (barva člověka), engine je
 * vždy druhá strana. Čistá funkce (`Color` je jen `'black' | 'white'`), ne do
 * `rules`: je to serverová logika autority, ne pravidlo hry.
 */
export function opposite(color: Color): Color {
  return color === 'black' ? 'white' : 'black';
}

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
  /**
   * Index vylosovaného třítahového zahájení (3-move ballot) do
   * `THREE_MOVE_BALLOTS`, nebo `null` pro partii bez vynuceného zahájení.
   * Nenulový je JEN u úrovně Mistrovství (`championship`); u ostatních úrovní
   * partie začíná výchozím rozestavěním a `ballotIndex` je `null`. Ballot samotný
   * je zároveň prvními třemi tahy v `moves` – index je navíc, ať klient (a log)
   * pozná KTERÉ zahájení padlo bez zpětného dohledávání proti decku.
   */
  readonly ballotIndex: number | null;
  /**
   * Barva ČLOVĚKA v této partii (fáze 50). Fixní po celou partii. Engine hraje
   * druhou stranu = `opposite(humanColor)`. Výchozí `'black'` = dosavadní chování
   * (člověk černý začíná, engine bílý), takže partie bez volby zůstávají beze
   * změny. Autoritou o barvě je server; řídí podle ní spouštění tahu enginu,
   * guardy „nejsi na tahu" i barvu výhry při vzdání.
   */
  readonly humanColor: Color;
}

interface StoredGame {
  state: GameState;
  engineStatus: EngineStatus;
  moves: Move[];
  archived: boolean;
  forcedResult: GameResult | null;
  level: GameLevel;
  ballotIndex: number | null;
  humanColor: Color;
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
   * Zdroj náhody pro los ballotu (úroveň Mistrovství). Očekává se hodnota
   * v [0, 1) jako `Math.random`. Injektuje se kvůli testu: seedovaný
   * `mulberry32(seed)` dá deterministický los (stejný seed = stejný ballot),
   * takže test má zuby. Produkce nechá výchozí `Math.random`.
   */
  private readonly rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

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
      ballotIndex: game.ballotIndex,
      humanColor: game.humanColor,
    };
  }

  /**
   * Vylosuje třítahové zahájení a NASADÍ ho autoritativní cestou: playBallot
   * spáruje půltahy proti reálným `legalMoves` (na neshodě throwuje = hlasitá
   * chyba, ne tichý falešný start), a jeho tři `Move` se pak přehrají přes
   * `advanceState` – stejná cesta jako tah hráče/enginu.
   *
   * Proč přehrát přes advanceState, a ne převzít hotovou `position` z playBallot:
   * store nese `GameState` (pozice + čítače remízy), ne holou `Position`.
   * `GameState` se staví z `initialGameState()` a `advanceState` – tady se ta
   * stavba jen zopakuje po odehraných tazích, místo ruční fabrikace stavu kolem
   * pozice. U SOUČASNÉHO decku je 3. půltah vždy pokrok (tah mužem nebo braní),
   * takže čítače stejně končí na nule; přehrání je tedy funkčně ekvivalentní, ale
   * drží se jednoho zdroje pravdy o tvaru stavu (kdyby deck někdy obsahoval
   * zahájení bez pokroku, čítače sednou samy).
   *
   * Vrací výslednou pozici (bílý na tahu), tři reálné tahy do historie a index
   * vylosovaného zahájení. Index mimo rozsah decku (rozbitý injektovaný `rng`)
   * vyhodí – to je programová chyba, ne klientský vstup, a nemaskuje se.
   */
  private seedBallot(): { state: GameState; moves: Move[]; index: number } {
    const index = Math.floor(this.rng() * THREE_MOVE_BALLOTS.length);
    return this.applyBallotByIndex(index);
  }

  /**
   * Nasadí KONKRÉTNÍ zahájení `THREE_MOVE_BALLOTS[index]` autoritativní cestou:
   * playBallot spáruje půltahy proti reálným `legalMoves` (na neshodě throwuje =
   * hlasitá chyba), jeho tři `Move` se přehrají přes `advanceState` – stejná cesta
   * jako tah hráče/enginu. Sdílí ho los ({@link seedBallot}) i fixní nasazení
   * z {@link create}, takže „přehraj ballot podle indexu" žije na JEDNOM místě.
   *
   * Index MIMO rozsah decku vyhodí RangeError. To je programová chyba VOLAJÍCÍHO
   * (rozbitý injektovaný `rng` u losu, nebo neověřený index), NE klientský vstup:
   * klientský `ballotIndex` ověřuje route rozsahem PŘED voláním store (vrací 400),
   * sem se dostane až zaručeně platný. Proto se tu RangeError (→ 500) nemaskuje na 400.
   */
  private applyBallotByIndex(index: number): { state: GameState; moves: Move[]; index: number } {
    const ballot = THREE_MOVE_BALLOTS[index];
    if (ballot === undefined) {
      throw new RangeError(
        `Ballot mimo rozsah: index ${String(index)} pro deck délky ${String(
          THREE_MOVE_BALLOTS.length,
        )}`,
      );
    }
    const { moves } = playBallot(ballot);
    let state = initialGameState();
    for (const move of moves) {
      state = advanceState(state, move);
    }
    // Kopie do MUTABLE pole: store do `moves` dál pushuje (applyMove), kdežto
    // playBallot vrací `readonly Move[]`. Bez kopie by StoredGame.moves nešlo
    // typovat jako mutable a sdílel by odkaz s návratem playBallotu.
    return { state, moves: [...moves], index };
  }

  /**
   * Založí novou partii. Pro úroveň Mistrovství (`championship`) vylosuje a
   * nasadí třítahové zahájení (viz {@link seedBallot}) – partie začíná
   * popballotovou pozicí s BÍLÝM na tahu (= engine táhne první) a s třemi tahy
   * v historii. Pro ostatní úrovně platí výchozí rozestavění (černý na tahu),
   * `ballotIndex` je `null`. `level` řídí sílu enginu; výchozí je Profesionál
   * (dnešní chování), takže volání bez argumentu zůstává zpětně kompatibilní.
   *
   * `humanColor` je barva člověka (engine hraje `opposite`); výchozí `'black'`
   * = dnešek. Barvu volí klient, na losování ballotu ani na rozestavění nemá
   * vliv – ballot vždy udělá tři půltahy (černý-bílý-černý). Kdo z nich je engine,
   * řeší až app při spouštění tahu (podle `opposite(humanColor)`).
   *
   * `ballotIndex` (volitelný) NASADÍ fixní zahájení místo losu – používá ho kolo 2
   * Mistrovství, aby přehrálo stejný ballot jako kolo 1. Dává smysl JEN u
   * `championship`; poslat ho s jinou úrovní je chyba volajícího (route ji blokuje
   * 400 už PŘED voláním store) → tady se ozve hlasitě RangeErrorem, ne tiše
   * ignorovaným indexem. Rozsah indexu proti decku ověřuje applyBallotByIndex.
   */
  create(
    level: GameLevel = DEFAULT_LEVEL,
    humanColor: Color = 'black',
    ballotIndex?: number,
  ): GameRecord {
    if (ballotIndex !== undefined && level !== 'championship') {
      throw new RangeError(
        `ballotIndex zadán pro úroveň '${level}', ale fixní ballot je jen pro 'championship'`,
      );
    }
    const id = randomUUID();
    let seeded: { state: GameState; moves: Move[]; index: number } | null = null;
    if (level === 'championship') {
      seeded =
        ballotIndex !== undefined ? this.applyBallotByIndex(ballotIndex) : this.seedBallot();
    }
    const game: StoredGame = {
      state: seeded?.state ?? initialGameState(),
      engineStatus: 'idle',
      moves: seeded?.moves ?? [],
      archived: false,
      forcedResult: null,
      level,
      ballotIndex: seeded?.index ?? null,
      humanColor,
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
   * Vzdání partie: člověk se vzdá → vyhrává ENGINE (druhá barva). Výsledek je
   * proto barva enginu = `opposite(humanColor)`: člověk černý → `white-wins`
   * (dnešek), člověk bílý → `black-wins`. NEsmí být natvrdo `white-wins`, jinak by
   * při obrácené barvě vzdání připsalo výhru straně, která se vzdala. Provede se
   * JEN když je partie ještě rozehraná podle efektivního výsledku – vzdát skončenou
   * (přirozeně i už vzdanou) partii nejde. Node je jednovláknový a mezi kontrolou
   * a zápisem není `await`, takže je to atomický check-and-set.
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
    game.forcedResult = opposite(game.humanColor) === 'white' ? 'white-wins' : 'black-wins';
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

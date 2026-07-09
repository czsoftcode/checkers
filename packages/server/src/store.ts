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

/**
 * Barvy → skryté session id hráčů v PvP partii (fáze 68). Dvě LIDSKÉ strany,
 * žádný engine. Vyzyvatel dostává černou (v americké dámě táhne první), vyzvaný
 * bílou (viz {@link GameStore.createPvp}). Session id přiděluje `RoomPresence`;
 * je per-spojení, po odpojení zaniká (stabilní identita/reconnection = todo 42),
 * takže binding je do 42 křehký.
 */
export interface PvpPlayers {
  readonly black: string;
  readonly white: string;
}

/** Společná část záznamu partie pro oba režimy (engine i PvP). */
interface GameRecordBase {
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
   * PROČ byl {@link forcedResult} vynucen (fáze 78). `'resign'` = někdo se vzdal,
   * `'draw-agreement'` = přijatá nabídka remízy. `null`, dokud výsledek nevznikl
   * vynuceně (partie běží, nebo skončila čistě podle pravidel z pozice). Drží se
   * kvůli tomu, aby druhý hráč u výsledku viděl DŮVOD konce, ne jen holé skóre –
   * `forcedResult` sám (jen výherní strana) vzdání od dohody nerozliší. Drátový
   * důvod (včetně `'rules'` pro konec z pozice) odvozuje {@link endReason}.
   */
  readonly forcedReason: ForcedReason | null;
}

/**
 * Partie ČLOVĚK vs. ENGINE (dosavadní model, fáze 18–64). Engine hraje stranu
 * `opposite(humanColor)`; `level`/`ballotIndex` řídí sílu a zahájení. Diskriminátor
 * `mode: 'engine'` odděluje tento tvar od PvP – engine-cesty (spouštění tahu,
 * vzdání, remíza, nápověda, dto) čtou pole níž JEN po zúžení přes `mode`.
 */
export interface EngineGameRecord extends GameRecordBase {
  readonly mode: 'engine';
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

/**
 * Partie DVOU LIDÍ (V3, fáze 68). Bez enginu, bez úrovně i ballotu – startuje z
 * výchozího rozestavění (černý na tahu). `players` váže barvu na session id hráče.
 * V tomto řezu se ještě NEHRAJE (routování a autorita tahů = todo 36); záznam je
 * jen substrát, na který navazuje párování a pozdější hraní.
 */
export interface PvpGameRecord extends GameRecordBase {
  readonly mode: 'pvp';
  readonly players: PvpPlayers;
}

/** Záznam partie: engine, nebo PvP. Diskriminátor `mode` je zdroj pravdy. */
export type GameRecord = EngineGameRecord | PvpGameRecord;

interface StoredGameBase {
  state: GameState;
  engineStatus: EngineStatus;
  moves: Move[];
  archived: boolean;
  forcedResult: GameResult | null;
  /** Příčina vynuceného konce (fáze 78); `null` dokud výsledek nevznikl vynuceně. */
  forcedReason: ForcedReason | null;
}
interface EngineStoredGame extends StoredGameBase {
  mode: 'engine';
  level: GameLevel;
  ballotIndex: number | null;
  humanColor: Color;
}
interface PvpStoredGame extends StoredGameBase {
  mode: 'pvp';
  players: PvpPlayers;
  /**
   * Session id hráče, který PRÁVĚ TEĎ nabídl remízu a čeká na odpověď soupeře,
   * nebo `null`, když žádná nabídka nevisí (fáze 77). Nabídka je stav MIMO
   * pravidla (pozice se nemění), proto ho drží store, ne `GameState`. Zruší ho:
   * přijetí (→ `draw`), odmítnutí (→ zpět na `null`), vzdání a KAŽDÝ tah (tah =
   * implicitní odmítnutí nabídky, jak je v dámě zvykem). Soupeře o nabídce
   * informuje app signálem po room WS – v DTO partie se nabídka NEVYSTAVUJE
   * (reconnection do rozehrané nabídky = todo 42).
   */
  drawOfferBy: string | null;
  /**
   * Session id hráče, který po DOHRANÉ partii nabídl ODVETU a čeká na odpověď
   * soupeře (fáze 77), nebo `null`. Analogie {@link drawOfferBy}, ale platí až po
   * konci partie (dokud běží, odveta nedává smysl). Přijetí → server založí NOVOU
   * partii s prohozenými barvami (viz app); odmítnutí / opuštění → zpět na `null`.
   */
  rematchOfferBy: string | null;
  /**
   * `true`, jakmile kdokoli z dvojice DOHRANOU partii opustil („Konec"/„Odveta",
   * fáze 77) a server tím uvolnil oba z busy. Pojistka proti DVOJÍMU uvolnění: druhé
   * `leave-game` na tutéž partii (opakovaný/podvržený) už busy neuvolní – jinak by
   * mohlo uvolnit hráče, který mezitím začal NOVOU partii (→ dvojité spárování).
   * Atomický check-and-set přes {@link GameStore.markPvpLeft} (Node jednovláknový).
   */
  left: boolean;
}
type StoredGame = EngineStoredGame | PvpStoredGame;

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

/**
 * Příčina VYNUCENÉHO konce partie (mimo pravidla): vzdání, nebo přijatá remíza.
 * Uloženo ve stavu partie vedle `forcedResult` (viz {@link GameRecordBase}).
 */
export type ForcedReason = 'resign' | 'draw-agreement';

/**
 * Drátový důvod konce partie z pohledu klienta (fáze 78). Vynucené příčiny
 * ({@link ForcedReason}) plus `'rules'` = terminální výsledek plynoucí čistě z
 * pozice (soupeř bez tahu / bez kamenů, nebo remíza podle pravidel – 40 tahů /
 * opakování). Rozdíl `'draw-agreement'` vs. `'rules'` odděluje dohodnutou remízu
 * od remízy podle pravidel; klient podle toho volí text.
 */
export type EndReason = ForcedReason | 'rules';

/**
 * Drátový důvod konce partie, nebo `null` když partie BĚŽÍ (fáze 78). Vazba na
 * efektivní výsledek je tvrdá: dokud je `ongoing`, důvod je `null` – nikdy se
 * nevrací zastaralý/predčasný důvod (stav partie chodí klientovi v každém
 * game-state, ale důvod má smysl jen u terminálního výsledku). Skončila-li
 * partie vynuceně, vrací `forcedReason`; jinak (konec z pozice) `'rules'`.
 */
export function endReason(game: {
  readonly forcedResult: GameResult | null;
  readonly forcedReason: ForcedReason | null;
  readonly state: GameState;
}): EndReason | null {
  if (effectiveResult(game) === 'ongoing') {
    return null;
  }
  return game.forcedReason ?? 'rules';
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
  private toRecord(id: string, game: EngineStoredGame): EngineGameRecord;
  private toRecord(id: string, game: PvpStoredGame): PvpGameRecord;
  private toRecord(id: string, game: StoredGame): GameRecord;
  private toRecord(id: string, game: StoredGame): GameRecord {
    const base: GameRecordBase = {
      id,
      state: game.state,
      engineStatus: game.engineStatus,
      moves: [...game.moves],
      archived: game.archived,
      forcedResult: game.forcedResult,
      forcedReason: game.forcedReason,
    };
    if (game.mode === 'pvp') {
      return { ...base, mode: 'pvp', players: game.players };
    }
    return {
      ...base,
      mode: 'engine',
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
  ): EngineGameRecord {
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
    const game: EngineStoredGame = {
      mode: 'engine',
      state: seeded?.state ?? initialGameState(),
      engineStatus: 'idle',
      moves: seeded?.moves ?? [],
      archived: false,
      forcedResult: null,
      forcedReason: null,
      level,
      ballotIndex: seeded?.index ?? null,
      humanColor,
    };
    this.games.set(id, game);
    return this.toRecord(id, game);
  }

  /**
   * Založí PvP partii dvou lidí (fáze 68). Bez enginu, bez úrovně i ballotu –
   * startuje z výchozího rozestavění (černý na tahu). Vyzyvatel (`challengerId`)
   * dostává ČERNOU a táhne první, vyzvaný (`challengedId`) bílou – rozhodnutí z
   * diskuse fáze 68, deterministické (žádný los). `players` váže barvu na session
   * id, což je substrát pro pozdější autoritu tahů (todo 36).
   *
   * V tomto řezu se partie NEHRAJE: engine-cesty ji odmítnou (viz app), tah/konec
   * PvP je todo 36/40. `id` se vrací volajícímu (párovací WS), aby ho poslal oběma.
   */
  createPvp(challengerId: string, challengedId: string): PvpGameRecord {
    const id = randomUUID();
    const game: PvpStoredGame = {
      mode: 'pvp',
      state: initialGameState(),
      engineStatus: 'idle',
      moves: [],
      archived: false,
      forcedResult: null,
      forcedReason: null,
      players: { black: challengerId, white: challengedId },
      drawOfferBy: null,
      rematchOfferBy: null,
      left: false,
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
    // Tah = implicitní odmítnutí visící nabídky remízy (fáze 77). Jen PvP partie
    // nabídku vede; u engine partie pole není. Bez tohoto by po tahu zůstala
    // stará nabídka „viset" a soupeř by ji mohl přijmout na už změněné pozici.
    if (game.mode === 'pvp') {
      game.drawOfferBy = null;
    }
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
  resign(id: string): EngineGameRecord | 'not-found' | 'already-over' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode === 'pvp') {
      // Nedosažitelné: vzdání PvP partie (todo 40) route odmítne dřív (pvp_not_playable).
      // Assertion proti tiché špatné větvi, ne běžná cesta – proto hlasitý throw.
      throw new Error(`resign: PvP partii ${id} nelze vzdát touto cestou (todo 40)`);
    }
    if (effectiveResult(game) !== 'ongoing') {
      return 'already-over';
    }
    game.forcedResult = opposite(game.humanColor) === 'white' ? 'white-wins' : 'black-wins';
    game.forcedReason = 'resign';
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
  acceptDraw(id: string): EngineGameRecord | 'not-found' | 'already-over' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode === 'pvp') {
      // Nedosažitelné: remíza v PvP partii (todo 40) route odmítne dřív (pvp_not_playable).
      throw new Error(`acceptDraw: PvP partii ${id} nelze remizovat touto cestou (todo 40)`);
    }
    if (effectiveResult(game) !== 'ongoing') {
      return 'already-over';
    }
    game.forcedResult = 'draw';
    game.forcedReason = 'draw-agreement';
    return this.toRecord(id, game);
  }

  /**
   * Vzdání v PvP partii (fáze 77). Vzdá se hráč `sessionId` → vyhrává SOUPEŘ.
   * Autorita: session musí být ÚČASTNÍK partie (`sessionId ∈ players`); barvu
   * vzdávajícího si server dopočte z `players`, klientovi ji nevěří. Výsledek =
   * barva soupeře: černý se vzdal → `white-wins`, bílý → `black-wins`. Provede se
   * JEN když je partie podle efektivního výsledku ještě rozehraná. Vzdání ruší
   * i případnou visící nabídku remízy (partie končí, nabídka ztrácí smysl).
   * Node je jednovláknový a mezi kontrolou a zápisem není `await` → atomický
   * check-and-set. Volání na engine partii je programová chyba volajícího (route
   * ji sem nepustí) → hlasitý throw, ne tichá špatná větev.
   *
   * Vrací nový záznam při úspěchu; `'not-found'` (partie neexistuje),
   * `'not-participant'` (session není hráč), `'already-over'` (už terminální).
   */
  resignPvp(
    id: string,
    sessionId: string,
  ): PvpGameRecord | 'not-found' | 'not-participant' | 'already-over' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode !== 'pvp') {
      throw new Error(`resignPvp: partie ${id} není PvP (mode=${game.mode})`);
    }
    const myColor = this.pvpColorOf(game, sessionId);
    if (myColor === null) {
      return 'not-participant';
    }
    if (effectiveResult(game) !== 'ongoing') {
      return 'already-over';
    }
    game.forcedResult = myColor === 'black' ? 'white-wins' : 'black-wins';
    game.forcedReason = 'resign';
    game.drawOfferBy = null;
    return this.toRecord(id, game);
  }

  /**
   * Nabídka remízy v PvP partii (fáze 77). Hráč `sessionId` (musí být účastník)
   * nabídne remízu – uloží se `drawOfferBy = sessionId`. STAV PRAVIDEL SE NEMĚNÍ,
   * partie běží dál; soupeře o nabídce informuje app signálem po room WS. Provede
   * se jen u rozehrané partie a jen když ŽÁDNÁ nabídka ještě nevisí (`'offer-exists'`
   * jinak) – druhá souběžná nabídka je odmítnuta, ať stav nabídky zůstává
   * jednoznačný (jedna visící nabídka, jeden nabízející). Pozn.: když už nabídku
   * podal soupeř, tenhle hráč má místo nové nabídky rovnou PŘIJMOUT
   * ({@link acceptDrawPvp}); dvě křížící se nabídky se vyřeší tak, že druhá dostane
   * `'offer-exists'` a UI ji navede na přijetí té první.
   *
   * Vrací nový záznam při úspěchu; `'not-found'`, `'not-participant'`,
   * `'already-over'`, nebo `'offer-exists'` (nabídka už visí).
   */
  offerDrawPvp(
    id: string,
    sessionId: string,
  ): PvpGameRecord | 'not-found' | 'not-participant' | 'already-over' | 'offer-exists' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode !== 'pvp') {
      throw new Error(`offerDrawPvp: partie ${id} není PvP (mode=${game.mode})`);
    }
    if (this.pvpColorOf(game, sessionId) === null) {
      return 'not-participant';
    }
    if (effectiveResult(game) !== 'ongoing') {
      return 'already-over';
    }
    if (game.drawOfferBy !== null) {
      return 'offer-exists';
    }
    game.drawOfferBy = sessionId;
    return this.toRecord(id, game);
  }

  /**
   * Přijetí nabídky remízy v PvP partii (fáze 77). Přijímá hráč `sessionId` –
   * musí být účastník, musí viset nabídka (`drawOfferBy !== null`) a NESMÍ ji být
   * on sám (vlastní nabídku nelze přijmout → `'no-offer'`). Na úspěch nastaví
   * `forcedResult = 'draw'`, nabídku zruší a vrátí terminální záznam (app rozešle
   * oběma přes game hub). Jen u rozehrané partie; atomický check-and-set.
   *
   * Vrací nový záznam; `'not-found'`, `'not-participant'`, `'already-over'`,
   * nebo `'no-offer'` (nic k přijetí – žádná nabídka, nebo je to nabídka vlastní).
   */
  acceptDrawPvp(
    id: string,
    sessionId: string,
  ): PvpGameRecord | 'not-found' | 'not-participant' | 'already-over' | 'no-offer' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode !== 'pvp') {
      throw new Error(`acceptDrawPvp: partie ${id} není PvP (mode=${game.mode})`);
    }
    if (this.pvpColorOf(game, sessionId) === null) {
      return 'not-participant';
    }
    if (effectiveResult(game) !== 'ongoing') {
      return 'already-over';
    }
    if (game.drawOfferBy === null || game.drawOfferBy === sessionId) {
      return 'no-offer';
    }
    game.forcedResult = 'draw';
    game.forcedReason = 'draw-agreement';
    game.drawOfferBy = null;
    return this.toRecord(id, game);
  }

  /**
   * Odmítnutí nabídky remízy v PvP partii (fáze 77). Odmítá hráč `sessionId` –
   * stejné podmínky jako {@link acceptDrawPvp} (účastník, visící nabídka NE od
   * něj). STAV PRAVIDEL SE NEMĚNÍ, partie běží dál; nabídka se jen zruší
   * (`drawOfferBy = null`) a app dá nabízejícímu vědět po room WS. Vrací nový
   * záznam; `'not-found'`, `'not-participant'`, `'already-over'`, nebo `'no-offer'`.
   */
  rejectDrawPvp(
    id: string,
    sessionId: string,
  ): PvpGameRecord | 'not-found' | 'not-participant' | 'already-over' | 'no-offer' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode !== 'pvp') {
      throw new Error(`rejectDrawPvp: partie ${id} není PvP (mode=${game.mode})`);
    }
    if (this.pvpColorOf(game, sessionId) === null) {
      return 'not-participant';
    }
    if (effectiveResult(game) !== 'ongoing') {
      return 'already-over';
    }
    if (game.drawOfferBy === null || game.drawOfferBy === sessionId) {
      return 'no-offer';
    }
    game.drawOfferBy = null;
    return this.toRecord(id, game);
  }

  /**
   * Označí DOHRANOU PvP partii za opuštěnou (fáze 77). Vrací `true`, JEN když se
   * příznak právě teď překlopil z false na true; `false` znamená „už opuštěná",
   * „není PvP" nebo „partie zmizela". Atomický check-and-set (Node jednovláknový,
   * mezi čtením a zápisem není `await`) – zaručuje, že uvolnění busy proběhne
   * nejvýš JEDNOU na partii. Autoritu „partie je terminální" a „volající je
   * účastník" hlídá app PŘED tímto voláním; tady jde jen o pojistku proti dvojímu
   * uvolnění (viz {@link PvpStoredGame.left}).
   */
  markPvpLeft(id: string): boolean {
    const game = this.games.get(id);
    if (game?.mode !== 'pvp') {
      return false; // chybí, nebo to není PvP partie
    }
    if (game.left) {
      return false;
    }
    game.left = true;
    return true;
  }

  /**
   * Nabídka ODVETY po dohrané partii (fáze 77). Účastník `sessionId` nabídne odvetu –
   * uloží se `rematchOfferBy`. Zrcadlí {@link offerDrawPvp}, ale gate je OPAČNÝ: partie
   * musí být TERMINÁLNÍ (za běhu odveta nedává smysl → `'not-over'`). Druhá nabídka
   * naráz → `'offer-exists'`. Stav partie se nemění; soupeře uvědomí app signálem.
   *
   * Vrací záznam; `'not-found'`, `'not-participant'`, `'not-over'`, `'offer-exists'`.
   */
  offerRematchPvp(
    id: string,
    sessionId: string,
  ): PvpGameRecord | 'not-found' | 'not-participant' | 'not-over' | 'gone' | 'offer-exists' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode !== 'pvp') {
      throw new Error(`offerRematchPvp: partie ${id} není PvP (mode=${game.mode})`);
    }
    if (this.pvpColorOf(game, sessionId) === null) {
      return 'not-participant';
    }
    if (effectiveResult(game) === 'ongoing') {
      return 'not-over';
    }
    if (game.left) {
      return 'gone';
    }
    if (game.rematchOfferBy !== null) {
      return 'offer-exists';
    }
    game.rematchOfferBy = sessionId;
    return this.toRecord(id, game);
  }

  /**
   * Přijetí nabídky odvety (fáze 77). Přijímá účastník `sessionId` – musí viset
   * nabídka NE od něj (`'no-offer'` jinak). Na úspěch nabídku zruší a vrátí záznam
   * DOHRANÉ partie (app z jeho `players` založí novou partii s prohozenými barvami).
   * Založení nové hry ani prohození barev NEdělá store – to je app (potřebuje o tom
   * uvědomit oba hráče). Gate: TERMINÁLNÍ partie.
   *
   * Vrací záznam; `'not-found'`, `'not-participant'`, `'not-over'`, `'no-offer'`.
   */
  acceptRematchPvp(
    id: string,
    sessionId: string,
  ): PvpGameRecord | 'not-found' | 'not-participant' | 'not-over' | 'gone' | 'no-offer' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode !== 'pvp') {
      throw new Error(`acceptRematchPvp: partie ${id} není PvP (mode=${game.mode})`);
    }
    if (this.pvpColorOf(game, sessionId) === null) {
      return 'not-participant';
    }
    if (effectiveResult(game) === 'ongoing') {
      return 'not-over';
    }
    // Jakmile kdokoli partii OPUSTIL (leave-game → busy uvolněno), odveta na ní je
    // MRTVÁ. Bez tohohle gate by přijetí založilo novou partii, ve které NIKDO není
    // busy (busy se drží z původního spárování, ale to už bylo uvolněno) → dvojité
    // spárování. Autorita: server nesmí věřit klientovi, že modal ještě „žije".
    if (game.left) {
      return 'gone';
    }
    if (game.rematchOfferBy === null || game.rematchOfferBy === sessionId) {
      return 'no-offer';
    }
    game.rematchOfferBy = null;
    return this.toRecord(id, game);
  }

  /**
   * Odmítnutí nabídky odvety (fáze 77). Odmítá účastník `sessionId` (stejné podmínky
   * jako {@link acceptRematchPvp}); nabídka se jen zruší, partie zůstává dohraná. App
   * dá nabízejícímu vědět signálem. Vrací záznam; `'not-found'`, `'not-participant'`,
   * `'not-over'`, `'no-offer'`.
   */
  declineRematchPvp(
    id: string,
    sessionId: string,
  ): PvpGameRecord | 'not-found' | 'not-participant' | 'not-over' | 'gone' | 'no-offer' {
    const game = this.games.get(id);
    if (game === undefined) {
      return 'not-found';
    }
    if (game.mode !== 'pvp') {
      throw new Error(`declineRematchPvp: partie ${id} není PvP (mode=${game.mode})`);
    }
    if (this.pvpColorOf(game, sessionId) === null) {
      return 'not-participant';
    }
    if (effectiveResult(game) === 'ongoing') {
      return 'not-over';
    }
    if (game.left) {
      return 'gone';
    }
    if (game.rematchOfferBy === null || game.rematchOfferBy === sessionId) {
      return 'no-offer';
    }
    game.rematchOfferBy = null;
    return this.toRecord(id, game);
  }

  /**
   * Barva účastníka PvP partie podle session id, nebo `null` když session není
   * ani jeden z hráčů. Server si barvu VŽDY dopočítává z `players` (ne z klienta) –
   * jediné místo pravdy o tom, „kdo je v téhle partii kdo".
   */
  private pvpColorOf(game: PvpStoredGame, sessionId: string): Color | null {
    if (game.players.black === sessionId) {
      return 'black';
    }
    if (game.players.white === sessionId) {
      return 'white';
    }
    return null;
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

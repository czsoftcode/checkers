/**
 * In-memory úložiště rozehraných partií. Jeden proces, žádná perzistence –
 * vědomé rozhodnutí v1 (partie žijí v paměti serveru, DB se nepřidává).
 *
 * Po odstranění serverové AI (fáze 90) drží store JEN partie dvou lidí (PvP);
 * engine partie ani jejich stav tahu na pozadí (`engineStatus`) už neexistují –
 * AI běží celá v prohlížeči (`@checkers/ai`), server je autorita jen nad PvP.
 */

import { randomUUID } from 'node:crypto';
import { advanceState, gameResultFromState, initialGameState } from '@checkers/rules';
import type { Color, GameResult, GameState, Move } from '@checkers/rules';

/**
 * Opačná barva. Čistá funkce (`Color` je jen `'black' | 'white'`), ne do
 * `rules`: je to serverová utilita autority, ne pravidlo hry.
 */
export function opposite(color: Color): Color {
  return color === 'black' ? 'white' : 'black';
}

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

/** Společná část záznamu partie. */
interface GameRecordBase {
  readonly id: string;
  readonly state: GameState;
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
 * Partie DVOU LIDÍ (PvP). Bez enginu, bez úrovně i ballotu – startuje z výchozího
 * rozestavění (černý na tahu). `players` váže barvu na session id hráče. Po
 * odstranění serverové AI (fáze 90) je to JEDINÝ druh partie, který store drží;
 * diskriminátor `mode: 'pvp'` zůstává na drátě (DTO), ať web pozná PvP stav od
 * své lokální engine kopie – interně už ale žádná druhá varianta není.
 */
export interface PvpGameRecord extends GameRecordBase {
  readonly mode: 'pvp';
  readonly players: PvpPlayers;
}

/** Záznam partie. Po sesypání engine větve (fáze 91) je vždy PvP. */
export type GameRecord = PvpGameRecord;

interface StoredGameBase {
  state: GameState;
  moves: Move[];
  archived: boolean;
  forcedResult: GameResult | null;
  /** Příčina vynuceného konce (fáze 78); `null` dokud výsledek nevznikl vynuceně. */
  forcedReason: ForcedReason | null;
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
type StoredGame = PvpStoredGame;

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
   * Snímek uloženého stavu do neměnného záznamu. `moves` se KOPÍRUJE, ne sdílí:
   * bez kopie by `record.moves` byl živý odkaz na pole, které store dál mutuje –
   * archivace by pak mohla vzít jiný seznam tahů, než jaký v partii byl v okamžiku
   * jejího konce. Move je readonly, stačí mělká kopie pole.
   */
  private toRecord(id: string, game: StoredGame): GameRecord {
    return {
      id,
      state: game.state,
      moves: [...game.moves],
      archived: game.archived,
      forcedResult: game.forcedResult,
      forcedReason: game.forcedReason,
      mode: 'pvp',
      players: game.players,
    };
  }

  /**
   * Založí PvP partii dvou lidí (fáze 68). Bez enginu, bez úrovně i ballotu –
   * startuje z výchozího rozestavění (černý na tahu). Vyzyvatel (`challengerId`)
   * dostává ČERNOU a táhne první, vyzvaný (`challengedId`) bílou – rozhodnutí z
   * diskuse fáze 68, deterministické (žádný los). `players` váže barvu na session
   * id, což je substrát pro autoritu tahů. `id` se vrací volajícímu (párovací WS),
   * aby ho poslal oběma.
   */
  createPvp(challengerId: string, challengedId: string): PvpGameRecord {
    const id = randomUUID();
    const game: PvpStoredGame = {
      mode: 'pvp',
      state: initialGameState(),
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
    // Tah = implicitní odmítnutí visící nabídky remízy (fáze 77). Bez tohoto by
    // po tahu zůstala stará nabídka „viset" a soupeř by ji mohl přijmout na už
    // změněné pozici.
    game.drawOfferBy = null;
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
   * check-and-set.
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
   * příznak právě teď překlopil z false na true; `false` znamená „už opuštěná"
   * nebo „partie zmizela". Atomický check-and-set (Node jednovláknový,
   * mezi čtením a zápisem není `await`) – zaručuje, že uvolnění busy proběhne
   * nejvýš JEDNOU na partii. Autoritu „partie je terminální" a „volající je
   * účastník" hlídá app PŘED tímto voláním; tady jde jen o pojistku proti dvojímu
   * uvolnění (viz {@link PvpStoredGame.left}).
   */
  markPvpLeft(id: string): boolean {
    const game = this.games.get(id);
    if (game === undefined) {
      return false;
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
}

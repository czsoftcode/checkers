/**
 * Serializace stavu partie do tvaru pro drát + hledání legálního tahu.
 *
 * Čisté funkce bez I/O – jádro autority serveru staví výhradně na `rules`,
 * žádná vlastní pravidla se tu neopakují. `MoveDto`/`GameDto` jsou kontrakt,
 * na který se navěsí web klient (M5), proto ho fixují testy.
 */

import { legalMoves } from '@checkers/rules';
import type { Color, GameResult, GameState, Move, Position, Square } from '@checkers/rules';
import type { GameLevel } from '@checkers/ai';
import type { EndReason, EngineStatus } from './store.js';

/** Tah ve tvaru pro drát: prostá, JSON-serializovatelná data (čísla 1–32). */
export interface MoveDto {
  readonly from: number;
  readonly path: number[];
  readonly captures: number[];
}

/**
 * Stav partie ČLOVĚK vs. ENGINE ve tvaru pro drát (odpověď GET /games/:id i
 * POST /moves). `engineStatus` je serverová informace o tahu enginu na pozadí –
 * klient (M5) podle ní pozná při pollingu, jestli engine přemýšlí / selhal.
 * Diskriminátor `mode: 'engine'` odděluje tento tvar od {@link PvpGameDto} (dva
 * lidé, bez enginu/úrovně/ballotu) – klient nejdřív zúží přes `mode`, teprve pak
 * čte engine-specifická pole.
 */
export interface GameDto {
  readonly mode: 'engine';
  readonly id: string;
  readonly position: Position;
  readonly result: GameResult;
  readonly legalMoves: MoveDto[];
  readonly engineStatus: EngineStatus;
  /**
   * Úroveň obtížnosti partie (fixní po celou partii). Vrací se, aby klient uměl
   * ukázat, proti čemu se HRAJE – nezávisle na tom, co je zrovna navolené v
   * přepínači (ten mění až další „Nová hra"). Autoritou o úrovni je server.
   */
  readonly level: GameLevel;
  /**
   * Index vylosovaného třítahového zahájení (3-move ballot) do decku
   * `THREE_MOVE_BALLOTS`, nebo `null` když partie žádné vynucené zahájení nemá.
   * Nenulový je jen u úrovně Mistrovství. Klient ho zatím nemusí zobrazovat
   * (název zahájení je věc pozdější UI fáze); je v kontraktu, ať ho pak umí
   * ukázat bez změny drátu.
   */
  readonly ballotIndex: number | null;
  /**
   * Tři vynucené půltahy vylosovaného zahájení (3-move ballot) v drátovém tvaru,
   * nebo `null` když partie žádné vynucené zahájení nemá. Jsou to reálné tahy,
   * které server při zakládání nasadil (první tři položky historie) – klient je
   * na startu partie jednou vizuálně přehraje (animace ballotu, úroveň
   * Mistrovství). Zdroj pravdy o TĚCH tazích je server; klient si je z indexu
   * nedopočítává. Nenulové je jen u Mistrovství, kde `ballotIndex !== null`.
   */
  readonly ballotMoves: MoveDto[] | null;
  /**
   * Barva ČLOVĚKA v této partii (fáze 50). Engine hraje druhou stranu. Klient z
   * ní ve fázi 51 zorientuje desku (člověk vždy dole) a rozhodne, čí je tah.
   * Výchozí `'black'` = dnešek (člověk černý, engine bílý); partie bez volby ho
   * mají také `'black'`. Autoritou o barvě je server.
   */
  readonly humanColor: Color;
}

/**
 * Stav partie DVOU LIDÍ (PvP, V3) ve tvaru pro drát. Oproti {@link GameDto} bez
 * engine-specifických polí (`engineStatus`/`level`/`ballotIndex`/`ballotMoves`/
 * `humanColor`) – ta pro partii bez enginu nemají smysl, a tak se nesmí objevit
 * (ne falešně `null`). Klient si svou barvu drží z `challenge-accepted`, takže
 * do stavu nepatří ani session id hráčů (jsou navíc veřejná přes roster). Kdo je
 * na tahu, plyne z `position.turn`.
 */
export interface PvpGameDto {
  readonly mode: 'pvp';
  readonly id: string;
  readonly position: Position;
  readonly result: GameResult;
  readonly legalMoves: MoveDto[];
  /**
   * Důvod konce partie z pohledu klienta (fáze 78): `'resign'` (soupeř se vzdal),
   * `'draw-agreement'` (dohodnutá remíza), `'rules'` (konec podle pravidel), nebo
   * `null` dokud partie BĚŽÍ. Váže se na `result`: kdykoli je `result !== 'ongoing'`,
   * je `reason` neprázdný a naopak. Klient podle něj u výsledku ukáže, PROČ hra
   * skončila (aby výherce po vzdání soupeře neviděl jen „Vyhrál jsi!").
   */
  readonly reason: EndReason | null;
}

/** Stav partie na drátě: engine, nebo PvP. Diskriminátor `mode` je zdroj pravdy. */
export type AnyGameDto = GameDto | PvpGameDto;

/**
 * Zpráva pushnutá přes WebSocket odběratelům partie (fáze 66). Obálka s
 * diskriminátorem `type` je kontrakt server↔klient pro celé V3: nechá místo pro
 * pozdější typy zpráv (presence/místnost, výzvy) bez rozbití. `game` je TÝŽ
 * DTO jako v REST odpovědích – žádný nový tvar stavu, klient parsuje jednu
 * strukturu, jen ji zúží přes `game.mode` (engine vs. PvP). Zatím jediný typ je
 * `game-state`; až přibude druhý, tohle se rozšíří na diskriminovanou unii.
 */
export interface GameStateMessage {
  readonly type: 'game-state';
  readonly game: AnyGameDto;
}

/** Přepis `Move` z `rules` do drátového tvaru (kopie polí, ne readonly odkaz). */
export function moveToDto(move: Move): MoveDto {
  return { from: move.from, path: [...move.path], captures: [...move.captures] };
}

/** Seznam legálních tahů dané pozice v drátovém tvaru. */
export function legalMoveDtos(position: Position): MoveDto[] {
  return legalMoves(position).map(moveToDto);
}

/**
 * Celý stav partie v drátovém tvaru. `result` se PŘEDÁVÁ zvenčí (efektivní
 * výsledek = vynucený vzdáním, jinak z pozice) – DTO ho už samo neodvozuje,
 * jinak by nevidělo vzdání (to stav pravidel nemění). Volající si ho spočítá
 * přes `effectiveResult`. `engineStatus` i `result` jsou POVINNÉ (ne default) –
 * ať kompilátor chytí volání, které je zapomene předat a tiše hlásí `idle` /
 * odvozený výsledek místo skutečného.
 */
export function gameToDto(
  id: string,
  state: GameState,
  engineStatus: EngineStatus,
  result: GameResult,
  level: GameLevel,
  ballotIndex: number | null,
  ballotMoves: MoveDto[] | null,
  humanColor: Color,
): GameDto {
  return {
    mode: 'engine',
    id,
    position: state.position,
    result,
    legalMoves: legalMoveDtos(state.position),
    engineStatus,
    level,
    ballotIndex,
    ballotMoves,
    humanColor,
  };
}

/**
 * Stav PvP partie v drátovém tvaru. `result` i `reason` se – stejně jako u
 * {@link gameToDto} – PŘEDÁVAJÍ zvenčí (efektivní výsledek přes `effectiveResult`,
 * důvod přes `endReason`), DTO je neodvozuje. Volající je počítá ze stejného
 * záznamu, takže `result`/`reason` zůstávají v páru (oba terminální, nebo oba
 * „běží"). Kdo je na tahu, klient čte z `position.turn`; server je autorita nad
 * legalitou (`legalMoves`).
 */
export function pvpGameToDto(
  id: string,
  state: GameState,
  result: GameResult,
  reason: EndReason | null,
): PvpGameDto {
  return {
    mode: 'pvp',
    id,
    position: state.position,
    result,
    legalMoves: legalMoveDtos(state.position),
    reason,
  };
}

/**
 * Najde legální tah odpovídající zadání klienta (výchozí pole + cesta dopadů).
 * Shoda = stejné `from` a hluboká shoda CELÉHO pole `path` v pořadí. `captures`
 * se z klienta zásadně nečte – server si braní odvodí z generátoru (autorita).
 *
 * Vrací `undefined`, když žádný legální tah nesedí. Tím se bez jediné vlastní
 * kontroly pokryje i „nejsi na tahu" (tahy druhé strany v seznamu nejsou) a
 * povinné braní (prostý tah v seznamu není, když je braní povinné).
 *
 * `path` SMÍ obsahovat duplicity (kruhový vícenásobný skok dámy může dopadnout
 * na už navštívené pole i zpět na `from`), proto se porovnává prvek po prvku,
 * nikdy ne přes `Set`.
 */
export function findLegalMove(
  position: Position,
  from: number,
  path: readonly number[],
): Move | undefined {
  return legalMoves(position).find((move) => move.from === from && pathsEqual(move.path, path));
}

function pathsEqual(a: readonly Square[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Serializace stavu partie do tvaru pro drát + hledání legálního tahu.
 *
 * Čisté funkce bez I/O – jádro autority serveru staví výhradně na `rules`,
 * žádná vlastní pravidla se tu neopakují. `MoveDto`/`PvpGameDto` jsou kontrakt,
 * na který se navěsí web klient, proto ho fixují testy.
 */

import { AMERICAN_RULESET, legalMoves, rulesetForVariant } from '@checkers/rules';
import type { GameResult, GameState, Move, Position, Ruleset, Square } from '@checkers/rules';
import type { EndReason } from './store.js';

/** Tah ve tvaru pro drát: prostá, JSON-serializovatelná data (čísla 1–32). */
export interface MoveDto {
  readonly from: number;
  readonly path: number[];
  readonly captures: number[];
}

/**
 * Stav partie DVOU LIDÍ (PvP) ve tvaru pro drát. Po odstranění serverové AI
 * (fáze 90) je to JEDINÝ stav, který server serializuje – engine partie neexistují.
 * Diskriminátor `mode: 'pvp'` zůstává na drátě, ať web pozná PvP stav od své
 * lokální engine kopie (`@checkers/ai` běží v prohlížeči). Klient si svou barvu
 * drží z `challenge-accepted`, takže do stavu nepatří session id hráčů (jsou navíc
 * veřejná přes roster). Kdo je na tahu, plyne z `position.turn`.
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

/**
 * Zpráva pushnutá přes WebSocket odběratelům partie (fáze 66). Obálka s
 * diskriminátorem `type` je kontrakt server↔klient pro celé V3: nechá místo pro
 * pozdější typy zpráv (presence/místnost, výzvy) bez rozbití. `game` je TÝŽ
 * DTO jako v REST odpovědích – žádný nový tvar stavu. Po odstranění serverové AI
 * (fáze 90) je to vždy {@link PvpGameDto}; diskriminátor `mode` na drátě zůstává,
 * ať web pozná PvP stav od své lokální engine kopie. Zatím jediný typ zprávy je
 * `game-state`; až přibude druhý, tohle se rozšíří na diskriminovanou unii.
 */
export interface GameStateMessage {
  readonly type: 'game-state';
  readonly game: PvpGameDto;
}

/** Přepis `Move` z `rules` do drátového tvaru (kopie polí, ne readonly odkaz). */
export function moveToDto(move: Move): MoveDto {
  return { from: move.from, path: [...move.path], captures: [...move.captures] };
}

/**
 * Seznam legálních tahů dané pozice v drátovém tvaru. `ruleset` MUSÍ odpovídat
 * variantě partie (viz {@link findLegalMove}) – default american je jen pro
 * volající bez varianty (dosavadní testy). Server ho odvozuje z `state.variant`.
 */
export function legalMoveDtos(position: Position, ruleset: Ruleset = AMERICAN_RULESET): MoveDto[] {
  return legalMoves(position, ruleset).map(moveToDto);
}

/**
 * Stav PvP partie v drátovém tvaru. `result` i `reason` se PŘEDÁVAJÍ zvenčí
 * (efektivní výsledek přes `effectiveResult`, důvod přes `endReason`), DTO je
 * neodvozuje. Volající je počítá ze stejného záznamu, takže `result`/`reason`
 * zůstávají v páru (oba terminální, nebo oba „běží"). Kdo je na tahu, klient čte
 * z `position.turn`; server je autorita nad legalitou (`legalMoves`).
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
    // Ruleset z varianty STAVU – jinak by DTO ruské/české partie nabídlo americké
    // (krátká dáma) legální tahy a autorita by tiše hrála jinou hru.
    legalMoves: legalMoveDtos(state.position, rulesetForVariant(state.variant)),
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
 *
 * BEZPEČNOSTNÍ HRANICE (uzavírá todo 56): `ruleset` MUSÍ být ruleset varianty
 * záznamu (server ho bere z `record.state.variant` → `rulesetForVariant`). Bez
 * toho by se legalita ověřovala americkými pravidly i pro ruskou/českou/pool
 * partii – server (jediná autorita) by pak přijal nelegální tah v dané variantě
 * (klient je nedůvěryhodný). Default american je jen pro volající bez varianty
 * (dosavadní testy jádra), NE pro autoritativní cestu.
 */
export function findLegalMove(
  position: Position,
  from: number,
  path: readonly number[],
  ruleset: Ruleset = AMERICAN_RULESET,
): Move | undefined {
  return legalMoves(position, ruleset).find(
    (move) => move.from === from && pathsEqual(move.path, path),
  );
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

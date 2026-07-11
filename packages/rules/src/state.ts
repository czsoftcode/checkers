/**
 * Stav partie – vrstva NAD jednou pozicí, podklad remízových pravidel.
 *
 * Remízy (80 půltahů bez pokroku, trojí opakování) nejdou poznat z jedné
 * pozice: potřebují čítač a historii napříč tahy. Tuhle paměť drží
 * `GameState`; server i CLI ho posouvají výhradně přes `advanceState`.
 *
 * „Pokrok" = braní NEBO tah mužem (proměna je tah muže). Po pokroku se
 * dřívější pozice už nikdy nemůže vrátit (kámen zmizel z desky / muž jde
 * jen vpřed), takže historie opakování se při něm celá zahazuje – zůstává
 * krátká a opakování „přes" pokrok se nikdy nezapočítá.
 */

import { applyMove } from './apply.js';
import { BOARD_SQUARES } from './board.js';
import { cellAt } from './moves.js';
import { initialPosition } from './position.js';
import type { Cell, Move, Position } from './types.js';
import { rulesetForVariant } from './variant.js';
import type { VariantId } from './variant.js';

/**
 * Remízový limit: 80 půltahů (40 tahů každé strany) bez braní a bez tahu
 * mužem. Pevná konstanta knihovny – rozhodnutí z diskuse fáze 8.
 */
export const MAX_PLIES_WITHOUT_PROGRESS = 80;

/** Jeden znak na pole: '.' prázdno, m/k černý muž/dáma, M/K bílý muž/dáma. */
function cellCode(cell: Cell, square: number): string {
  if (cell === null) {
    return '.';
  }
  // Buňka mimo typ (undefined z díry v poli, cizí color/kind) by se tiše
  // serializovala jako platný kámen a dvě RŮZNĚ poškozené desky by mohly
  // dostat STEJNÝ klíč – přesně ta korupce detekce, kterou klíč nesmí dopustit.
  if (
    (cell.color !== 'black' && cell.color !== 'white') ||
    (cell.kind !== 'man' && cell.kind !== 'king')
  ) {
    throw new RangeError(`Poškozená pozice: neznámý kámen na poli ${String(square)}`);
  }
  const code = cell.kind === 'man' ? 'm' : 'k';
  return cell.color === 'black' ? code : code.toUpperCase();
}

/**
 * Deterministický textový klíč pozice: strana na tahu + obsah všech 32 polí.
 * Žádný hash – bez rizika kolizí. V americké dámě pozice + strana na tahu
 * plně určuje legální tahy (nic jako rošáda/en passant), klíč je kompletní.
 * Poškozenou pozici (délka, strana na tahu, díra v poli, nesmyslná buňka)
 * odmítá RangeError – klíč z ní by tiše kazil detekci.
 */
export function positionKey(position: Position): string {
  if (position.board.length !== BOARD_SQUARES) {
    throw new RangeError(
      `Poškozená pozice: board má ${String(position.board.length)} polí místo ${String(BOARD_SQUARES)}`,
    );
  }
  if (position.turn !== 'black' && position.turn !== 'white') {
    throw new RangeError(`Poškozená pozice: neznámá strana na tahu ${String(position.turn)}`);
  }
  let cells = '';
  for (let i = 0; i < BOARD_SQUARES; i++) {
    const cell = position.board[i];
    if (cell === undefined) {
      throw new RangeError(`Poškozená pozice: díra v board na poli ${String(i + 1)}`);
    }
    cells += cellCode(cell, i + 1);
  }
  return `${position.turn}:${cells}`;
}

/**
 * Stav partie. Immutable stejně jako `Position` – `advanceState` vrací
 * nový stav, vstup se nemutuje.
 */
export interface GameState {
  readonly position: Position;
  /**
   * Varianta partie (id). Určuje ruleset, který `advanceState`/`gameResultFromState`
   * použijí pro `applyMove`/`legalMoves` – POLE stavu, ne parametr, právě proto,
   * že `applyMove` pro ruskou/pool potřebuje ruleset (mid-capture promotion mění
   * výsledek). Sebe-popisný stav vylučuje footgun „americká pravidla na ruskou
   * partii". `positionKey`/Zobrist ho NEBEROU (varianta není v hashi – opakování
   * v rámci partie je stejnovariantní).
   */
  readonly variant: VariantId;
  /** Počet půltahů od posledního pokroku (braní / tah mužem). */
  readonly pliesWithoutProgress: number;
  /**
   * Klíče pozic od posledního pokroku VČETNĚ aktuální (poslední prvek).
   * Slouží jen detekci trojího opakování – při pokroku se zahazuje.
   */
  readonly repetitionHistory: readonly string[];
}

/**
 * Výchozí stav partie: čítač 0, pozice je 1. výskyt ve své historii. `variant`
 * je 'american' jako default – volající, který variantu neřeší (server store,
 * CLI, dosavadní testy), dostane přesně dnešní chování.
 */
export function initialGameState(
  position: Position = initialPosition(),
  variant: VariantId = 'american',
): GameState {
  return {
    position,
    variant,
    pliesWithoutProgress: 0,
    repetitionHistory: [positionKey(position)],
  };
}

/**
 * Aplikuje tah a posune stav partie: pokrok (braní / tah mužem) nuluje
 * čítač a zahazuje historii opakování; prostý tah dámou čítač zvedá o 1
 * a novou pozici přidává do historie.
 *
 * Validace tahu je zděděná z `applyMove` (struktura, RangeError) – a stejně
 * jako u něj NEjde o plnou legalitu: tah zvenčí musí projít bránou členství
 * v `legalMoves`, tady se jen posouvá stav.
 *
 * KONTRAKT: konzument vyhodnocuje `gameResultFromState` po KAŽDÉM půltahu.
 * Skončený stav se tu dál posunout DÁ (žádná chyba) a pokrok přitom nuluje
 * čítač i historii – remíza z čítače přejetá pokrokem je nenávratně pryč.
 * Opakování v rámci úseku bez pokroku dohledá `gameResultFromState` i zpětně.
 */
export function advanceState(state: GameState, move: Move): GameState {
  // Druh kamene se čte PŘED tahem (proměna = pořád tah muže). Je-li from
  // prázdné či mimo desku, cellAt/applyMove níže vyhodí RangeError.
  const fromCell = cellAt(state.position, move.from);
  // Ruleset z varianty STAVU – ruská/pool proměna uprostřed braní mění, co
  // applyMove vyrobí. Bez toho by se neamerická partie tiše posouvala americky.
  const next = applyMove(state.position, move, rulesetForVariant(state.variant));
  const progress = move.captures.length > 0 || fromCell?.kind === 'man';
  const key = positionKey(next);
  if (progress) {
    return {
      position: next,
      variant: state.variant,
      pliesWithoutProgress: 0,
      repetitionHistory: [key],
    };
  }
  return {
    position: next,
    variant: state.variant,
    pliesWithoutProgress: state.pliesWithoutProgress + 1,
    repetitionHistory: [...state.repetitionHistory, key],
  };
}

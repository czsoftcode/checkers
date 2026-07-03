/**
 * Herní smyčka bez terminálu: čistá funkce nad rules, žádné I/O.
 *
 * Smyčka je zároveň brána legality (stejný princip jako budoucí server):
 * tah od strategie se přijme, jen když je členem `legalMoves` – strategie
 * je nedůvěryhodná, i ta naše random.
 */

import {
  advanceState,
  formatMove,
  gameResultFromState,
  initialGameState,
  legalMoves,
} from '@checkers/rules';
import type { Color, GameResult, GameState, Move } from '@checkers/rules';

/**
 * Strategie hráče: dostane stav partie a seznam legálních tahů, vrátí
 * vybraný tah (případně asynchronně – člověk u terminálu). Seznam tahů
 * není nikdy prázdný – prázdný seznam znamená konec hry a smyčka ho
 * pozná dřív, než se strategie zeptá.
 */
export type Strategy = (state: GameState, moves: readonly Move[]) => Move | Promise<Move>;

/**
 * Tvrdý strop délky partie – pojistka proti chybě v pravidlech, ne herní
 * pravidlo. Matematická mez je řádově nižší: pokroků (braní / tah mužem)
 * je nejvýš ~200 na partii a mezi dvěma pokroky ukončí remízové pravidlo
 * partii po 80 půltazích, tj. < 200 × 81 ≈ 16 200 půltahů. Přetečení
 * stropu proto znamená rozbitou terminaci a je to chyba (throw), ne remíza.
 */
export const MAX_GAME_PLIES = 20_000;

/** Jeden odehraný půltah – podklad pro průběžný výpis. */
export interface PlayedPly {
  /** Pořadí půltahu od 1. */
  readonly ply: number;
  /** Kdo táhl. */
  readonly color: Color;
  readonly move: Move;
  /** PDN zápis tahu. */
  readonly pdn: string;
  /** Stav PO tahu. */
  readonly state: GameState;
}

/** Výsledek dohrané partie. */
export interface PlayedGame {
  readonly result: Exclude<GameResult, 'ongoing'>;
  /** PDN zápisy všech půltahů v pořadí. */
  readonly pdnMoves: readonly string[];
  readonly finalState: GameState;
}

/**
 * Odehraje celou partii z výchozí pozice. Černý táhne první (pravidlo
 * americké dámy). Výsledek se vyhodnocuje po každém půltahu
 * (kontrakt `advanceState`/`gameResultFromState`).
 *
 * Nelegální tah od strategie je chyba volajícího – smyčka ji nepolyká,
 * vyhazuje Error. Interaktivní režim proto validuje vstup člověka dřív,
 * než ho sem pustí.
 */
export async function playGame(
  black: Strategy,
  white: Strategy,
  onPly?: (played: PlayedPly) => void,
): Promise<PlayedGame> {
  let state = initialGameState();
  const pdnMoves: string[] = [];
  let result = gameResultFromState(state);
  while (result === 'ongoing') {
    if (pdnMoves.length >= MAX_GAME_PLIES) {
      throw new Error(
        `Partie nedosáhla konce ani po ${String(MAX_GAME_PLIES)} půltazích – rozbitá terminace pravidel`,
      );
    }
    const moves = legalMoves(state.position);
    const color = state.position.turn;
    const strategy = color === 'black' ? black : white;
    const chosen = await strategy(state, moves);
    // formatMove je pro legální tah kanonický (from + path určuje tah
    // jednoznačně), takže rovnost PDN textů = rovnost tahů. Strukturálně
    // nesmyslný tah odmítne rovnou formatMove (RangeError).
    const pdn = formatMove(chosen);
    if (!moves.some((move) => formatMove(move) === pdn)) {
      throw new Error(`Strategie hráče (${color}) vrátila nelegální tah ${pdn}`);
    }
    state = advanceState(state, chosen);
    pdnMoves.push(pdn);
    onPly?.({ ply: pdnMoves.length, color, move: chosen, pdn, state });
    result = gameResultFromState(state);
  }
  return { result, pdnMoves, finalState: state };
}

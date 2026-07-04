/**
 * Serializace stavu partie do tvaru pro drát + hledání legálního tahu.
 *
 * Čisté funkce bez I/O – jádro autority serveru staví výhradně na `rules`,
 * žádná vlastní pravidla se tu neopakují. `MoveDto`/`GameDto` jsou kontrakt,
 * na který se navěsí web klient (M5), proto ho fixují testy.
 */

import { gameResultFromState, legalMoves } from '@checkers/rules';
import type { GameResult, GameState, Move, Position, Square } from '@checkers/rules';

/** Tah ve tvaru pro drát: prostá, JSON-serializovatelná data (čísla 1–32). */
export interface MoveDto {
  readonly from: number;
  readonly path: number[];
  readonly captures: number[];
}

/** Stav partie ve tvaru pro drát (odpověď GET /games/:id i POST /moves). */
export interface GameDto {
  readonly id: string;
  readonly position: Position;
  readonly result: GameResult;
  readonly legalMoves: MoveDto[];
}

/** Přepis `Move` z `rules` do drátového tvaru (kopie polí, ne readonly odkaz). */
export function moveToDto(move: Move): MoveDto {
  return { from: move.from, path: [...move.path], captures: [...move.captures] };
}

/** Seznam legálních tahů dané pozice v drátovém tvaru. */
export function legalMoveDtos(position: Position): MoveDto[] {
  return legalMoves(position).map(moveToDto);
}

/** Celý stav partie v drátovém tvaru. Výsledek se čte ze STAVU (kvůli remízám). */
export function gameToDto(id: string, state: GameState): GameDto {
  return {
    id,
    position: state.position,
    result: gameResultFromState(state),
    legalMoves: legalMoveDtos(state.position),
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

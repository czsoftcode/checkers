/**
 * Aplikace tahu na pozici – referenční implementace, o kterou se později
 * opře server (autoritativní stav) i engine (prohledávání). Budoucí rychlá
 * varianta s undo se proti ní přibije testem ekvivalence.
 */

import { PROMOTION_ROW, isNeighbor, jumpedSquareBetween, raySquares, squareToCoords } from './board.js';
import { cellAt } from './moves.js';
import { AMERICAN_RULESET } from './ruleset.js';
import type { Ruleset } from './ruleset.js';
import type { Cell, Move, Position, Square } from './types.js';

/**
 * Aplikuje tah a vrátí NOVOU pozici (vstup se nemutuje): kámen se posune na
 * konec `path`, brané kameny zmizí, na tah jde soupeř. Muž končící na zadní
 * řadě soupeře se stává dámou; tah, který proměnu způsobil, se aplikuje
 * celý jako tah muže (proměna tah ukončuje – hlídá už generátor).
 *
 * Validuje se STRUKTURA tahu, při porušení RangeError (žádná tichá korupce):
 * na `from` kámen strany na tahu, geometrie kroků (prostý tah krátké figury =
 * 1 pole na souseda; prostý tah létavé dámy = paprsek diagonály s volnými
 * mezipoli; skok = dopad přes bezprostředně přeskakované pole, které musí
 * nést soupeřův kámen), volná pole dopadu v okamžiku dopadu (origin se
 * uvolňuje – kruhový návrat na `from` je legální), captures bez duplicit.
 *
 * `ruleset` řídí dosah prostého tahu i braní dámy (`king: 'flying'` → paprsek).
 * Létavá dáma bere KLOUZAVĚ: segment je paprsek diagonály s právě jedním
 * soupeřovým kamenem, dopad libovolné prázdné pole za ním. Turecký úder –
 * brané kameny drží na desce jako blokery po celou path a smažou se naráz na
 * konci (zrcadlo generátoru `extendFlyingKingJumps`). Default AMERICAN i krátká
 * dáma / muž validují skok dál jako krok o 2 pole (okamžité odebrání), beze změny.
 *
 * NEvaliduje se plná legalita (povinnost braní, směr muže, úplnost
 * sekvence) – tu si drží server členstvím v `legalMoves`; engine tahá tahy
 * z právě vygenerovaného seznamu. Vědomé rozhodnutí z diskuse fáze.
 *
 * DŮSLEDEK: strukturálně korektní nelegální tah projde a poškodí partii
 * pravidlově (ne datově) – např. „pokračování po proměně" {from: 21,
 * path: [30, 23], captures: [25, 26]} vyrobí na 23 MUŽE (proměna se
 * vyhodnocuje z finálního pole). Každý tah zvenčí MUSÍ projít bránou
 * členství v `legalMoves`; applyMove sám korupci pravidel nezastaví.
 */
export function applyMove(
  position: Position,
  move: Move,
  ruleset: Ruleset = AMERICAN_RULESET,
): Position {
  const fromCell = cellAt(position, move.from);
  if (fromCell === null) {
    throw new RangeError(`Na poli ${String(move.from)} nestojí žádný kámen`);
  }
  if (fromCell.color !== position.turn) {
    throw new RangeError(`Na poli ${String(move.from)} nestojí kámen strany na tahu`);
  }
  const { path, captures } = move;
  if (path.length === 0) {
    throw new RangeError('Neplatný tah: prázdná path');
  }
  if (captures.length === 0 && path.length !== 1) {
    throw new RangeError(`Neplatný tah: prostý tah musí mít 1 dopad, ne ${String(path.length)}`);
  }
  if (captures.length !== 0 && captures.length !== path.length) {
    throw new RangeError(
      `Neplatný tah: ${String(captures.length)} braní nesedí na ${String(path.length)} dopadů`,
    );
  }
  if (new Set(captures).size !== captures.length) {
    throw new RangeError('Neplatný tah: duplicitní pole v captures');
  }

  const board: Cell[] = [...position.board];
  board[move.from - 1] = null;

  const flyingKing = fromCell.kind === 'king' && ruleset.king === 'flying';
  // Brané kameny létavé dámy (turecký úder): drží se na desce jako blokery
  // po celou dobu path a smažou se naráz až po dokončení sekvence. Krátká
  // dáma / muž maže průběžně ve smyčce jako dřív – tento seznam zůstane prázdný.
  const capturedSquares: Square[] = [];
  let current = move.from;
  for (let i = 0; i < path.length; i++) {
    const landing = path[i];
    if (landing === undefined) {
      throw new RangeError('Neplatný tah: díra v path');
    }
    const landingCell = board[landing - 1];
    if (landingCell === undefined) {
      throw new RangeError(
        `Neplatný tah: pole ${String(landing)} není na desce (nebo je deska poškozená)`,
      );
    }
    if (landingCell !== null) {
      throw new RangeError(`Neplatný tah: pole dopadu ${String(landing)} je obsazené`);
    }
    if (captures.length === 0) {
      if (flyingKing) {
        // Létavá dáma: dopad musí ležet na diagonále z `current` a všechna
        // pole na cestě (mezipole i dopad) být prázdná. `landing` už je
        // ověřen jako prázdný výše; paprsek dokontroluje mezipole.
        const ray = raySquares(current, landing);
        if (ray === null) {
          throw new RangeError(
            `Neplatný tah: ${String(landing)} neleží na diagonále z ${String(current)} (teleport)`,
          );
        }
        for (const passed of ray) {
          if (board[passed - 1] !== null) {
            throw new RangeError(
              `Neplatný tah: dáma z ${String(current)} na ${String(landing)} přeskakuje obsazené pole ${String(passed)}`,
            );
          }
        }
      } else if (!isNeighbor(current, landing)) {
        throw new RangeError(
          `Neplatný tah: ${String(landing)} nesousedí s ${String(current)} (teleport)`,
        );
      }
    } else if (flyingKing) {
      // Létavá dáma – klouzavé braní (turecký úder). Segment current->landing
      // je paprsek diagonály, na němž smí ležet PRÁVĚ JEDEN obsazený kámen =
      // deklarovaný capture (soupeřův, v tomto tahu ještě nebraný). Ostatní
      // mezipole i landing musí být prázdná. Brané kameny se NEMAŽOU průběžně –
      // dřív braný (stále na desce) blokuje pozdější segment i dopad, čímž
      // padne pokus přejet ho podruhé. Skutečné mazání až po smyčce.
      const declaredCapture = captures[i];
      if (declaredCapture === undefined) {
        throw new RangeError('Neplatný tah: díra v captures');
      }
      const ray = raySquares(current, landing);
      if (ray === null) {
        throw new RangeError(
          `Neplatný tah: ${String(landing)} neleží na diagonále z ${String(current)} (teleport)`,
        );
      }
      let overSquare: Square | null = null;
      for (const passed of ray) {
        if (passed === landing) {
          continue; // landing už ověřen jako prázdný výše
        }
        const passedCell = board[passed - 1];
        if (passedCell === null || passedCell === undefined) {
          continue; // prázdné mezipole
        }
        if (overSquare !== null) {
          throw new RangeError(
            `Neplatný tah: segment z ${String(current)} na ${String(landing)} přeskakuje víc než jeden kámen`,
          );
        }
        overSquare = passed;
      }
      if (overSquare === null) {
        throw new RangeError(
          `Neplatný tah: segment z ${String(current)} na ${String(landing)} nebere žádný kámen`,
        );
      }
      if (overSquare !== declaredCapture) {
        throw new RangeError(
          `Neplatný tah: z ${String(current)} na ${String(landing)} se bere ${String(overSquare)}, ne deklarované ${String(declaredCapture)}`,
        );
      }
      const capturedCell = board[overSquare - 1];
      if (capturedCell === null || capturedCell === undefined) {
        throw new RangeError(`Neplatný tah: na braném poli ${String(overSquare)} nic nestojí`);
      }
      if (capturedCell.color === fromCell.color) {
        throw new RangeError(
          `Neplatný tah: na braném poli ${String(overSquare)} stojí vlastní kámen`,
        );
      }
      capturedSquares.push(overSquare);
    } else {
      const expectedCapture = jumpedSquareBetween(current, landing);
      const declaredCapture = captures[i];
      if (expectedCapture === null || expectedCapture !== declaredCapture) {
        throw new RangeError(
          `Neplatný tah: z ${String(current)} na ${String(landing)} se nepřeskakuje pole ${String(declaredCapture)}`,
        );
      }
      const capturedCell = board[expectedCapture - 1];
      if (capturedCell === null || capturedCell === undefined) {
        throw new RangeError(`Neplatný tah: na braném poli ${String(expectedCapture)} nic nestojí`);
      }
      if (capturedCell.color === fromCell.color) {
        throw new RangeError(
          `Neplatný tah: na braném poli ${String(expectedCapture)} stojí vlastní kámen`,
        );
      }
      board[expectedCapture - 1] = null;
    }
    current = landing;
  }

  // Turecký úder: brané kameny létavé dámy se odeberou naráz až po dokončení
  // celé path (během ní blokovaly jako překážky). Krátká cesta sem nic nedá.
  for (const captured of capturedSquares) {
    board[captured - 1] = null;
  }

  const promotes = fromCell.kind === 'man' && squareToCoords(current).row === PROMOTION_ROW[fromCell.color];
  board[current - 1] = promotes ? { color: fromCell.color, kind: 'king' } : fromCell;

  return { board, turn: position.turn === 'black' ? 'white' : 'black' };
}

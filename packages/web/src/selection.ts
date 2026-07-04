/**
 * Čistý model výběru a zvýraznění – žádný DOM.
 *
 * Jediným zdrojem legality je knihovna `rules`; klient nikdy sám nerozhoduje,
 * co je legální tah. Povinné braní se tím respektuje automaticky: když má strana
 * na tahu k dispozici skok, `legalMoves` prosté tahy vůbec nevrátí, takže se
 * ani nezvýrazní.
 *
 * Vícenásobný skok se doklikává po dopadech: model drží **předponu cesty**
 * (naklikaná pole dopadu, bez výchozího pole) a ptá se `rules`, které tahy touto
 * předponou začínají. Nikdy sám nepočítá „už není kam skočit“ – to plyne z toho,
 * že v americké dámě je každý skokový řetězec maximální, takže se předpona buď
 * rovná `path` právě jednoho tahu (hotovo), nebo z ní vede aspoň jeden další
 * dopad.
 */

import { legalMoves } from '@checkers/rules';
import type { Cell, Move, Position, Square } from '@checkers/rules';

/** Obsah pole `square` (1–32), nebo `null` mimo rozsah i pro prázdné pole. */
function cellAt(position: Position, square: Square): Cell {
  if (!Number.isInteger(square) || square < 1 || square > position.board.length) {
    return null;
  }
  return position.board[square - 1] ?? null;
}

/**
 * `true`, pokud na poli stojí kámen strany, která je na tahu (jen ten lze
 * vybrat). Prázdné pole, kámen soupeře i pole mimo desku vrací `false`.
 */
export function selectableAt(position: Position, square: Square): boolean {
  const cell = cellAt(position, square);
  return cell !== null && cell.color === position.turn;
}

/** `true`, pokud `path` začíná přesně poli z `prefix` (ve stejném pořadí). */
function pathStartsWith(path: readonly Square[], prefix: readonly Square[]): boolean {
  if (prefix.length > path.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Další možná pole dopadu z kamene `from` po naklikané předponě `prefix`
 * (dopady bez výchozího pole). Pro každý legální tah, jehož `path` začíná touto
 * předponou, se vezme pole na indexu `prefix.length` (tj. bezprostředně další
 * dopad). Duplicity se sloučí; větvení = víc různých polí.
 *
 * Prázdná předpona = první dopady všech tahů z `from` (výběr právě vybraného
 * kamene). Vrací prázdné pole, když z `from` po této předponě žádný legální tah
 * nepokračuje (včetně povinného braní jiným kamenem).
 */
export function nextTargets(position: Position, from: Square, prefix: readonly Square[]): Square[] {
  const targets: Square[] = [];
  for (const move of legalMoves(position)) {
    if (move.from !== from || !pathStartsWith(move.path, prefix)) {
      continue;
    }
    const next = move.path[prefix.length];
    if (next !== undefined && !targets.includes(next)) {
      targets.push(next);
    }
  }
  return targets;
}

/**
 * Kompletní legální tah, jehož `path` se přesně rovná naklikané předponě
 * (`from` + celá sekvence dopadů). Vrací `null`, když žádný takový tah není –
 * tj. předpona je zatím jen rozpracovaná (vede z ní další dopad) nebo neodpovídá
 * ničemu legálnímu. Kontroler dokončení pozná podle prázdného `nextTargets`;
 * tato funkce pak vydá konkrétní `Move` k provedení.
 */
export function resolveMove(position: Position, from: Square, prefix: readonly Square[]): Move | null {
  for (const move of legalMoves(position)) {
    if (move.from !== from || move.path.length !== prefix.length) {
      continue;
    }
    if (pathStartsWith(move.path, prefix)) {
      return move;
    }
  }
  return null;
}

/**
 * Cílová pole prvních dopadů legálních tahů z daného pole (předpona prázdná).
 * Tenká obálka nad {@link nextTargets} – zachována pro výběr kamene bez
 * rozpracované sekvence.
 */
export function targetsFor(position: Position, square: Square): Square[] {
  return nextTargets(position, square, []);
}

/**
 * PDN notace tahu: prostý tah `22-18`, skok s celou sekvencí dopadů
 * `26x17x10` (brané kameny se v PDN nezapisují – dopočítávají se
 * z geometrie skoků).
 *
 * Rozsah vědomě jen notace JEDNOHO tahu s PLNOU sekvencí dopadů:
 * zkrácený zápis skoku (`26x10` bez mezidopadů) jednoznačně rozbalit
 * nejde bez pozice a legalMoves – my PDN píšeme (export), nečteme cizí
 * soubory. Hlavičky a číslování celé partie patří k archivu (M5).
 *
 * Kontrakt stejný jako `applyMove`: ověřuje se STRUKTURA (geometrie
 * kroků), při porušení RangeError. Plnou legalitu (povinnost braní, směr
 * muže, obsazení polí) hlídá brána členství v `legalMoves` – zparsovaný
 * tah jí MUSÍ projít, notace desku vůbec nevidí.
 */

import { BOARD_SQUARES, isNeighbor, jumpedSquareBetween, raySquares } from './board.js';
import { AMERICAN_RULESET } from './ruleset.js';
import type { Ruleset } from './ruleset.js';
import type { Move, Square } from './types.js';

/**
 * Smí prostý tah `from → target` existovat? U `king: 'short'` jen na souseda
 * (americká dáma i muž). U `king: 'flying'` na libovolné pole na diagonále –
 * notace desku NEVIDÍ, takže NEkontroluje obsazení mezipolí (to hlídá
 * `applyMove` / brána `legalMoves`); relaxace je čistě STRUKTURÁLNÍ.
 */
function simpleReachable(from: Square, target: Square, ruleset: Ruleset): boolean {
  return ruleset.king === 'flying' ? raySquares(from, target) !== null : isNeighbor(from, target);
}

/**
 * Převede tah do PDN textu. Strukturálně nesmyslný tah (prázdná path,
 * prostý tah s více dopady, skok s captures neodpovídajícími geometrii)
 * odmítá RangeError – jinak by se nesmysl tiše „vypral": text by se zpátky
 * parsoval na JINÝ (korektní) tah a korupce by zmizela z dohledu.
 */
export function formatMove(move: Move, ruleset: Ruleset = AMERICAN_RULESET): string {
  if (move.path.length === 0) {
    throw new RangeError('Neplatný tah: prázdná path');
  }
  if (move.captures.length === 0) {
    if (move.path.length !== 1) {
      throw new RangeError(
        `Neplatný tah: prostý tah musí mít 1 dopad, ne ${String(move.path.length)}`,
      );
    }
    const target = move.path[0];
    if (target === undefined || !simpleReachable(move.from, target, ruleset)) {
      throw new RangeError(
        `Neplatný tah: ${String(target)} neleží na diagonále z ${String(move.from)} (teleport)`,
      );
    }
    return `${String(move.from)}-${String(target)}`;
  }
  if (move.captures.length !== move.path.length) {
    throw new RangeError(
      `Neplatný tah: ${String(move.captures.length)} braní nesedí na ${String(move.path.length)} dopadů`,
    );
  }
  if (new Set(move.captures).size !== move.captures.length) {
    throw new RangeError('Neplatný tah: duplicitní pole v captures');
  }
  let current = move.from;
  for (let i = 0; i < move.path.length; i++) {
    const landing = move.path[i];
    if (landing === undefined) {
      throw new RangeError('Neplatný tah: díra v path');
    }
    const jumped = jumpedSquareBetween(current, landing);
    if (jumped === null || jumped !== move.captures[i]) {
      throw new RangeError(
        `Neplatný tah: z ${String(current)} na ${String(landing)} se nepřeskakuje pole ${String(move.captures[i])}`,
      );
    }
    current = landing;
  }
  return [move.from, ...move.path].join('x');
}

/** Token pole: 1–2 číslice bez vedoucí nuly; rozsah 1–32 se hlídá zvlášť. */
const SQUARE_TOKEN = /^[1-9]\d?$/;

function parseSquare(token: string, text: string): Square {
  if (!SQUARE_TOKEN.test(token)) {
    throw new RangeError(`Neplatný PDN zápis „${text}": „${token}" není číslo pole`);
  }
  const square = Number(token);
  if (square > BOARD_SQUARES) {
    throw new RangeError(`Neplatný PDN zápis „${text}": pole ${token} je mimo 1–${String(BOARD_SQUARES)}`);
  }
  return square;
}

/**
 * Zparsuje PDN zápis tahu. Prostý tah = přesně 2 pole oddělená `-`;
 * skok = 2 a více polí oddělených `x`, brané kameny se dopočítají
 * z geometrie skoků. Nesmyslný zápis (cizí znaky, smíšené oddělovače,
 * pole mimo 1–32, nesousední prostý tah, krok bez skokové geometrie,
 * dvakrát přeskočené stejné pole) odmítá RangeError.
 */
export function parseMove(text: string, ruleset: Ruleset = AMERICAN_RULESET): Move {
  const hasDash = text.includes('-');
  const hasX = text.includes('x');
  if (hasDash && hasX) {
    throw new RangeError(`Neplatný PDN zápis „${text}": smíšené oddělovače - a x`);
  }
  if (!hasDash && !hasX) {
    throw new RangeError(`Neplatný PDN zápis „${text}": chybí oddělovač - nebo x`);
  }

  if (hasDash) {
    const tokens = text.split('-');
    if (tokens.length !== 2) {
      throw new RangeError(`Neplatný PDN zápis „${text}": prostý tah má přesně 2 pole`);
    }
    const [from, target] = tokens.map((token) => parseSquare(token, text)) as [Square, Square];
    if (!simpleReachable(from, target, ruleset)) {
      throw new RangeError(`Neplatný PDN zápis „${text}": pole neleží na diagonále`);
    }
    return { from, path: [target], captures: [] };
  }

  // split('x') na textu s 'x' vrací vždy aspoň 2 tokeny; prázdné tokeny
  // („x19", „22x") odmítne parseSquare.
  const tokens = text.split('x');
  const squares = tokens.map((token) => parseSquare(token, text));
  const [from, ...path] = squares as [Square, ...Square[]];
  const captures: Square[] = [];
  let current = from;
  for (const landing of path) {
    const jumped = jumpedSquareBetween(current, landing);
    if (jumped === null) {
      throw new RangeError(
        `Neplatný PDN zápis „${text}": z ${String(current)} na ${String(landing)} nevede skok`,
      );
    }
    captures.push(jumped);
    current = landing;
  }
  // Kontrakt typu Move: stejné pole nelze v sekvenci přeskočit dvakrát.
  if (new Set(captures).size !== captures.length) {
    throw new RangeError(`Neplatný PDN zápis „${text}": stejné pole přeskočené dvakrát`);
  }
  return { from, path, captures };
}

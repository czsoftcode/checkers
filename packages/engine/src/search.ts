/**
 * Search jádro: negamax s alfa-beta ořezáváním na PEVNOU hloubku.
 *
 * Vědomé limity v1 (přijdou v dalších fázích, ne opomenutí):
 * - žádná časová kontrola – hloubka je konstanta, doba tahu kolísá podle
 *   pozice (iterativní prohlubování + limity = fáze časové kontroly),
 * - žádná quiescence – na hranici hloubky hrozí horizont efekt,
 * - search NEVIDÍ remízová pravidla (čítač půltahů, opakování) – pracuje
 *   nad samotnou `Position`, protokol historii zatím nepřenáší.
 *
 * Terminál: strana na tahu bez legálního tahu prohrála (pat v americké
 * dámě neexistuje). Skóre výhry se snižuje o vzdálenost od kořene
 * (`WIN_SCORE - ply`), takže engine preferuje rychlejší výhru a pozdější
 * prohru – bez toho by mezi „mat hned" a „mat za 3 tahy" neuměl vybrat
 * a mohl výhru donekonečna odkládat.
 *
 * Kořen sbírá VŠECHNY tahy s nejlepším skóre (podklad pro tie-break
 * v handleru). Aby byly remízy přesné i s ořezáváním, hledá se každý další
 * tah s alfou `best - 1`: děti s hodnotou PŘESNĚ `best` tak padnou dovnitř
 * okna a vrátí přesné skóre, horší tahy se dál ořezávají. Stojí to na tom,
 * že všechna skóre jsou CELÁ čísla (viz evaluate.ts).
 */

import { applyMove, legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';

import { evaluate } from './evaluate.js';

/**
 * Skóre výhry v kořeni; skutečná hodnota v uzlu je `WIN_SCORE - ply`.
 * Řádově výš než součet materiálu (max ~12 × 130), aby se výhra nikdy
 * nepletla s poziční převahou.
 */
export const WIN_SCORE = 100_000;

/**
 * Pevná hloubka prohledávání pro protokolovou zprávu bestmove.
 * Kalibrace: viz měření ve fázi 14 – kompromis mezi silou a nejhorší
 * dobou tahu bez časové kontroly.
 */
export const SEARCH_DEPTH = 6;

/** Výsledek prohledání kořene. */
export interface SearchResult {
  /** Všechny tahy se shodným nejlepším skóre (aspoň jeden). */
  readonly bestMoves: readonly Move[];
  /** Skóre nejlepších tahů z pohledu strany na tahu. */
  readonly score: number;
}

/**
 * Prohledá pozici do hloubky `depth` a vrátí nejlepší tahy + skóre.
 *
 * `bestMoves` jsou vždy prvky `legalMoves(position)` – search jiné tahy
 * nevyrábí, jen vybírá z generátoru. Pozice bez legálního tahu je
 * programátorská chyba volajícího (handler ji odbavuje dřív jako
 * `no_legal_moves`) → RangeError, žádný tichý fallback.
 */
export function searchRoot(position: Position, depth: number): SearchResult {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new RangeError(`Neplatná hloubka prohledávání: ${String(depth)}`);
  }
  const moves = legalMoves(position);
  if (moves.length === 0) {
    throw new RangeError('searchRoot: pozice bez legálního tahu – partie už skončila');
  }

  let best = Number.NEGATIVE_INFINITY;
  let bestMoves: Move[] = [];
  for (const move of moves) {
    // Okno dítěte je (-beta, -alfa) s alfou kořene `best - 1` (viz hlavička).
    const rootAlpha = bestMoves.length === 0 ? Number.NEGATIVE_INFINITY : best - 1;
    const value = -negamax(applyMove(position, move), depth - 1, 1, Number.NEGATIVE_INFINITY, -rootAlpha);
    if (value > best) {
      best = value;
      bestMoves = [move];
    } else if (value === best) {
      bestMoves.push(move);
    }
  }
  // Negace v rekurzi umí vyrobit -0; navenek vracíme vždy +0, ať budoucí
  // konzument (server, telemetrie) nedostane falešný rozdíl v Object.is.
  return { bestMoves, score: best === 0 ? 0 : best };
}

/**
 * Negamax s alfa-beta (fail-soft): vrací skóre pozice z pohledu strany
 * na tahu, `ply` je vzdálenost od kořene (pro WIN_SCORE - ply).
 *
 * Tahy se generují i v hloubce 0 – dražší o legalMoves na listech, ale
 * prohra „bez tahu" na horizontu se pozná přesně místo tichého ohodnocení
 * prohrané pozice materiálem.
 */
function negamax(position: Position, depth: number, ply: number, alpha: number, beta: number): number {
  const moves = legalMoves(position);
  if (moves.length === 0) {
    return -(WIN_SCORE - ply);
  }
  if (depth === 0) {
    return evaluate(position);
  }

  let best = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    const value = -negamax(applyMove(position, move), depth - 1, ply + 1, -beta, -alpha);
    if (value > best) {
      best = value;
      if (value > alpha) {
        alpha = value;
      }
      if (alpha >= beta) {
        break;
      }
    }
  }
  return best;
}

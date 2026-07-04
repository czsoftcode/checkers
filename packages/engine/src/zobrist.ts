/**
 * Zobrist hash pozice pro transpoziční tabulku.
 *
 * Otisk je 53-bit celé číslo (bezpečný JS integer, `Number.MAX_SAFE_INTEGER
 * === 2^53 − 1`). Vědomé rozhodnutí (viz .mini/discuss/phase-017.md): 53 bitů
 * místo plných 64 (BigInt) – rychlé, bez alokace na horké cestě searche, za
 * cenu mizivé nenulové šance kolize klíče (~10⁻⁵ na dlouhém běhu). Pro hloubky
 * 5–6 přijatelné; kolizi KLÍČE nic neodhalí (na rozdíl od kolize kbelíku v TT,
 * kterou chytá ověření plného klíče při čtení).
 *
 * Reprezentace: JS bitové operátory (`^`) pracují jen na 32 bitech, 53-bit
 * XOR proto nejde přímo. Klíč se drží ve dvou polovinách – `hi` (21 bitů) a
 * `lo` (32 bitů) – které se XORují nezávisle (XOR je bitový, poloviny se
 * nepřelévají) a na konci složí `hi * 2^32 + lo`. Max = (2^21−1)·2^32 +
 * (2^32−1) = 2^53 − 1, tedy přesně MAX_SAFE_INTEGER: složený klíč je vždy
 * bezpečný integer.
 *
 * Hodnoty tabulky jsou deterministické (seedovaný mulberry32, žádný
 * Math.random) – jinak by nešly reprodukovat testy ani brána úbytku uzlů.
 * Hash žije JEN v enginu; `Position` ani balík `rules` se nemění.
 */

import { BOARD_SQUARES } from '@checkers/rules';
import type { Position } from '@checkers/rules';

import { mulberry32 } from './prng.js';

/** Pevný seed Zobrist tabulky (libovolná konstanta, jen ať je stabilní). */
export const ZOBRIST_SEED = 0x9e3779b1;

/** Typy kamene: black man=0, black king=1, white man=2, white king=3. */
const PIECE_TYPES = 4;

/** Dolní 32-bit poloviny náhodných hodnot (indexy `typ * 32 + pole`). */
const loTable = new Int32Array(PIECE_TYPES * BOARD_SQUARES);
/** Horní 21-bit poloviny náhodných hodnot. */
const hiTable = new Int32Array(PIECE_TYPES * BOARD_SQUARES);
/** Poloviny příznaku „na tahu je černý" (přimíchá se, když turn === black). */
let sideLo = 0;
let sideHi = 0;

// Naplnění tabulek jednou při načtení modulu (deterministicky ze seedu).
{
  const rng = mulberry32(ZOBRIST_SEED);
  // Int32Array přijme i hodnoty > 2^31 – wrapnou se na signed, bitový vzor
  // zůstane (XOR pracuje nad vzorem, znaménko nevadí; skládá se `>>> 0`).
  const rand32 = (): number => Math.floor(rng() * 0x1_0000_0000);
  const rand21 = (): number => Math.floor(rng() * 0x20_0000); // 2^21
  for (let i = 0; i < PIECE_TYPES * BOARD_SQUARES; i++) {
    loTable[i] = rand32();
    hiTable[i] = rand21();
  }
  sideLo = rand32();
  sideHi = rand21();
}

/**
 * Otisk pozice jako 53-bit celé číslo. Shodná pozice → shodný otisk; jiný
 * kámen na poli, jiné pole i obrat strany na tahu otisk mění.
 *
 * Poškozenou desku (díra – `undefined`) odmítá RangeError stejně jako
 * `evaluate`: tiché přeskočení by dvě různě poškozené pozice zahašovalo
 * shodně a kolize by kaskádovala do TT jako záměna pozic.
 */
export function hashPosition(position: Position): number {
  let hi = 0;
  let lo = 0;
  const board = position.board;
  for (let square = 0; square < BOARD_SQUARES; square++) {
    const cell = board[square];
    if (cell === undefined) {
      throw new RangeError(`Poškozená pozice: díra v board na poli ${String(square + 1)}`);
    }
    if (cell === null) {
      continue;
    }
    const type = (cell.color === 'white' ? 2 : 0) + (cell.kind === 'king' ? 1 : 0);
    const idx = type * BOARD_SQUARES + square;
    const hiVal = hiTable[idx];
    const loVal = loTable[idx];
    // Invariant: idx ∈ [0, 4·32) je vždy v rozsahu tabulek. Guard hlídá jen
    // vlastní chybu modulu (špatně nadimenzovaná tabulka) – hlasitě, ne tiše.
    if (hiVal === undefined || loVal === undefined) {
      throw new RangeError(`Zobrist: index ${String(idx)} mimo rozsah tabulky`);
    }
    hi ^= hiVal;
    lo ^= loVal;
  }
  if (position.turn === 'black') {
    hi ^= sideHi;
    lo ^= sideLo;
  }
  // `>>> 0` složí obě poloviny jako unsigned; výsledek < 2^53 (viz hlavička).
  return (hi >>> 0) * 0x1_0000_0000 + (lo >>> 0);
}

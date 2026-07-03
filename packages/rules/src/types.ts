/**
 * Základní typy knihovny pravidel.
 *
 * Deska 8×8 se hraje jen na 32 tmavých polích číslovaných 1–32
 * (standardní PDN číslování): pole 1–4 jsou v horní řadě na straně
 * černého, pole 29–32 v dolní řadě na straně bílého. Černý táhne první.
 */

/** Barva hráče. */
export type Color = 'black' | 'white';

/** Druh kamene: muž (`man`), nebo dáma (`king`). */
export type PieceKind = 'man' | 'king';

/** Kámen na desce. */
export interface Piece {
  readonly color: Color;
  readonly kind: PieceKind;
}

/** Obsah jednoho hracího pole: kámen, nebo prázdno (`null`). */
export type Cell = Piece | null;

/**
 * Číslo hracího pole 1–32 ve standardním PDN číslování.
 *
 * Jen dokumentační alias – rozsah se kontroluje za běhu v převodních
 * funkcích (`squareToCoords`, `coordsToSquare`).
 */
export type Square = number;

/**
 * Pozice na desce.
 *
 * `board` má vždy délku 32; `board[i]` je obsah pole číslo `i + 1`.
 */
export interface Position {
  readonly board: readonly Cell[];
  /** Strana na tahu. */
  readonly turn: Color;
}

/**
 * Tah.
 *
 * Prostý tah má v `path` jediný prvek (cílové pole) a prázdné `captures`.
 * Skok (i vícenásobný) má v `path` sekvenci polí dopadu v pořadí, v jakém
 * na ně kámen dopadá, a v `captures` přeskočená pole ve stejném pořadí.
 *
 * Pozor na předpoklady (platí jen to, co je tu napsané):
 * - `captures.length === path.length` platí JEN pro skoky; prostý tah má
 *   0 braní a 1 prvek v path. Konzumenti rozlišují přes `captures.length > 0`.
 * - `captures` nesmí obsahovat duplicity (stejný kámen nelze v jedné
 *   sekvenci přeskočit dvakrát) – vynucuje generátor, ne typ.
 * - `path` duplicity obsahovat SMÍ: dáma může kruhovým vícenásobným skokem
 *   dopadnout na už navštívené pole, i zpět na `from`. Aplikace tahu nesmí
 *   předpokládat unikátní pole v path.
 */
export interface Move {
  readonly from: Square;
  readonly path: readonly Square[];
  readonly captures: readonly Square[];
}

/**
 * Kniha zahájení (fáze 56) – statická read-only tabulka pozice → tah.
 *
 * Slouží plnosilovému soupeři (viz `levelUsesBook` v levels.ts): než engine
 * začne hledat, server nahlédne sem a je-li pozice v knize, zahraje knižní tah
 * bez volání enginu. Server knize NEVĚŘÍ o nic víc než enginu – knižní tah se
 * stejně ověří přes `findLegalMove`, nelegální/chybějící se zahodí a hledá se
 * normálně (viz app.ts).
 *
 * Klíč je `positionKey` z rules (strana na tahu + obsah 32 polí), NE Zobrist:
 * lookup je jednou za tah, žádný tlak na rychlost, a plná serializace nemá
 * kolizní riziko (hash má). Seed se NEpíše jako ručně nabušené klíče ani jako
 * 32-buňkové desky – buduje se PŘEHRÁNÍM tahů reálnými pravidly od výchozí
 * pozice, takže klíče i tahy pocházejí z jednoho zdroje (rules) a nemůžou se
 * rozejít s tím, co server v provozu klíčuje.
 *
 * ROZSAH: minimální seed jen na důkaz mechaniky, NE reálná teorie zahájení.
 * Zrcadlová symetrie desky se NEŘEŠÍ – kniha netrefí zrcadlově transponované
 * pozice. Obojí je vědomě odloženo do pozdější obsahové fáze.
 */

import { applyMove, initialPosition, legalMoves, positionKey } from '@checkers/rules';
import type { Move, Position, Square } from '@checkers/rules';

/**
 * Jedno zahájení jako sekvence prostých tahů `[from, to]` od výchozí pozice.
 * V zahájení dámy se nebere (kameny se ještě nepotkaly), takže stačí prosté
 * tahy; každý se při stavbě ověří proti `legalMoves` (nelegální = chyba seedu,
 * hlásí se hlasitě už při načtení modulu, ne tiše).
 */
type OpeningLine = readonly (readonly [Square, Square])[];

/**
 * Minimální seed. Jediná linie stačí a POKRÝVÁ OBĚ BARVY enginu:
 *  - výchozí pozice (černý na tahu) → engine hraje černou a začíná,
 *  - po prvním černém tahu (bílý na tahu) → engine hraje bílou po tahu člověka.
 * Čísla jsou legální americká zahájení (11-15 „Old Faithful" a spol.), NE nutně
 * teoreticky nejlepší – obsah řeší pozdější fáze. Legalitu hlídá `buildBook`.
 */
const SEED_LINES: readonly OpeningLine[] = [
  [
    [11, 15],
    [23, 19],
    [9, 14],
    [22, 17],
  ],
];

/** Úplná shoda tahů (from + path + captures) pro detekci konfliktu v seedu. */
function movesEqual(a: Move, b: Move): boolean {
  return (
    a.from === b.from &&
    a.path.length === b.path.length &&
    a.path.every((sq, i) => sq === b.path[i]) &&
    a.captures.length === b.captures.length &&
    a.captures.every((sq, i) => sq === b.captures[i])
  );
}

/**
 * Postaví knihu přehráním linií reálnými pravidly. Pro každý půltah přiřadí
 * `positionKey(pozice před tahem) → tah`. Nelegální tah v seedu nebo konflikt
 * (dvě různá zahájení pro tutéž pozici) je chyba seedu → vyhodí Error při
 * načtení modulu (fail loud; tichá kniha by kazila hru bez varování).
 */
function buildBook(lines: readonly OpeningLine[]): ReadonlyMap<string, Move> {
  const book = new Map<string, Move>();
  for (const line of lines) {
    let position = initialPosition();
    for (const [from, to] of line) {
      const move = legalMoves(position).find(
        (m) =>
          m.from === from && m.captures.length === 0 && m.path.length === 1 && m.path[0] === to,
      );
      if (move === undefined) {
        throw new Error(
          `Seed knihy zahájení: ${String(from)}-${String(to)} není legální prostý tah v dané pozici.`,
        );
      }
      const key = positionKey(position);
      const existing = book.get(key);
      if (existing !== undefined && !movesEqual(existing, move)) {
        throw new Error(
          'Seed knihy zahájení: konflikt – dvě různá zahájení pro tutéž pozici.',
        );
      }
      book.set(key, move);
      position = applyMove(position, move);
    }
  }
  return book;
}

/** Výchozí kniha zahájení serveru. */
export const OPENING_BOOK: ReadonlyMap<string, Move> = buildBook(SEED_LINES);

/**
 * Knižní tah pro pozici, nebo `undefined`, když pozice v knize není. Volající
 * MUSÍ vrácený tah ještě ověřit proti pravidlům (`findLegalMove`) – kniha je
 * data, ne autorita.
 */
export function lookupBookMove(
  book: ReadonlyMap<string, Move>,
  position: Position,
): Move | undefined {
  return book.get(positionKey(position));
}

/**
 * Kniha zahájení (fáze 56, rozšířeno ve fázi 57) – statická read-only tabulka
 * pozice → kandidátní tahy.
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
 * FÁZE 57 – VÍC KANDIDÁTŮ NA POZICI: hodnota v knize je SEZNAM tahů, ne jeden
 * tah. Reálná teorie zahájení se větví (na tutéž pozici víc dobrých pokračování)
 * a dřívější model „jeden tah, konflikt = Error" ji neuměl pojmout – druhá linie
 * sdílející pozici s jinou odpovědí shodila načtení modulu. Nově se kandidáti
 * hromadí; identické tahy se dedupují (ne chyba – seed se přehrává po půltazích,
 * shodné prefixy linií nutně narazí na tutéž pozici+tah). Zůstává jediná tvrdá
 * pojistka: NELEGÁLNÍ tah v seedu pořád vyhodí Error (fail loud). Výběr z
 * kandidátů při lookupu je zatím DETERMINISTICKÝ (první vložený), viz
 * `lookupBookMove`.
 *
 * ROZSAH: minimální seed jen na důkaz mechaniky, NE reálná teorie zahájení
 * (naplnění řeší další fáze). Zrcadlová symetrie desky se NEŘEŠÍ – kniha netrefí
 * zrcadlově transponované pozice. Náhodný výběr pro variabilitu je také mimo
 * rozsah (zatím deterministicky). Vše vědomě odloženo.
 */

import { applyMove, initialPosition, legalMoves, positionKey } from '@checkers/rules';
import type { Move, Position, Square } from '@checkers/rules';

/**
 * Kniha zahájení: klíč `positionKey` → seznam kandidátních tahů (≥ 1, nikdy
 * prázdný – prázdný seznam se do knihy neukládá). Pořadí v seznamu je pořadí
 * vložení při stavbě (viz `buildBook`); na tom stojí deterministický výběr.
 */
export type OpeningBook = ReadonlyMap<string, readonly Move[]>;

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

/** Úplná shoda tahů (from + path + captures) pro dedup kandidátů v seedu. */
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
 * `positionKey(pozice před tahem) → kandidát`. Víc linií smí sdílet pozici a
 * nabídnout k ní RŮZNÉ tahy → nashromáždí se jako víc kandidátů (žádná chyba).
 * Identický tah na téže pozici se dedupuje (shodné prefixy linií). Nelegální tah
 * v seedu je jediná tvrdá chyba → vyhodí Error při načtení modulu (fail loud;
 * tichá kniha by kazila hru bez varování).
 *
 * Exportováno kvůli testům se zuby (větvení/dedup na řízeném vstupu bez sahání
 * na produkční seed).
 */
export function buildBook(lines: readonly OpeningLine[]): OpeningBook {
  const book = new Map<string, Move[]>();
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
      const candidates = book.get(key);
      if (candidates === undefined) {
        book.set(key, [move]);
      } else if (!candidates.some((c) => movesEqual(c, move))) {
        candidates.push(move); // nový kandidát na známé pozici (větvení)
      }
      // else: identický tah už v seznamu → dedup, nic (shodný prefix linií)
      position = applyMove(position, move);
    }
  }
  return book;
}

/** Výchozí kniha zahájení serveru. */
export const OPENING_BOOK: OpeningBook = buildBook(SEED_LINES);

/**
 * Knižní tah pro pozici, nebo `undefined`, když pozice v knize není. Při víc
 * kandidátech vybírá DETERMINISTICKY první vložený (pořadí ze `buildBook`) –
 * náhodný výběr pro variabilitu je mimo rozsah fáze 57. Volající MUSÍ vrácený
 * tah ještě ověřit proti pravidlům (`findLegalMove`) – kniha je data, ne
 * autorita.
 */
export function lookupBookMove(book: OpeningBook, position: Position): Move | undefined {
  return book.get(positionKey(position))?.[0];
}

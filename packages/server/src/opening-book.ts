/**
 * Kniha zahájení (fáze 56–58) – statická read-only tabulka pozice → kandidátní
 * tahy.
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
 * VÍC KANDIDÁTŮ NA POZICI (fáze 57): hodnota je SEZNAM tahů. Reálná teorie se
 * větví (na tutéž pozici víc dobrých pokračování). Kandidáti se hromadí,
 * identické tahy se dedupují; výběr při lookupu je DETERMINISTICKÝ (první
 * vložený), viz `lookupBookMove`.
 *
 * REÁLNÁ ZAHÁJENÍ – KOMPLEX 11-15 (fáze 58): seed nese hlavní odpovědi bílého
 * na první tah černého 11-15 (Single Corner 22-18, 23-19, Kelso 24-20, 21-17,
 * 23-18, 22-17) do ~8 půltahů. Zdroj: Richard Pask, „Complete Checkers" (volné
 * PDF, checkermaven.com), trunk/drawn linie sekce 11-15. KAŽDÝ půltah je ověřen
 * přehráním přes reálná pravidla (`buildBook` páruje `from`+dopadové pole proti
 * `legalMoves`, právě jedna shoda – jinak Error). Braní je v zahájení běžné
 * (výměny), proto se páruje přes dopad, ne jako prostý tah.
 *
 * REÁLNÁ ZAHÁJENÍ – KOMPLEX 9-13 (fáze 59): druhý naplněný první tah černého.
 * Seed nese 6 hlavních odpovědí bílého na 9-13 (21-17, 22-17, 22-18, 23-18,
 * 24-19, 23-19) do ~8 půltahů, z Pask Část 1 (9-13s), trunk příslušných ballotů.
 * Výchozí pozice má tak nově 2 kandidáty prvního tahu: 11-15 (první vložený,
 * deterministicky vybraný) a 9-13. Pozice po 9-13 (engine=bílý) má 6 kandidátů.
 *
 * ROZSAH / VĚDOMĚ ODLOŽENO: zrcadlová symetrie desky (kniha netrefí zrcadlené
 * pozice); náhodný výběr pro variabilitu (zatím deterministicky); zbývající
 * první tahy černého (9-14, 10-14, 10-15, 11-16, 12-16). „Complete Checkers" je
 * kniha 3-move; hlubší čistě-GAYP odbočky mimo trunk zde nejsou.
 */

import { applyMove, initialPosition, legalMoves, positionKey } from '@checkers/rules';
import type { Move, Position, Square } from '@checkers/rules';

/**
 * Kniha zahájení: klíč `positionKey` → seznam kandidátních tahů (≥ 1, nikdy
 * prázdný). Pořadí v seznamu = pořadí vložení (viz `buildBook`); na tom stojí
 * deterministický výběr.
 */
export type OpeningBook = ReadonlyMap<string, readonly Move[]>;

/**
 * Jedno zahájení jako sekvence půltahů `[from, to]` od výchozí pozice, kde `to`
 * je CÍLOVÉ (dopadové) pole – u braní pole dopadu, ne mezipole. Braní i prosté
 * tahy se tak zapisují stejně; `buildBook` je rozliší párováním proti
 * `legalMoves`. (Stejná konvence jako `Ply.to` v rules/openings.ts.)
 */
type OpeningLine = readonly (readonly [Square, Square])[];

/**
 * Seed: komplex 11-15 z Pask, „Complete Checkers", sekce 11-15 (trunk/drawn).
 * Každá linie = 11-15 + jedna hlavní odpověď bílého + hlavní pokračování do
 * ~8 půltahů. Pokrývá OBĚ barvy enginu: výchozí pozice (engine=černý začíná
 * 11-15) i pozice po 11-15 (engine=bílý odpovídá). Komentář nese původní zdroj.
 * Legalitu KAŽDÉHO půltahu vynutí `buildBook` při načtení modulu.
 */
const SEED_LINES: readonly OpeningLine[] = [
  // Single Corner (11-15 22-18) – Pask CC, řádek 13757. Výměna 15x22 25x18.
  [[11, 15], [22, 18], [15, 22], [25, 18], [12, 16], [29, 25], [9, 13], [18, 14]],
  // 11-15 23-19; 8-11 – Pask CC, řádek 14699.
  [[11, 15], [23, 19], [8, 11], [22, 17], [11, 16], [24, 20], [16, 23], [27, 11]],
  // Kelso (11-15 24-20) – Pask CC, řádek 16170.
  [[11, 15], [24, 20], [15, 18], [22, 15], [10, 19], [23, 16], [12, 19], [25, 22]],
  // 11-15 21-17; 8-11 – Pask CC, řádek 13037.
  [[11, 15], [21, 17], [8, 11], [17, 13], [9, 14], [22, 18], [15, 22], [25, 9]],
  // 11-15 23-18; 9-14 – Pask CC, řádek 14191.
  [[11, 15], [23, 18], [9, 14], [18, 11], [8, 15], [22, 18], [15, 22], [25, 9]],
  // 11-15 22-17; 15-18 – Pask CC, řádek 13518.
  [[11, 15], [22, 17], [15, 18], [23, 14], [9, 18], [17, 14], [10, 17], [21, 14]],
  // --- KOMPLEX 9-13 (fáze 59): 6 hlavních odpovědí bílého na první tah 9-13.
  // Pask „Complete Checkers", Část 1 (9-13s); trunk (hlavní linie) uvedených
  // ballotů, prvních ~8 půltahů. 11-15 linie výše zůstávají PRVNÍ → deterministický
  // první kandidát na výchozí pozici je dál 11-15; 9-13 je druhý kandidát.
  // 9-13 21-17; 5-9 – Ballot 1. Prosté tahy, bez braní.
  [[9, 13], [21, 17], [5, 9], [25, 21], [11, 15], [29, 25], [9, 14], [23, 18]],
  // 9-13 22-17; 13-22 – Ballot 3. Výměna 13x22 25x18, pak 18x11 8x15.
  [[9, 13], [22, 17], [13, 22], [25, 18], [11, 15], [18, 11], [8, 15], [21, 17]],
  // 9-13 22-18; 6-9 – Ballot 4. Končí bílého braním 18x11.
  [[9, 13], [22, 18], [6, 9], [25, 22], [1, 6], [24, 19], [11, 15], [18, 11]],
  // 9-13 23-18; 5-9 – Ballot 8. Prosté tahy, bez braní.
  [[9, 13], [23, 18], [5, 9], [26, 23], [11, 16], [30, 26], [10, 14], [24, 19]],
  // 9-13 24-19; 5-9 – Ballot 17. Výměna 22-18 15x22 25x18.
  [[9, 13], [24, 19], [5, 9], [28, 24], [11, 15], [22, 18], [15, 22], [25, 18]],
  // 9-13 23-19; 5-9 – Ballot 13. Výměna 22-18 15x22 25x18.
  [[9, 13], [23, 19], [5, 9], [27, 23], [11, 15], [22, 18], [15, 22], [25, 18]],
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
 * Postaví knihu přehráním linií reálnými pravidly. Každý půltah `[from, to]`
 * spáruje proti `legalMoves(pozice)` přes `from` a DOPADOVÉ pole (`path[last]`);
 * musí sedět PRÁVĚ JEDNA legální shoda – jinak Error (fail loud). Tím se řeší:
 *  - braní (dopad ≠ sousední pole) i prosté tahy jednotně,
 *  - překlep v datech (nelegální tah = 0 shod → Error),
 *  - nejednoznačnost (dvě různé cesty se stejným dopadem = 2 shody → Error),
 * takže se do knihy nikdy nedostane špatný nebo dvojznačný tah tiše.
 * (Stejná párovací logika jako `playBallot` v rules – sdílený kontrakt.)
 *
 * Víc linií smí sdílet pozici a nabídnout RŮZNÉ tahy → víc kandidátů. Identický
 * tah na téže pozici se dedupuje. Exportováno kvůli testům se zuby.
 */
export function buildBook(lines: readonly OpeningLine[]): OpeningBook {
  const book = new Map<string, Move[]>();
  for (const line of lines) {
    let position = initialPosition();
    for (const [from, to] of line) {
      const matches = legalMoves(position).filter(
        (m) => m.from === from && m.path[m.path.length - 1] === to,
      );
      const [move, extra] = matches;
      if (move === undefined || extra !== undefined) {
        throw new Error(
          `Seed knihy zahájení: půltah ${String(from)}->${String(to)} má ${String(matches.length)} legálních shod (očekávána právě 1).`,
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
 * náhodný výběr pro variabilitu je mimo rozsah. Volající MUSÍ vrácený tah ještě
 * ověřit proti pravidlům (`findLegalMove`) – kniha je data, ne autorita.
 */
export function lookupBookMove(book: OpeningBook, position: Position): Move | undefined {
  return book.get(positionKey(position))?.[0];
}

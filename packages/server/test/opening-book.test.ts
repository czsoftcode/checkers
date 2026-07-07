/**
 * Jednotkové testy knihy zahájení (fáze 56).
 *
 * ZUBY:
 *  - zásah vrací PŘESNĚ seedovaný tah (ne „nějaký"), i o pár půltahů dál →
 *    hlídá, že se seed staví ze správných tahů,
 *  - pozice dosažená JINÝM prvním tahem než knižním → miss (undefined) →
 *    hlídá, že klíč rozlišuje pozice (ne „vždy něco vrátí"),
 *  - klíč knihy = reálný `positionKey` z rules (kontrakt serializace): test
 *    zkonstruuje pozici pravidly a čeká zásah; kdyby modul klíčoval jinak než
 *    server v provozu, minul by.
 * Legalitu seedu hlídá už načtení modulu (buildBook vyhodí Error na nelegálním
 * tahu) – když se sem naimportuje, seed prošel pravidly.
 */

import { describe, expect, it } from 'vitest';

import { applyMove, initialPosition, legalMoves, positionKey } from '@checkers/rules';
import type { Move } from '@checkers/rules';

import { OPENING_BOOK, buildBook, lookupBookMove } from '../src/opening-book.js';

/** Prostý tah `from`-`to` v dané pozici z reálných pravidel (nebo chyba). */
function simpleMove(position: Parameters<typeof legalMoves>[0], from: number, to: number): Move {
  const move = legalMoves(position).find(
    (m) => m.from === from && m.path.length === 1 && m.path[0] === to && m.captures.length === 0,
  );
  if (move === undefined) {
    throw new Error(`Testovací tah ${from}-${to} není legální`);
  }
  return move;
}

describe('kniha zahájení – lookupBookMove', () => {
  it('zásah na výchozí pozici (černý na tahu) vrací seedovaný první tah 11-15', () => {
    const start = initialPosition();
    const hit = lookupBookMove(OPENING_BOOK, start);
    expect(hit).toBeDefined();
    // PŘESNĚ knižní tah, ne „nějaký legální".
    expect(hit).toEqual(simpleMove(start, 11, 15));
  });

  it('zásah o dva půltahy dál (bílý na tahu) vrací seedovaný tah 23-19', () => {
    // Přehraj knižní první tah pravidly → pozice s bílým na tahu, která JE v knize.
    const start = initialPosition();
    const afterBlack = applyMove(start, simpleMove(start, 11, 15));
    expect(afterBlack.turn).toBe('white'); // klíč nese stranu na tahu
    const hit = lookupBookMove(OPENING_BOOK, afterBlack);
    expect(hit).toEqual(simpleMove(afterBlack, 23, 19));
  });

  it('pozice po JINÉM prvním tahu než knižním → miss (undefined)', () => {
    const start = initialPosition();
    // Vyber legální první tah, který NENÍ knižní (kniha má 11-15).
    const other = legalMoves(start).find((m) => !(m.from === 11 && m.path[0] === 15));
    expect(other).toBeDefined();
    const afterOther = applyMove(start, other!);
    expect(lookupBookMove(OPENING_BOOK, afterOther)).toBeUndefined();
  });

  it('kontrakt: klíč knihy je reálný positionKey (has() na dopočítaném klíči)', () => {
    // Kdyby modul klíčoval jinou serializací, tenhle klíč by v mapě nebyl.
    expect(OPENING_BOOK.has(positionKey(initialPosition()))).toBe(true);
  });
});

describe('kniha zahájení – buildBook: víc kandidátů na pozici (fáze 57)', () => {
  it('(a) dvě RŮZNÉ odpovědi na tutéž pozici → 2 kandidáti, NEvyhodí Error', () => {
    // Obě linie startují z výchozí pozice (černý na tahu), ale prvním tahem se
    // rozejdou. Dřívější model „konflikt = Error" by tady spadl; nově se
    // nashromáždí jako dva kandidáti.
    const start = initialPosition();
    const book = buildBook([[[11, 15]], [[9, 14]]]);
    const candidates = book.get(positionKey(start));
    expect(candidates).toHaveLength(2);
    // Pořadí = pořadí vložení (na tom stojí deterministický výběr).
    expect(candidates![0]).toEqual(simpleMove(start, 11, 15));
    expect(candidates![1]).toEqual(simpleMove(start, 9, 14));
  });

  it('(b) identický tah 2× (shodný prefix linií) → 1 kandidát (dedup), NEvyhodí', () => {
    // Dvě linie se shodným prvním tahem 11-15 narazí na tutéž pozici+tah.
    const start = initialPosition();
    const book = buildBook([
      [
        [11, 15],
        [23, 19],
      ],
      [
        [11, 15],
        [22, 17],
      ],
    ]);
    // Výchozí pozice: 11-15 vložený dvakrát → dedup na 1.
    expect(book.get(positionKey(start))).toHaveLength(1);
    // Po 11-15 (bílý na tahu) se ale linie rozešly → 2 kandidáti (větvení).
    const afterBlack = applyMove(start, simpleMove(start, 11, 15));
    expect(book.get(positionKey(afterBlack))).toHaveLength(2);
  });

  it('(c) nelegální tah v seedu → pořád vyhodí Error (fail loud pojistka zůstává)', () => {
    // 11-20 není legální prostý tah z výchozí pozice.
    expect(() => buildBook([[[11, 20]]])).toThrow(/není legální/);
  });

  it('(d) lookupBookMove při víc kandidátech vybírá DETERMINISTICKY první vložený', () => {
    const start = initialPosition();
    const book = buildBook([[[9, 14]], [[11, 15]]]); // pořadí vložení: 9-14, pak 11-15
    // Vybere první vložený (9-14), NE ten „hezčí" nebo náhodný.
    expect(lookupBookMove(book, start)).toEqual(simpleMove(start, 9, 14));
  });

  it('(e) pozice mimo knihu → lookupBookMove vrací undefined', () => {
    const start = initialPosition();
    const book = buildBook([[[11, 15]]]);
    const afterBook = applyMove(start, simpleMove(start, 11, 15)); // bílý na tahu, NENÍ v knize
    expect(lookupBookMove(book, afterBook)).toBeUndefined();
  });

  it('(f) kanárek: PRODUKČNÍ seed nemá na žádné pozici víc než 1 kandidáta', () => {
    // Zrušením „konflikt = Error" (fáze 57) může do seedu potichu proklouznout
    // kolizní kandidát – dnes inertní (výběr = [0]), ale ve fázi 58 s náhodným
    // výběrem by začal kazit hru. Aktuální seed je LINEÁRNÍ (jedna linie), takže
    // každá pozice smí mít právě 1 kandidát; víc = neúmyslná kolize v seedu.
    // Až fáze 58 přidá záměrné větvení, tento test se vědomě upraví.
    for (const candidates of OPENING_BOOK.values()) {
      expect(candidates).toHaveLength(1);
    }
  });
});

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

import { OPENING_BOOK, lookupBookMove } from '../src/opening-book.js';

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

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

  it('zásah o dva půltahy dál (bílý na tahu) vrací PRVNÍ kandidát 22-18 (Single Corner)', () => {
    // Přehraj knižní první tah pravidly → pozice s bílým na tahu, která JE v knize.
    // Po 11-15 má kniha 6 odpovědí bílého; deterministický výběr vrací první
    // vloženou linii = 22-18 (Single Corner), NE „nějakou".
    const start = initialPosition();
    const afterBlack = applyMove(start, simpleMove(start, 11, 15));
    expect(afterBlack.turn).toBe('white'); // klíč nese stranu na tahu
    const hit = lookupBookMove(OPENING_BOOK, afterBlack);
    expect(hit).toEqual(simpleMove(afterBlack, 22, 18));
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
    // 11-20 nemá z výchozí pozice žádnou legální shodu (0 shod) → Error.
    expect(() => buildBook([[[11, 20]]])).toThrow(/0 legálních shod/);
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

  it('(f) kanárek: žádný prázdný seznam + počty kandidátů na dokumentovaných pozicích', () => {
    // Zrušením „konflikt = Error" (fáze 57) může do seedu potichu proklouznout
    // kolizní/duplicitní kandidát. Kanárek nad PRODUKČNÍ knihou to chytí:
    // 1) žádná pozice nesmí mít prázdný seznam (past undefined na existujícím klíči),
    for (const candidates of OPENING_BOOK.values()) {
      expect(candidates.length).toBeGreaterThan(0);
    }
    // 2) výchozí pozice: všechny linie začínají 11-15 → přesně 1 kandidát (dedup),
    const start = initialPosition();
    expect(OPENING_BOOK.get(positionKey(start))).toHaveLength(1);
    // 3) po 11-15 (bílý na tahu): 6 hlavních odpovědí bílého = přesně 6 kandidátů.
    //    Duplicitní/kolizní tah v seedu by tohle číslo rozbil (zuby). Při změně
    //    počtu seed linií se číslo VĚDOMĚ upraví.
    const afterBlack = applyMove(start, simpleMove(start, 11, 15));
    expect(OPENING_BOOK.get(positionKey(afterBlack))).toHaveLength(6);
  });
});

describe('kniha zahájení – reálný komplex 11-15 (fáze 58)', () => {
  /** Přehraje půltah `from`→dopad `to` (i braní) proti reálným pravidlům. */
  function play(pos: Parameters<typeof legalMoves>[0], from: number, to: number) {
    const matches = legalMoves(pos).filter(
      (m) => m.from === from && m.path[m.path.length - 1] === to,
    );
    if (matches.length !== 1) {
      throw new Error(`test: ${from}->${to} má ${matches.length} shod (očekávána 1)`);
    }
    return applyMove(pos, matches[0]!);
  }
  /** Dopadové pole knižního tahu pro pozici (nebo undefined). */
  function bookLanding(pos: Parameters<typeof legalMoves>[0]): [number, number] | undefined {
    const m = lookupBookMove(OPENING_BOOK, pos);
    return m === undefined ? undefined : [m.from, m.path[m.path.length - 1]!];
  }

  it('Single Corner: 11-15 22-18 → černý knižně bere 15x22 (braní), pak 25x18 → 12-16', () => {
    let p = play(initialPosition(), 11, 15); // černý (engine=černý začíná)
    // Engine bílý po 11-15: první kandidát 22-18.
    expect(bookLanding(p)).toEqual([22, 18]);
    p = play(p, 22, 18); // bílý 22-18
    // Černý knižně: 15x22 – a JE to braní (dopad ≠ prostý tah).
    const bm = lookupBookMove(OPENING_BOOK, p);
    expect(bm).toBeDefined();
    expect([bm!.from, bm!.path[bm!.path.length - 1]]).toEqual([15, 22]);
    expect(bm!.captures.length).toBe(1); // braní zakódováno správně
    p = play(p, 15, 22); // černý bere
    p = play(p, 25, 18); // bílý bere zpět (člověk)
    // Černý knižně dál: 12-16.
    expect(bookLanding(p)).toEqual([12, 16]);
  });

  it('engine=černý odpoví na Kelso: 11-15 24-20 → knižní 15-18', () => {
    let p = play(initialPosition(), 11, 15);
    // Člověk (bílý) zahraje 24-20 – NENÍ první kandidát knihy, ale kniha ho POKRÝVÁ.
    p = play(p, 24, 20);
    // Černý (engine) dostane knižní odpověď 15-18 (větev Kelso).
    expect(bookLanding(p)).toEqual([15, 18]);
  });

  it('mimo pokryté odpovědi bílého → černý vypadne z knihy (undefined)', () => {
    let p = play(initialPosition(), 11, 15);
    // 24-19 je legální odpověď bílého, ale JEDINÁ ze 7, kterou seed nepokrývá
    // (má 22-18, 23-19, 24-20, 21-17, 23-18, 22-17) → černý není v knize.
    p = play(p, 24, 19);
    expect(lookupBookMove(OPENING_BOOK, p)).toBeUndefined();
  });

  // REFERENČNÍ linie: nezávisle ověřené proti Pask „Complete Checkers" (sekce
  // 11-15) při self-review fáze 58. Slouží jako REGRESNÍ zámek obsahu PRODUKČNÍ
  // knihy: kdyby se do SEED_LINES vloudil překlep (i legální a jednoznačný, který
  // buildBook sám nezachytí), přehrání níž ho chytí. Formát [from, dopad].
  const REFERENCE_LINES: readonly (readonly [number, number])[][] = [
    [[11, 15], [22, 18], [15, 22], [25, 18], [12, 16], [29, 25], [9, 13], [18, 14]],
    [[11, 15], [23, 19], [8, 11], [22, 17], [11, 16], [24, 20], [16, 23], [27, 11]],
    [[11, 15], [24, 20], [15, 18], [22, 15], [10, 19], [23, 16], [12, 19], [25, 22]],
    [[11, 15], [21, 17], [8, 11], [17, 13], [9, 14], [22, 18], [15, 22], [25, 9]],
    [[11, 15], [23, 18], [9, 14], [18, 11], [8, 15], [22, 18], [15, 22], [25, 9]],
    [[11, 15], [22, 17], [15, 18], [23, 14], [9, 18], [17, 14], [10, 17], [21, 14]],
  ];

  it('všech 6 referenčních linií je v PRODUKČNÍ knize po celé délce (regresní zámek)', () => {
    for (const line of REFERENCE_LINES) {
      let pos = initialPosition();
      for (const [from, to] of line) {
        // Na každé pozici linie MUSÍ mít kniha kandidáta from→dopad (mezi ostatními).
        const candidates = OPENING_BOOK.get(positionKey(pos)) ?? [];
        const present = candidates.some(
          (m) => m.from === from && m.path[m.path.length - 1] === to,
        );
        expect(present, `chybí knižní tah ${from}->${to}`).toBe(true);
        pos = play(pos, from, to);
      }
    }
  });
});

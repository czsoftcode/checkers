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
    // Vyber legální první tah, který NENÍ knižní (kniha zná 11-15, 9-13, 9-14,
    // 10-14, 10-15 a 11-16; nepokryté zůstává už jen 12-16).
    const bookFirst = new Set(['11-15', '9-13', '9-14', '10-14', '10-15', '11-16']);
    const other = legalMoves(start).find((m) => !bookFirst.has(`${m.from}-${m.path[0]}`));
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
    // 2) výchozí pozice: 6 knižních prvních tahů (11-15 z fáze 58, 9-13 z fáze 59,
    //    9-14 z fáze 60, 10-14 z fáze 61, 10-15 z fáze 62, 11-16 z fáze 63), každý
    //    dedup na 1 → přesně 6 kandidátů. Pořadí vložení: 11-15, 9-13, 9-14,
    //    10-14, 10-15, 11-16.
    const start = initialPosition();
    const firstCandidates = OPENING_BOOK.get(positionKey(start));
    expect(firstCandidates).toHaveLength(6);
    expect(firstCandidates![0]).toEqual(simpleMove(start, 11, 15));
    expect(firstCandidates![1]).toEqual(simpleMove(start, 9, 13));
    expect(firstCandidates![2]).toEqual(simpleMove(start, 9, 14));
    expect(firstCandidates![3]).toEqual(simpleMove(start, 10, 14));
    expect(firstCandidates![4]).toEqual(simpleMove(start, 10, 15));
    expect(firstCandidates![5]).toEqual(simpleMove(start, 11, 16));
    // 3) po 11-15 (bílý na tahu): 6 hlavních odpovědí bílého = přesně 6 kandidátů.
    //    Duplicitní/kolizní tah v seedu by tohle číslo rozbil (zuby). Při změně
    //    počtu seed linií se číslo VĚDOMĚ upraví.
    const afterBlack = applyMove(start, simpleMove(start, 11, 15));
    expect(OPENING_BOOK.get(positionKey(afterBlack))).toHaveLength(6);
    // 4) po 9-13 (bílý na tahu): 6 hlavních odpovědí bílého = přesně 6 kandidátů.
    const afterBlack913 = applyMove(start, simpleMove(start, 9, 13));
    expect(OPENING_BOOK.get(positionKey(afterBlack913))).toHaveLength(6);
    // 5) po 9-14 (bílý na tahu): 6 hlavních odpovědí bílého = přesně 6 kandidátů.
    const afterBlack914 = applyMove(start, simpleMove(start, 9, 14));
    expect(OPENING_BOOK.get(positionKey(afterBlack914))).toHaveLength(6);
    // 6) po 10-14 (bílý na tahu): 6 hlavních odpovědí bílého = přesně 6 kandidátů.
    const afterBlack1014 = applyMove(start, simpleMove(start, 10, 14));
    expect(OPENING_BOOK.get(positionKey(afterBlack1014))).toHaveLength(6);
    // 7) po 10-15 (bílý na tahu): 7 odpovědí bílého = přesně 7 kandidátů. VŠECHNY
    //    legální odpovědi bílého jsou pokryté (fáze 62), proto 7, ne 6 jako výše.
    const afterBlack1015 = applyMove(start, simpleMove(start, 10, 15));
    expect(OPENING_BOOK.get(positionKey(afterBlack1015))).toHaveLength(7);
    // 8) po 11-16 (bílý na tahu): 7 odpovědí bílého = přesně 7 kandidátů. Jako
    //    10-15 pokrývá 11-16 všechny legální odpovědi bílého (fáze 63) → 7.
    const afterBlack1116 = applyMove(start, simpleMove(start, 11, 16));
    expect(OPENING_BOOK.get(positionKey(afterBlack1116))).toHaveLength(7);
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

describe('kniha zahájení – reálný komplex 9-13 (fáze 59)', () => {
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

  it('engine=bílý po 9-13: deterministicky první kandidát 21-17', () => {
    const p = play(initialPosition(), 9, 13); // černý (člověk) zahraje 9-13
    // Kniha má 6 odpovědí bílého; deterministický výběr vrací první vloženou (21-17).
    expect(bookLanding(p)).toEqual([21, 17]);
  });

  it('engine=černý odpoví na 9-13 24-19 → knižní 5-9 (pokrytá NE-první odpověď)', () => {
    let p = play(initialPosition(), 9, 13);
    // Bílý (člověk) zahraje 24-19 – NENÍ první kandidát, ale kniha ho POKRÝVÁ.
    p = play(p, 24, 19);
    expect(bookLanding(p)).toEqual([5, 9]);
  });

  it('9-13 22-17 → černý knižně bere 13x22 (braní zakódováno správně)', () => {
    let p = play(initialPosition(), 9, 13);
    p = play(p, 22, 17); // bílý 22-17 nabízí výměnu
    const bm = lookupBookMove(OPENING_BOOK, p);
    expect(bm).toBeDefined();
    expect([bm!.from, bm!.path[bm!.path.length - 1]]).toEqual([13, 22]);
    expect(bm!.captures.length).toBe(1); // je to braní, ne prostý tah
  });

  it('mimo pokryté odpovědi bílého → černý vypadne z knihy (undefined)', () => {
    let p = play(initialPosition(), 9, 13);
    // 24-20 je legální odpověď bílého, ale JEDINÁ ze 7, kterou seed nepokrývá
    // (má 21-17, 22-17, 22-18, 23-18, 24-19, 23-19) → černý není v knize.
    p = play(p, 24, 20);
    expect(lookupBookMove(OPENING_BOOK, p)).toBeUndefined();
  });

  // REFERENČNÍ linie 9-13 (kopie SEED_LINES, ověřená proti Pask „Complete
  // Checkers", Část 1 při self-review fáze 59). POZOR na hranice ochrany: je to
  // NEZÁVISLÁ kopie, takže chytí BUDOUCÍ divergenci – pozdější překlep/přeházení
  // ve SEED_LINES sem nepromítnuté (i legální, který buildBook nezachytí) tady
  // spadne. NEchytí souběžný překlep zapsaný stejně sem i do seedu; proti tomu
  // je pojistkou právě nezávislé čtení proti zdroji, ne tenhle test. Formát
  // [from, dopad].
  const REFERENCE_LINES: readonly (readonly [number, number])[][] = [
    [[9, 13], [21, 17], [5, 9], [25, 21], [11, 15], [29, 25], [9, 14], [23, 18]],
    [[9, 13], [22, 17], [13, 22], [25, 18], [11, 15], [18, 11], [8, 15], [21, 17]],
    [[9, 13], [22, 18], [6, 9], [25, 22], [1, 6], [24, 19], [11, 15], [18, 11]],
    [[9, 13], [23, 18], [5, 9], [26, 23], [11, 16], [30, 26], [10, 14], [24, 19]],
    [[9, 13], [24, 19], [5, 9], [28, 24], [11, 15], [22, 18], [15, 22], [25, 18]],
    [[9, 13], [23, 19], [5, 9], [27, 23], [11, 15], [22, 18], [15, 22], [25, 18]],
  ];

  it('všech 6 referenčních linií 9-13 je v PRODUKČNÍ knize po celé délce (regresní zámek)', () => {
    for (const line of REFERENCE_LINES) {
      let pos = initialPosition();
      for (const [from, to] of line) {
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

describe('kniha zahájení – reálný komplex 9-14 (fáze 60)', () => {
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

  it('engine=bílý po 9-14: deterministicky první kandidát 22-17', () => {
    const p = play(initialPosition(), 9, 14); // černý (člověk) zahraje 9-14
    // Kniha má 6 odpovědí bílého; deterministický výběr vrací první vloženou (22-17).
    expect(bookLanding(p)).toEqual([22, 17]);
  });

  it('engine=černý odpoví na 9-14 24-19 → knižní 11-15 (pokrytá NE-první odpověď)', () => {
    let p = play(initialPosition(), 9, 14);
    // Bílý (člověk) zahraje 24-19 – NENÍ první kandidát, ale kniha ho POKRÝVÁ.
    p = play(p, 24, 19);
    expect(bookLanding(p)).toEqual([11, 15]);
  });

  it('9-14 23-18 → černý knižně bere 14x23 (braní zakódováno správně)', () => {
    let p = play(initialPosition(), 9, 14);
    p = play(p, 23, 18); // bílý 23-18 nabízí výměnu (vynucené braní)
    const bm = lookupBookMove(OPENING_BOOK, p);
    expect(bm).toBeDefined();
    expect([bm!.from, bm!.path[bm!.path.length - 1]]).toEqual([14, 23]);
    expect(bm!.captures.length).toBe(1); // je to braní, ne prostý tah
  });

  it('mimo pokryté odpovědi bílého → černý vypadne z knihy (undefined)', () => {
    let p = play(initialPosition(), 9, 14);
    // 21-17 je legální odpověď bílého, ale JEDINÁ ze 7, kterou seed nepokrývá
    // (má 22-17, 22-18, 23-18, 23-19, 24-19, 24-20) → černý není v knize.
    p = play(p, 21, 17);
    expect(lookupBookMove(OPENING_BOOK, p)).toBeUndefined();
  });

  // REFERENČNÍ linie 9-14 (kopie SEED_LINES, ověřená proti Pask „Complete
  // Checkers", Část 2 při self-review fáze 60). Stejná ochrana i hranice jako
  // u 9-13 výše: nezávislá kopie chytí BUDOUCÍ divergenci, ne souběžný překlep
  // zapsaný stejně sem i do seedu. Formát [from, dopad].
  const REFERENCE_LINES: readonly (readonly [number, number])[][] = [
    [[9, 14], [22, 17], [5, 9], [17, 13], [1, 5], [25, 22], [14, 17], [21, 14]],
    [[9, 14], [22, 18], [5, 9], [25, 22], [11, 16], [18, 15], [10, 19], [24, 15]],
    [[9, 14], [23, 18], [14, 23], [27, 18], [12, 16], [18, 14], [10, 17], [21, 14]],
    [[9, 14], [23, 19], [5, 9], [27, 23], [11, 15], [22, 18], [15, 22], [25, 18]],
    [[9, 14], [24, 19], [11, 15], [22, 18], [15, 24], [18, 9], [5, 14], [28, 19]],
    [[9, 14], [24, 20], [10, 15], [22, 17], [7, 10], [25, 22], [3, 7], [29, 25]],
  ];

  it('všech 6 referenčních linií 9-14 je v PRODUKČNÍ knize po celé délce (regresní zámek)', () => {
    for (const line of REFERENCE_LINES) {
      let pos = initialPosition();
      for (const [from, to] of line) {
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

describe('kniha zahájení – reálný komplex 10-14 (fáze 61)', () => {
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

  it('engine=bílý po 10-14: deterministicky první kandidát 22-17', () => {
    const p = play(initialPosition(), 10, 14); // černý (člověk) zahraje 10-14
    // Kniha má 6 odpovědí bílého; deterministický výběr vrací první vloženou (22-17).
    expect(bookLanding(p)).toEqual([22, 17]);
  });

  it('engine=černý odpoví na 10-14 24-19 → knižní 6-10 (pokrytá NE-první odpověď)', () => {
    let p = play(initialPosition(), 10, 14);
    // Bílý (člověk) zahraje 24-19 – NENÍ první kandidát, ale kniha ho POKRÝVÁ.
    p = play(p, 24, 19);
    expect(bookLanding(p)).toEqual([6, 10]);
  });

  it('10-14 23-18 → černý knižně bere 14x23 (braní zakódováno správně)', () => {
    let p = play(initialPosition(), 10, 14);
    p = play(p, 23, 18); // bílý 23-18 nabízí výměnu (vynucené braní)
    const bm = lookupBookMove(OPENING_BOOK, p);
    expect(bm).toBeDefined();
    expect([bm!.from, bm!.path[bm!.path.length - 1]]).toEqual([14, 23]);
    expect(bm!.captures.length).toBe(1); // je to braní, ne prostý tah
  });

  it('mimo pokryté odpovědi bílého → černý vypadne z knihy (undefined)', () => {
    let p = play(initialPosition(), 10, 14);
    // 21-17 je legální odpověď bílého, ale JEDINÁ ze 7, kterou seed nepokrývá
    // (má 22-17, 22-18, 23-18, 23-19, 24-19, 24-20) → černý není v knize.
    p = play(p, 21, 17);
    expect(lookupBookMove(OPENING_BOOK, p)).toBeUndefined();
  });

  // REFERENČNÍ linie 10-14 (kopie SEED_LINES, ověřená proti Pask „Complete
  // Checkers", Část 3 při self-review fáze 61). Stejná ochrana i hranice jako
  // u 9-13/9-14 výše: nezávislá kopie chytí BUDOUCÍ divergenci, ne souběžný
  // překlep zapsaný stejně sem i do seedu. Formát [from, dopad].
  const REFERENCE_LINES: readonly (readonly [number, number])[][] = [
    [[10, 14], [22, 17], [7, 10], [17, 13], [3, 7], [25, 22], [14, 17], [21, 14]],
    [[10, 14], [22, 18], [6, 10], [25, 22], [11, 15], [18, 11], [8, 15], [29, 25]],
    [[10, 14], [23, 18], [14, 23], [27, 18], [12, 16], [32, 27], [16, 20], [26, 23]],
    [[10, 14], [23, 19], [7, 10], [19, 15], [11, 18], [22, 15], [10, 19], [24, 15]],
    [[10, 14], [24, 19], [6, 10], [22, 17], [9, 13], [28, 24], [13, 22], [25, 9]],
    [[10, 14], [24, 20], [7, 10], [22, 18], [11, 16], [20, 11], [8, 22], [25, 18]],
  ];

  it('všech 6 referenčních linií 10-14 je v PRODUKČNÍ knize po celé délce (regresní zámek)', () => {
    for (const line of REFERENCE_LINES) {
      let pos = initialPosition();
      for (const [from, to] of line) {
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

describe('kniha zahájení – reálný komplex 10-15 (fáze 62)', () => {
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

  it('engine=bílý po 10-15: deterministicky první kandidát 21-17', () => {
    const p = play(initialPosition(), 10, 15); // černý (člověk) zahraje 10-15
    // Kniha má 7 odpovědí bílého; deterministický výběr vrací první vloženou (21-17).
    expect(bookLanding(p)).toEqual([21, 17]);
  });

  it('engine=černý odpoví na 10-15 24-20 → knižní 6-10 (pokrytá NE-první odpověď)', () => {
    let p = play(initialPosition(), 10, 15);
    // Bílý (člověk) zahraje 24-20 – NENÍ první kandidát, ale kniha ho POKRÝVÁ.
    p = play(p, 24, 20);
    expect(bookLanding(p)).toEqual([6, 10]);
  });

  it('10-15 22-18 → černý knižně bere 15x22 (braní zakódováno správně)', () => {
    let p = play(initialPosition(), 10, 15);
    p = play(p, 22, 18); // bílý 22-18 nabízí výměnu
    const bm = lookupBookMove(OPENING_BOOK, p);
    expect(bm).toBeDefined();
    expect([bm!.from, bm!.path[bm!.path.length - 1]]).toEqual([15, 22]);
    expect(bm!.captures.length).toBe(1); // je to braní, ne prostý tah
  });

  it('VŠECH 7 legálních odpovědí bílého na 10-15 je v knize (nic nevypadne)', () => {
    // ODLIŠNÉ OD FÁZÍ 58-61: 10-15 má právě 7 legálních odpovědí bílého a seed
    // pokrývá všechny → žádná bílá odpověď z knihy nevypadne. Kdyby seed jednu
    // vynechal (nebo přidal 8., neexistující), tenhle test spadne.
    const p = play(initialPosition(), 10, 15);
    const legalWhite = legalMoves(p).map((m) => [m.from, m.path[m.path.length - 1]!] as const);
    const candidates = OPENING_BOOK.get(positionKey(p)) ?? [];
    const bookLandings = candidates.map((m) => [m.from, m.path[m.path.length - 1]!] as const);
    expect(legalWhite).toHaveLength(7);
    expect(bookLandings).toHaveLength(7);
    // Každá legální odpověď bílého má v knize odpovídajícího kandidáta.
    for (const [from, to] of legalWhite) {
      const covered = bookLandings.some((b) => b[0] === from && b[1] === to);
      expect(covered, `bílá odpověď ${from}->${to} chybí v knize`).toBe(true);
    }
  });

  it('miss až na DEVIACI černého od trunku (bílé odpovědi jsou pokryté všechny)', () => {
    // Protože žádná bílá odpověď nevypadne (viz test výše), miss nastane až když
    // ČERNÝ zahraje jiný než knižní (trunk) tah. Po 10-15 21-17 je trunk 6-10;
    // černý místo toho 11-16 → výsledná pozice (bílý na tahu) NENÍ v knize.
    let p = play(initialPosition(), 10, 15);
    p = play(p, 21, 17);
    expect(bookLanding(p)).toEqual([6, 10]); // trunk je 6-10
    const deviated = play(p, 11, 16); // černý se odchýlí od trunku
    expect(lookupBookMove(OPENING_BOOK, deviated)).toBeUndefined();
  });

  // REFERENČNÍ linie 10-15 (kopie SEED_LINES, ověřená proti Pask „Complete
  // Checkers", Část 4 při self-review fáze 62). Stejná ochrana i hranice jako
  // u 9-13/9-14/10-14 výše: nezávislá kopie chytí BUDOUCÍ divergenci, ne
  // souběžný překlep zapsaný stejně sem i do seedu. Formát [from, dopad].
  const REFERENCE_LINES: readonly (readonly [number, number])[][] = [
    [[10, 15], [21, 17], [6, 10], [17, 14], [9, 18], [23, 14], [10, 17], [22, 13]],
    [[10, 15], [22, 17], [6, 10], [17, 14], [9, 18], [23, 14], [10, 17], [21, 14]],
    [[10, 15], [22, 18], [15, 22], [25, 18], [9, 13], [29, 25], [11, 15], [18, 11]],
    [[10, 15], [23, 18], [6, 10], [18, 14], [9, 18], [24, 19], [15, 24], [22, 6]],
    [[10, 15], [23, 19], [6, 10], [22, 17], [1, 6], [25, 22], [11, 16], [29, 25]],
    [[10, 15], [24, 19], [15, 24], [28, 19], [6, 10], [22, 17], [9, 14], [25, 22]],
    [[10, 15], [24, 20], [6, 10], [28, 24], [1, 6], [23, 18], [12, 16], [32, 28]],
  ];

  it('všech 7 referenčních linií 10-15 je v PRODUKČNÍ knize po celé délce (regresní zámek)', () => {
    for (const line of REFERENCE_LINES) {
      let pos = initialPosition();
      for (const [from, to] of line) {
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

describe('kniha zahájení – reálný komplex 11-16 (fáze 63)', () => {
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

  it('engine=bílý po 11-16: deterministicky první kandidát 21-17', () => {
    const p = play(initialPosition(), 11, 16); // černý (člověk) zahraje 11-16
    // Kniha má 7 odpovědí bílého; deterministický výběr vrací první vloženou (21-17).
    expect(bookLanding(p)).toEqual([21, 17]);
  });

  it('engine=černý odpoví na 11-16 24-19 → knižní 7-11 (pokrytá NE-první odpověď)', () => {
    let p = play(initialPosition(), 11, 16);
    // Bílý (člověk) zahraje 24-19 – NENÍ první kandidát, ale kniha ho POKRÝVÁ.
    p = play(p, 24, 19);
    expect(bookLanding(p)).toEqual([7, 11]);
  });

  it('11-16 23-19 → černý VYNUCENĚ bere 16x23 (braní zakódováno správně)', () => {
    let p = play(initialPosition(), 11, 16);
    p = play(p, 23, 19); // bílý 23-19 nastaví kámen na 19 – černý ho MUSÍ sebrat
    const bm = lookupBookMove(OPENING_BOOK, p);
    expect(bm).toBeDefined();
    expect([bm!.from, bm!.path[bm!.path.length - 1]]).toEqual([16, 23]);
    expect(bm!.captures.length).toBe(1); // je to braní, ne prostý tah
  });

  it('VŠECH 7 legálních odpovědí bílého na 11-16 je v knize (nic nevypadne)', () => {
    // Jako 10-15 (fáze 62): 11-16 má právě 7 legálních odpovědí bílého a seed
    // pokrývá všechny → žádná bílá odpověď z knihy nevypadne. Kdyby seed jednu
    // vynechal (nebo přidal 8., neexistující), tenhle test spadne.
    const p = play(initialPosition(), 11, 16);
    const legalWhite = legalMoves(p).map((m) => [m.from, m.path[m.path.length - 1]!] as const);
    const candidates = OPENING_BOOK.get(positionKey(p)) ?? [];
    const bookLandings = candidates.map((m) => [m.from, m.path[m.path.length - 1]!] as const);
    expect(legalWhite).toHaveLength(7);
    expect(bookLandings).toHaveLength(7);
    // Každá legální odpověď bílého má v knize odpovídajícího kandidáta.
    for (const [from, to] of legalWhite) {
      const covered = bookLandings.some((b) => b[0] === from && b[1] === to);
      expect(covered, `bílá odpověď ${from}->${to} chybí v knize`).toBe(true);
    }
  });

  it('miss až na DEVIACI černého od trunku (bílé odpovědi jsou pokryté všechny)', () => {
    // Protože žádná bílá odpověď nevypadne (viz test výše), miss nastane až když
    // ČERNÝ zahraje jiný než knižní (trunk) tah. Po 11-16 21-17 je trunk 7-11;
    // černý místo toho 16-20 → výsledná pozice (bílý na tahu) NENÍ v knize.
    let p = play(initialPosition(), 11, 16);
    p = play(p, 21, 17);
    expect(bookLanding(p)).toEqual([7, 11]); // trunk je 7-11
    const deviated = play(p, 16, 20); // černý se odchýlí od trunku
    expect(lookupBookMove(OPENING_BOOK, deviated)).toBeUndefined();
  });

  // REFERENČNÍ linie 11-16 (kopie SEED_LINES, ověřená proti Pask „Complete
  // Checkers", Část 6 při self-review fáze 63). Stejná ochrana i hranice jako
  // u 9-13/9-14/10-14/10-15 výše: nezávislá kopie chytí BUDOUCÍ divergenci, ne
  // souběžný překlep zapsaný stejně sem i do seedu. POZOR: linie 21-17 (ballot
  // 105) má JEN 7 půltahů (trunk pak transponuje do 10-15). Formát [from, dopad].
  const REFERENCE_LINES: readonly (readonly [number, number])[][] = [
    [[11, 16], [21, 17], [7, 11], [17, 14], [10, 17], [22, 13], [11, 15]],
    [[11, 16], [22, 17], [7, 11], [17, 14], [10, 17], [21, 14], [9, 18], [23, 14]],
    [[11, 16], [22, 18], [7, 11], [25, 22], [3, 7], [29, 25], [16, 19], [24, 15]],
    [[11, 16], [23, 18], [7, 11], [18, 15], [11, 18], [22, 15], [10, 19], [24, 15]],
    [[11, 16], [23, 19], [16, 23], [26, 19], [8, 11], [27, 23], [11, 15], [22, 18]],
    [[11, 16], [24, 19], [7, 11], [22, 18], [3, 7], [25, 22], [11, 15], [18, 11]],
    [[11, 16], [24, 20], [16, 19], [23, 16], [12, 19], [22, 18], [9, 14], [18, 9]],
  ];

  it('všech 7 referenčních linií 11-16 je v PRODUKČNÍ knize po celé délce (regresní zámek)', () => {
    for (const line of REFERENCE_LINES) {
      let pos = initialPosition();
      for (const [from, to] of line) {
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

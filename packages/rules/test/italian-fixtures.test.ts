/**
 * Doladicí GOLDEN fixtury pro KONFIGURACI `ITALIAN_RULESET` (fáze 115).
 *
 * Potvrzují tři konfigurační bity, které perft z otevírací pozice mělce
 * NEOVĚŘÍ (dámy se objeví až hluboko, braní přes gap tam nevznikne):
 *  - `king: 'short'`  – dáma se hýbe I BERE o 1 pole VŠEMI 4 směry, NENÍ létavá
 *    (nepřeskočí prázdná pole; přes mezeru nebere),
 *  - `manCaptureBackward: false` – muž se hýbe I BERE JEN VPŘED,
 *  - `promoteMidCapture: false` – muž, který braním DOPADNE na dámskou řadu, se
 *    promění a tah KONČÍ (nepokračuje jako dáma).
 *
 * ORACLE = ručně odvozená MNOŽINA tahů (v komentáři u pozice). Knihovna
 * (`legalMoves`) i nezávislá reference (`perftRef` depth 1) ji musí obě trefit.
 * ZUBY: „krátkost" dámy se křižuje s POOL (létavá dáma) – kde by létavá dáma
 * měla víc tahů / braní přes mezeru, italská krátká je nemá.
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position } from '../src/index.js';
import { ITALIAN_RULESET, POOL_RULESET, applyMove, legalMoves } from '../src/index.js';
import { fromPosition, perftRef } from './italian-reference-gen.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const BLACK_KING: Cell = { color: 'black', kind: 'king' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };

/** Stabilní serializace tahu (odkud→kam + brané) pro porovnání MNOŽINY tahů. */
function asKeys(moves: readonly Move[]): string[] {
  return moves
    .map((m) => `${m.from}->${m.path[m.path.length - 1] ?? -1} [${m.captures.join(',')}]`)
    .sort();
}

describe('ITALIAN king:short – dáma se HÝBE o 1 pole všemi směry (ne létavá)', () => {
  // Černá dáma 14 sama na desce. Krátká dáma má přesně 4 prosté tahy na SOUSEDNÍ
  // pole {9,10,17,18} (po jednom na diagonálu). Létavá by klouzala dál.
  const pos = positionWith([[14, BLACK_KING]], 'black');

  it('krátká dáma: 4 prosté tahy na sousední pole, nic dál', () => {
    expect(asKeys(legalMoves(pos, ITALIAN_RULESET))).toEqual([
      '14->10 []',
      '14->17 []',
      '14->18 []',
      '14->9 []',
    ]);
    // Reference (nezávislá) dá stejný počet.
    expect(perftRef(fromPosition(pos), 1)).toBe(4);
  });

  it('zub: POOL (létavá dáma) má z téhož pole VÍC tahů (klouže dál než o 1)', () => {
    // Létavá dáma z 14 klouže po každé diagonále přes prázdná pole až k okraji,
    // takže tahů je víc než 4. Kdyby ITALIAN_RULESET omylem měl létavou dámu,
    // horní test by spadl na tomto vyšším počtu.
    expect(legalMoves(pos, POOL_RULESET).length).toBeGreaterThan(4);
  });
});

describe('ITALIAN king:short – dáma BERE o 1 pole VPŘED i VZAD (ne létavá)', () => {
  // Černá dáma 14, bílý muž 18 (vpřed-SE, dopad 23 volný) a bílý muž 10
  // (vzad-NE, dopad 7 volný). Krátká dáma bere OBĚMA směry, každé braní 1 skok.
  // Oba count 1 → maximum i kvalita nechají obě (množina).
  const posCapture = positionWith(
    [
      [14, BLACK_KING],
      [18, WHITE_MAN],
      [10, WHITE_MAN],
    ],
    'black',
  );

  it('krátká dáma bere vpřed (přes 18) i vzad (přes 10), oba adjacentně', () => {
    expect(asKeys(legalMoves(posCapture, ITALIAN_RULESET))).toEqual(['14->23 [18]', '14->7 [10]']);
    expect(perftRef(fromPosition(posCapture), 1)).toBe(2);
  });

  // Braní PŘES MEZERU: černá dáma 13, bílý muž 22, mezi nimi PRÁZDNÉ 17.
  // Krátká dáma NEDOSÁHNE (soused 17 je prázdný, ne soupeř) → žádné braní,
  // padá na prosté tahy (13→9, 13→17). Létavá dáma by přes mezeru vzala.
  const posGap = positionWith(
    [
      [13, BLACK_KING],
      [22, WHITE_MAN],
    ],
    'black',
  );

  it('krátká dáma NEbere přes mezeru → jen prosté tahy', () => {
    const moves = legalMoves(posGap, ITALIAN_RULESET);
    expect(moves.every((m) => m.captures.length === 0)).toBe(true);
    expect(asKeys(moves)).toEqual(['13->17 []', '13->9 []']);
    expect(perftRef(fromPosition(posGap), 1)).toBe(2);
  });

  it('zub: POOL (létavá dáma) přes tutéž mezeru BERE (13→26 přes 22)', () => {
    const moves = legalMoves(posGap, POOL_RULESET);
    expect(moves.some((m) => m.captures.includes(22))).toBe(true);
  });
});

describe('ITALIAN manCaptureBackward:false – muž se HÝBE i BERE jen vpřed', () => {
  // Černý muž 14 sám: prosté tahy JEN vpřed (dolů) na {17,18}, ne vzad na {9,10}.
  const posMove = positionWith([[14, BLACK_MAN]], 'black');

  it('muž se hýbe jen vpřed (17,18), ne vzad (9,10)', () => {
    expect(asKeys(legalMoves(posMove, ITALIAN_RULESET))).toEqual(['14->17 []', '14->18 []']);
    expect(perftRef(fromPosition(posMove), 1)).toBe(2);
  });

  // Černý muž 14, bílý muž 18 (vpřed, dopad 23 volný) a bílý muž 10 (vzad, dopad
  // 7 volný). Italský muž bere JEN vpřed přes 18; braní vzad přes 10 NEEXISTUJE.
  const posCapture = positionWith(
    [
      [14, BLACK_MAN],
      [18, WHITE_MAN],
      [10, WHITE_MAN],
    ],
    'black',
  );

  it('muž bere jen vpřed (přes 18), NE vzad (přes 10)', () => {
    expect(asKeys(legalMoves(posCapture, ITALIAN_RULESET))).toEqual(['14->23 [18]']);
    expect(perftRef(fromPosition(posCapture), 1)).toBe(1);
  });

  it('zub: POOL (muž bere vzad) z téže pozice bere OBĚMA směry', () => {
    // Kdyby italský muž bral i vzad, horní test by dostal 2 braní jako pool.
    expect(asKeys(legalMoves(posCapture, POOL_RULESET))).toEqual(['14->23 [18]', '14->7 [10]']);
  });
});

describe('ITALIAN promoteMidCapture:false – muž braním na dámské řadě KONČÍ', () => {
  // Černý muž 22 bere bílého 26, dopadá na 31 (dámská řada, row 7). Za 31 leží
  // bílý muž 27 s prázdným 24 – KDYBY muž po proměně pokračoval jako dáma (vzad),
  // vzniklo by 2-braní {22→...→24} a MAXIMUM by ho vynutilo. Italská vrací
  // 1-braní → muž se promění a STOJÍ (sekvence 2-braní vůbec nevznikne).
  const pos = positionWith(
    [
      [22, BLACK_MAN],
      [26, WHITE_MAN],
      [27, WHITE_MAN],
    ],
    'black',
  );

  it('muž se promění a tah KONČÍ – jen 1-braní, žádné pokračování', () => {
    const moves = legalMoves(pos, ITALIAN_RULESET);
    expect(asKeys(moves)).toEqual(['22->31 [26]']);
    // Explicitně: žádný tah nebere víc než 1 kámen (žádné pokračování po proměně).
    expect(moves.every((m) => m.captures.length === 1)).toBe(true);
    // Nezávislá reference se STOPEM se shoduje.
    expect(perftRef(fromPosition(pos), 1)).toBe(1);
  });

  it('po tahu je na cílovém poli 31 DÁMA (proměna proběhla)', () => {
    const [move] = legalMoves(pos, ITALIAN_RULESET);
    expect(move).toBeDefined();
    const after = applyMove(pos, move!, ITALIAN_RULESET);
    expect(after.board[31 - 1]).toEqual({ color: 'black', kind: 'king' });
  });
});

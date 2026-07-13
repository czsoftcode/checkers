/**
 * Golden testy italského pravidla „pedina non mangia la dama"
 * (`ITALIAN_RULESET.manCannotCaptureKing`): MUŽ nesmí přeskočit soupeřovu DÁMU.
 *
 * Prořez běží už při GENERACI skoků v `extendJumps` (ne post-filtr) – proto se
 * testuje přímo `jumpMovesFrom` (stavební blok generátoru), ne až `legalMoves`.
 * Tato fáze NEDĚLÁ maximum ani prioritu (přijdou v IT-3/IT-4), takže se ověřuje
 * jen tvar skokových sekvencí, ne plná italská legalita partie.
 *
 * ZUBY: případ (c) pouští TOTOŽNOU pozici jako (a) s AMERICAN_RULESET – tam muž
 * dámu PŘESKOČÍ. To dokazuje, že skok reálně existuje a odstranil ho flag-vázaný
 * guard, ne absence skoku ani jiná geometrie. Případy (d)/(e) hlídají, ať se
 * neproříže víc, než má: italská DÁMA bere dámu a italský MUŽ bere muže normálně.
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Color, Position } from '../src/index.js';
import { AMERICAN_RULESET, ITALIAN_RULESET } from '../src/index.js';
import { jumpMovesFrom } from '../src/moves.js';

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
const WHITE_KING: Cell = { color: 'white', kind: 'king' };

describe('ITALIAN manCannotCaptureKing – muž nepřeskočí dámu', () => {
  // (a) Černý muž na 10 má vpřed (SE) soupeřovu DÁMU na 15, za ní PRÁZDNÉ pole 19.
  //     Bez pravidla by to byl legální skok 10→19. S italským flagem ne.
  const manVsKing = positionWith(
    [
      [10, BLACK_MAN],
      [15, WHITE_KING],
    ],
    'black',
  );

  it('(a) muž se před dámou zastaví i s prázdným polem za ní → žádný skok', () => {
    expect(jumpMovesFrom(manVsKing, 10, ITALIAN_RULESET)).toEqual([]);
  });

  it('(c) ZUBY: stejná pozice s AMERICAN_RULESET muže přes dámu PUSTÍ', () => {
    // Guard je flag-vázaný (manCannotCaptureKing=false) → americká je netknutá;
    // skok tedy prokazatelně existuje a v (a) ho odstranil jen italský prořez.
    expect(jumpMovesFrom(manVsKing, 10, AMERICAN_RULESET)).toEqual([
      { from: 10, path: [19], captures: [15] },
    ]);
  });

  // (b) Multi-skok se musí zastavit PŘED dámou i UPROSTŘED sekvence: černý muž
  //     na 10 vezme muže 15 (dopad 19), z 19 by vpřed (SE) přeskočil DÁMU 24
  //     (dopad 28 prázdný). Italsky: sekvence končí na 19; americky: jede na 28.
  const multiJumpIntoKing = positionWith(
    [
      [10, BLACK_MAN],
      [15, WHITE_MAN],
      [24, WHITE_KING],
    ],
    'black',
  );

  it('(b) multi-skok muže se zastaví před dámou (bere muže, dál přes dámu ne)', () => {
    expect(jumpMovesFrom(multiJumpIntoKing, 10, ITALIAN_RULESET)).toEqual([
      { from: 10, path: [19], captures: [15] },
    ]);
  });

  it('(b-zuby) tatáž pozice americky pokračuje přes dámu až na 28', () => {
    expect(jumpMovesFrom(multiJumpIntoKing, 10, AMERICAN_RULESET)).toEqual([
      { from: 10, path: [19, 28], captures: [15, 24] },
    ]);
  });

  // (d) Italská DÁMA bere dámu normálně – guard platí jen na muže (piece.kind).
  const kingVsKing = positionWith(
    [
      [10, BLACK_KING],
      [15, WHITE_KING],
    ],
    'black',
  );

  it('(d) italská dáma bere dámu normálně', () => {
    expect(jumpMovesFrom(kingVsKing, 10, ITALIAN_RULESET)).toEqual([
      { from: 10, path: [19], captures: [15] },
    ]);
  });

  // (e) Italský MUŽ bere muže normálně – prořez se netýká braní muž×muž.
  const manVsMan = positionWith(
    [
      [10, BLACK_MAN],
      [15, WHITE_MAN],
    ],
    'black',
  );

  it('(e) italský muž bere muže normálně', () => {
    expect(jumpMovesFrom(manVsMan, 10, ITALIAN_RULESET)).toEqual([
      { from: 10, path: [19], captures: [15] },
    ]);
  });
});

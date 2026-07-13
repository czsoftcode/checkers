/**
 * Golden testy KVALITATIVNÍ FID PRIORITY (italská varianta,
 * `ITALIAN_RULESET.capturePriority === 'italianFull'`), fáze IT-4.
 *
 * Kaskáda běží AŽ ZA maximem braní (IT-3) a je USPOŘÁDANÁ – další stupeň
 * rozhoduje jen při rovnosti předchozího:
 *   2. dáma > muž (bere-li dáma, mužovy tahy zmizí),
 *   3. nejvíc braných dam,
 *   4. nejdřív braná dáma (index první dámy v sekvenci braní).
 *
 * Každý stupeň má SAMOSTATNOU fixture s „zubem": tatáž pozice se pouští i s
 * italským rulesetem, který se liší JEN `capturePriority: 'none'` – tam se
 * odfiltrovaný tah vrátí, což dokazuje, že ho odstranil FILTR kvality a ne
 * jeho absence (max-filtr zůstává zapnutý v obou). Stupeň 2 navíc kontroluje
 * flag-vázanost přes AMERICAN_RULESET (bez maxima i kvality).
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Color, Move, Position, Ruleset } from '../src/index.js';
import { AMERICAN_RULESET, ITALIAN_RULESET, legalMoves } from '../src/index.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

/** Italský ruleset s VYPNUTOU kvalitou – jinak identický (kontrolní zuby). */
const ITALIAN_NO_QUALITY: Ruleset = { ...ITALIAN_RULESET, capturePriority: 'none' };

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const BLACK_KING: Cell = { color: 'black', kind: 'king' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };
const WHITE_KING: Cell = { color: 'white', kind: 'king' };

/** Stabilní serializace tahu (odkud→kam + brané) pro porovnání MNOŽINY tahů. */
function asKeys(moves: readonly Move[]): string[] {
  return moves
    .map((m) => `${m.from}->${m.path[m.path.length - 1] ?? -1} [${m.captures.join(',')}]`)
    .sort();
}

describe('IT-4 stupeň 2 – dáma > muž (stejný max počet)', () => {
  // Černý muž 9 bere vpřed přes bílého muže 14 na 18 (1 kámen).
  // Černá dáma 22 bere přes bílého muže 26 na 31 (1 kámen). Stejný max = 1.
  const pos = positionWith(
    [
      [9, BLACK_MAN],
      [14, WHITE_MAN],
      [22, BLACK_KING],
      [26, WHITE_MAN],
    ],
    'black',
  );

  it('s kvalitou: zůstane JEN skok dámou, mužův zmizí', () => {
    expect(asKeys(legalMoves(pos, ITALIAN_RULESET))).toEqual(['22->31 [26]']);
  });

  it('zub: bez kvality (jen max) se mužův skok vrátí – oba count 1', () => {
    expect(asKeys(legalMoves(pos, ITALIAN_NO_QUALITY))).toEqual(['22->31 [26]', '9->18 [14]']);
  });

  it('flag-vázanost: AMERICAN (bez maxima i kvality) nechá mužův tah', () => {
    expect(asKeys(legalMoves(pos, AMERICAN_RULESET))).toEqual(['22->31 [26]', '9->18 [14]']);
  });
});

describe('IT-4 stupeň 3 – nejvíc braných dam (stejný počet kamenů)', () => {
  // Obě dámy berou dámu už na indexu 0 → stupeň 4 REMIZUJE a rozhoduje čistě
  // počet dam (stupeň 3). To izoluje stupeň 3: kdyby se vypnul, obě větve
  // (obě první dáma na indexu 0) by přežily i stupeň 4 a test padne.
  //   Černá dáma 1 bere 6, 15 (obojí BÍLÁ DÁMA) → 1→19, 2 dámy, index 0.
  //   Černá dáma 32 bere 27(DÁMA), 18(muž) → 32→14, 1 dáma, index 0.
  // Oba count 2.
  const pos = positionWith(
    [
      [1, BLACK_KING],
      [6, WHITE_KING],
      [15, WHITE_KING],
      [32, BLACK_KING],
      [27, WHITE_KING],
      [18, WHITE_MAN],
    ],
    'black',
  );

  it('s kvalitou: zůstane JEN tah beroucí dvě dámy', () => {
    expect(asKeys(legalMoves(pos, ITALIAN_RULESET))).toEqual(['1->19 [6,15]']);
  });

  it('zub: bez kvality (jen max) zůstanou oba count-2 tahy', () => {
    expect(asKeys(legalMoves(pos, ITALIAN_NO_QUALITY))).toEqual(['1->19 [6,15]', '32->14 [27,18]']);
  });
});

describe('IT-4 stupeň 4 – nejdřív braná dáma (pořadí v sekvenci)', () => {
  // Jedna černá dáma 15, dvě větve stejného počtu (2) i počtu dam (1):
  //   větev A: 15→6→13, bere 10(DÁMA) pak 9(muž) → dáma na indexu 0,
  //   větev B: 15→24→31, bere 19(muž) pak 27(DÁMA) → dáma na indexu 1.
  // Liší se JEN pořadí; přežije A (dřívější dáma). Kdyby captures nebyly v
  // pořadí sekvence, stupeň 4 by vybral opačně – to je smysl této fixture.
  const pos = positionWith(
    [
      [15, BLACK_KING],
      [10, WHITE_KING],
      [9, WHITE_MAN],
      [19, WHITE_MAN],
      [27, WHITE_KING],
    ],
    'black',
  );

  it('s kvalitou: zůstane větev s dřívější dámou (index 0)', () => {
    expect(asKeys(legalMoves(pos, ITALIAN_RULESET))).toEqual(['15->13 [10,9]']);
  });

  it('zub: bez kvality zůstanou obě větve (shodný počet i počet dam)', () => {
    expect(asKeys(legalMoves(pos, ITALIAN_NO_QUALITY))).toEqual([
      '15->13 [10,9]',
      '15->31 [19,27]',
    ]);
  });
});

describe('IT-4 plná shoda – množina přeživších', () => {
  // Dvě černé dámy, každá bere přesně jednu BÍLOU DÁMU (count 1, dam 1,
  // index 0) – shodné ve všech stupních. Kvalita nesmí zúžit na jeden.
  const pos = positionWith(
    [
      [5, BLACK_KING],
      [9, WHITE_KING],
      [8, BLACK_KING],
      [11, WHITE_KING],
    ],
    'black',
  );

  it('oba plně shodné tahy zůstanou (výstup je MNOŽINA)', () => {
    expect(asKeys(legalMoves(pos, ITALIAN_RULESET))).toEqual(['5->14 [9]', '8->15 [11]']);
  });
});

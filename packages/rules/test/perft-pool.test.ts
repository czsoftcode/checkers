/**
 * Perft fixture pro POOL CHECKERS – ověření generátoru pool přes počet listů
 * stromu legálních tahů.
 *
 * ZDROJ OVĚŘENÍ (brána a i b): NEZÁVISLÁ druhá implementace generátoru
 * (`pool-reference-gen.ts`), postavená v souřadnicích (row, col) bez tabulek a
 * číslování knihovny a s vlastní aplikací tahu. Publikovaná ruská 8×8 perft
 * čísla z otevírací pozice se NAJÍT NEPODAŘILA (dostupné jsou jen 10×10
 * mezinárodní – World Draughts Forum), takže brána (a) podle plánu fáze padá
 * na druhou implementaci místo publikovaného zdroje.
 *
 * PRAVIDLA POOL (APCA / en.wikipedia.org/wiki/American_Pool_Checkers,
 * en.wikipedia.org/wiki/Russian_draughts):
 *  - muž bere vpřed i vzad, dáma je létavá, braní povinné ale ne maximální,
 *  - muž, který během braní dosáhne dámské řady, se proměd na dámu a KONČÍ tah.
 * Pool se od ruské liší JEN proměnou uprostřed braní (ruská pokračuje jako dáma).
 *
 * HRANICE DIVERGENCE pool↔ruská (otevírací pozice): první braní muže KONČÍCÍ na
 * dámské řadě se v otevíracím stromu objeví až v hloubce 7 (měřeno, viz test
 * níže). Pro hloubky 1–6 se pool a ruská shodují PROKAZATELNĚ (jediný rozdíl
 * pravidel – proměna uprostřed braní – vůbec nenastane), hloubka 7 je první
 * MOŽNÁ divergence. Kdyby publikovaná ruská čísla existovala, do hloubky 6 by
 * na pool seděla.
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Move, Position } from '../src/index.js';
import {
  AMERICAN_RULESET,
  POOL_RULESET,
  applyMove,
  initialPosition,
  legalMoves,
  perft,
} from '../src/index.js';
import { fromPosition, perftRef } from './pool-reference-gen.js';

function board(cells: [number, 'b' | 'w', 'm' | 'k'][], turn: 'black' | 'white'): Position {
  const b: Cell[] = new Array<Cell>(32).fill(null);
  for (const [sq, col, kind] of cells) {
    b[sq - 1] = {
      color: col === 'b' ? 'black' : 'white',
      kind: kind === 'k' ? 'king' : 'man',
    };
  }
  return { board: b, turn };
}

describe('pool perft – otevírací pozice (brána a)', () => {
  // Zafixovaná pool čísla z výchozí pozice, hloubka 1–8. Nezávisle potvrzena
  // druhou implementací (viz cross-check test). NESMÍ se upravovat podle
  // generátoru – nesedící číslo = chyba v generátoru.
  const EXPECTED_POOL: readonly number[] = [7, 49, 302, 1469, 7482, 37986, 190146, 929902];

  it.each(EXPECTED_POOL.map((nodes, i) => [i + 1, nodes] as const))(
    'perft pool(%i) = %i',
    (depth, nodes) => {
      expect(perft(initialPosition(), depth, POOL_RULESET)).toBe(nodes);
    },
  );

  it('shoda s nezávislou druhou implementací (oracle) do hloubky 8', () => {
    const start = initialPosition();
    for (let d = 1; d <= 8; d++) {
      expect(perft(start, d, POOL_RULESET)).toBe(perftRef(fromPosition(start), d));
    }
  });

  it('pool se od americké liší už v hloubce 5 (braní muže vzad se zapojí)', () => {
    // Kdyby ruleset neproniknul do generátoru, obě čísla by byla stejná.
    const start = initialPosition();
    expect(perft(start, 5, POOL_RULESET)).toBe(7482);
    expect(perft(start, 5, AMERICAN_RULESET)).toBe(7361);
    expect(perft(start, 5, POOL_RULESET)).not.toBe(perft(start, 5, AMERICAN_RULESET));
  });

  it('hranice divergence pool↔ruská: do hloubky 6 žádné braní muže na dámskou řadu', () => {
    // Jediný rozdíl pravidel pool vs ruská je proměna UPROSTŘED braní. Pokud
    // v otevíracím stromu do hloubky 6 žádný muž braním nedosáhne dámské řady,
    // pool a ruská se do hloubky 6 shodují PROKAZATELNĚ. V hloubce 7 první nastane.
    expect(hasManCaptureToPromo(initialPosition(), 6)).toBe(false);
    expect(hasManCaptureToPromo(initialPosition(), 7)).toBe(true);
  });
});

describe('pool proměna uprostřed braní – muž braním na dámské řadě KONČÍ', () => {
  // POZOR na charakter těchto testů: SPRÁVNOST pravidla „stop" NEDOKAZUJE shoda
  // moves.ts s referenční impl (obě sdílejí výklad autora) – tu drží jen externí
  // zdroje (APCA / Wikipedia, viz hlavička). Tyto testy jsou REGRESNÍ ZUBY: velká
  // otevírací fixtura zarážku nechrání (proměna s pokračováním v otevíracím stromu
  // do hloubky 8 nenastane), takže bez tohoto bloku by šla oprava vrátit
  // nedetekovaně. Proto DVĚ nezávislé pozice (černý i bílý muž, jiná pole/směr).
  //
  // Geometrie: z pole na dámské řadě má muž nejvýš JEDNU pokračovací větev
  // (druhá diagonála „vzad" je ta, kterou přišel = braný kámen tam blokuje),
  // proto se šíře záběru dělá druhou pozicí, ne víc směry z jednoho pole.
  const cases: [string, Position, Move[]][] = [
    // Černý muž 22 bere bílého 26, dopadá na 31 (dámská řada). Za 31 leží bílý 27
    // s prázdným 24 – bez zarážky by muž nelegálně pokračoval {path:[31,24]}.
    [
      'černý muž',
      board(
        [
          [22, 'b', 'm'],
          [26, 'w', 'm'],
          [27, 'w', 'm'],
        ],
        'black',
      ),
      [{ from: 22, path: [31], captures: [26] }],
    ],
    // Bílý muž 9 bere černého 6, dopadá na 2 (dámská řada bílého = řada 0). Za 2
    // leží černý 7 s prázdným 11 – zrcadlová situace pro druhou barvu i směr.
    [
      'bílý muž',
      board(
        [
          [9, 'w', 'm'],
          [6, 'b', 'm'],
          [7, 'b', 'm'],
        ],
        'white',
      ),
      [{ from: 9, path: [2], captures: [6] }],
    ],
  ];

  it.each(cases)('%s: legální je jen proměna a stop (nikoli pokračování)', (_name, promo, expected) => {
    const moves = legalMoves(promo, POOL_RULESET);
    expect(moves).toEqual(expected);
    // Explicitně: nelegální „pokračování po proměně" (path > 1) v seznamu NENÍ.
    expect(moves.some((m) => m.path.length > 1)).toBe(false);
  });

  it.each(cases)('%s: zarážka mění strom (má zuby), moves.ts ji implementuje', (_name, promo) => {
    // S proměnou-stop (pool) i moves.ts: hloubka 2 = 2. Bez zarážky by muž vzal
    // OBA soupeřovy kameny naráz (soupeř by neměl kámen) → hloubka 2 = 0. Rozdíl
    // 2≠0 dokazuje, že tuto větev test reálně prochází, ne jen kopii bez pravidla.
    expect(perft(promo, 2, POOL_RULESET)).toBe(2);
    expect(perftRef(fromPosition(promo), 2, true)).toBe(2);
    expect(perftRef(fromPosition(promo), 2, false)).toBe(0);
    expect(perft(promo, 2, POOL_RULESET)).not.toBe(perftRef(fromPosition(promo), 2, false));
  });
});

describe('pool perft – pozice s létavými dámami (brána b)', () => {
  // Ručně postavené pozice s dámami: cross-check moves.ts vs nezávislá impl.
  // Prořezává riziko fáze 95 (klouzavé braní, turecký úder, volba dopadu).
  const positions: [string, Position, readonly number[]][] = [
    // Bílá dáma 32 klouže mezi černými kameny (volba dopadu, mix s dámou soupeře).
    [
      'dáma vs muži + dáma',
      board(
        [
          [32, 'w', 'k'],
          [23, 'b', 'm'],
          [14, 'b', 'm'],
          [10, 'b', 'm'],
          [1, 'b', 'k'],
        ],
        'white',
      ),
      [2, 7, 39, 189, 1239],
    ],
    // Turecký úder: bílá dáma 18 bere 14 (dopad 9), otočí se a bere 6 (dopad 2);
    // kratší větev (jen 14, dopad 5) je taky legální (pool nemá maximum braní).
    [
      'turecký úder (lomené braní)',
      board(
        [
          [18, 'w', 'k'],
          [14, 'b', 'm'],
          [6, 'b', 'm'],
          [26, 'b', 'm'],
        ],
        'white',
      ),
      [2, 6, 40, 217, 1493],
    ],
    // Mix mužů a létavých dam obou stran, černý na tahu.
    [
      'mix mužů a dam',
      board(
        [
          [25, 'w', 'm'],
          [21, 'b', 'k'],
          [18, 'b', 'm'],
          [6, 'w', 'k'],
        ],
        'black',
      ),
      [1, 9, 66, 431, 2846],
    ],
  ];

  it.each(positions)('%s: moves.ts == nezávislá impl (hloubka 1–5)', (_name, pos, expected) => {
    for (let d = 1; d <= 5; d++) {
      const a = perft(pos, d, POOL_RULESET);
      expect(a).toBe(perftRef(fromPosition(pos), d));
      expect(a).toBe(expected[d - 1]);
    }
  });
});

/**
 * Existuje v podstromu do hloubky `depth` z pozice `pos` tah = braní MUŽE
 * končící na dámské řadě? (Slouží k doložení hranice divergence pool↔ruská.)
 * Nezávisle na generátoru počítá řadu dopadu z geometrie 32 polí.
 */
function hasManCaptureToPromo(pos: Position, depth: number): boolean {
  const moves = legalMoves(pos, POOL_RULESET);
  for (const m of moves) {
    if (m.captures.length === 0) {
      continue;
    }
    const from = pos.board[m.from - 1];
    if (from?.kind !== 'man') {
      continue;
    }
    const final = m.path[m.path.length - 1];
    if (final === undefined) {
      continue;
    }
    const row = Math.floor((final - 1) / 4);
    const promoRow = from.color === 'black' ? 7 : 0;
    if (row === promoRow) {
      return true;
    }
  }
  if (depth <= 1) {
    return false;
  }
  for (const m of moves) {
    if (hasManCaptureToPromo(applyMove(pos, m, POOL_RULESET), depth - 1)) {
      return true;
    }
  }
  return false;
}

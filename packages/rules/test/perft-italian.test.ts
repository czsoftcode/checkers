/**
 * Perft BRÁNA pro ITALSKOU dámu (dama italiana, `ITALIAN_RULESET`).
 *
 * ZDROJ OVĚŘENÍ (brána a): NEZÁVISLÁ druhá implementace generátoru
 * (`italian-reference-gen.ts`), postavená v souřadnicích (row, col) bez tabulek
 * a číslování knihovny a s vlastní aplikací tahu, DFS braní a FID kaskádou.
 *
 * TŘETÍ-STRANNÝ ORACLE: publikovaná italská 8×8 perft čísla z otevírací pozice
 * se NAJÍT NEPODAŘILO (timeboxovaná rešerše ve fázi 115 – dostupné jsou jen 10×10
 * mezinárodní a 8×8 americká, viz en.wikipedia.org/wiki/Italian_draughts,
 * damforum.nl, chessprogramming.org/Perft_Results). Stejně jako u pool/ruské tedy
 * brána (a) padá podle plánu fáze na druhou implementaci místo publikovaného
 * italského zdroje.
 *
 * PUBLIKOVANÝ CROSS-CHECK (brána b, ZADARMO): v otevírací pozici jsou samé MUŽI
 * a všechna braní jsou v mělké hloubce jednoznačná (žádná volba délky), takže
 * italská pravidla se NESPUSTÍ a italský strom je IDENTICKÝ s AMERICKÝM. Italská
 * perft 1–5 proto MUSÍ sednout na PUBLIKOVANÁ AMERICKÁ čísla
 * (7/49/302/1469/7361 – en.wikipedia.org/wiki/English_draughts). To je nezávislé
 * ověření proti třetí straně, že se pravidla nespouští, když nemají.
 *
 * BOD DIVERGENCE italská↔americká (MĚŘENO): italská se od americké POPRVÉ
 * rozejde v HLOUBCE 6 (36473 vs 36768). Příčina je VÝHRADNĚ pravidlo MAXIMA
 * braní: v hloubce 6 je ještě žádná dáma na desce (proměna nastává později),
 * takže `manCannotCaptureKing` i kvalitativní kaskáda (dáma > muž) jsou INERTNÍ –
 * doloženo níže tím, že italská BEZ maxima a kvality dává v hloubce 6 přesně
 * americké číslo 36768. Hloubky 1–5 se kryjí, hloubka 6 je první, kde volba
 * délky braní vznikne a maximum ořeže kratší větve.
 *
 * LIMIT NEZÁVISLOSTI (viz discuss fáze 115): druhá implementace píše TÝŽ autor,
 * takže je nezávislá pro MECHANIKU, NE pro VÝKLAD FID kaskády. Sdílené špatné
 * pochopení kvality by se v obou kódech shodlo a perft by to NECHYTIL. Správnost
 * kaskády drží GOLDEN fixtury s ručně spočtenými množinami (italian-max-capture,
 * italian-quality-priority, italian-fixtures), NE tento perft. Proto brána (c)
 * níže pouští několik RUČNĚ OVĚŘENÝCH malých pozic i skrz referenci – ta pak musí
 * dát tentýž počet tahů jako ruční oracle, což dává referenci zuby i na
 * mechanice maxima/kvality nezávisle na knihovně.
 *
 * ZAFIXOVANÁ ČÍSLA SE NEDOLAĎUJÍ podle generátoru – nesedící číslo = chyba
 * v generátoru NEBO v referenci, řeší se hledáním rozdílu, ne přepsáním
 * očekávané hodnoty (viz hlavička perft-russian).
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Color, Position, Ruleset } from '../src/index.js';
import { AMERICAN_RULESET, ITALIAN_RULESET, initialPosition, perft } from '../src/index.js';
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
const WHITE_KING: Cell = { color: 'white', kind: 'king' };

describe('italská perft – otevírací pozice (brána a: nezávislá druhá implementace)', () => {
  // Zafixovaná ITALSKÁ čísla z výchozí pozice, hloubka 1–8. Nezávisle potvrzena
  // druhou implementací (viz cross-check test). NESMÍ se upravovat podle
  // generátoru – nesedící číslo = chyba v generátoru nebo referenci.
  const EXPECTED_ITALIAN: readonly number[] = [7, 49, 302, 1469, 7361, 36473, 177532, 828783];

  it.each(EXPECTED_ITALIAN.map((nodes, i) => [i + 1, nodes] as const))(
    'perft italská(%i) = %i',
    (depth, nodes) => {
      expect(perft(initialPosition(), depth, ITALIAN_RULESET)).toBe(nodes);
    },
  );

  it('shoda s nezávislou druhou implementací (oracle) do hloubky 8', () => {
    const start = initialPosition();
    for (let d = 1; d <= 8; d++) {
      expect(perft(start, d, ITALIAN_RULESET)).toBe(perftRef(fromPosition(start), d));
    }
  });
});

describe('italská perft – cross-check s publikovanou americkou + bod divergence (brána b)', () => {
  // Publikovaná americká čísla (English draughts) z výchozí pozice, hloubka 1–5.
  // Italská se s nimi MUSÍ krýt: samé muži + jednoznačná braní → italská pravidla
  // se nespustí. To je nezávislé ověření proti třetí straně.
  const EXPECTED_AMERICAN_1_5: readonly number[] = [7, 49, 302, 1469, 7361];

  it.each(EXPECTED_AMERICAN_1_5.map((nodes, i) => [i + 1, nodes] as const))(
    'italská(%i) == publikovaná americká %i (pravidla se nespustí)',
    (depth, nodes) => {
      const start = initialPosition();
      expect(perft(start, depth, ITALIAN_RULESET)).toBe(nodes);
      expect(perft(start, depth, AMERICAN_RULESET)).toBe(nodes);
    },
  );

  it('bod divergence: italská se od americké POPRVÉ liší v hloubce 6', () => {
    const start = initialPosition();
    // Do hloubky 5 shoda, v hloubce 6 rozchod. Kdyby maximum neproniklo do
    // generátoru, obě čísla by v hloubce 6 byla stejná (36768).
    for (let d = 1; d <= 5; d++) {
      expect(perft(start, d, ITALIAN_RULESET)).toBe(perft(start, d, AMERICAN_RULESET));
    }
    expect(perft(start, 6, ITALIAN_RULESET)).toBe(36473);
    expect(perft(start, 6, AMERICAN_RULESET)).toBe(36768);
    expect(perft(start, 6, ITALIAN_RULESET)).not.toBe(perft(start, 6, AMERICAN_RULESET));
  });

  it('příčina divergence v hloubce 6 = VÝHRADNĚ maximum (dámy tak mělko nejsou)', () => {
    // Italská bez maxima a bez kvality se od americké liší jen manCannotCaptureKing.
    // V hloubce 6 není na desce žádná dáma → tento bit je inertní → číslo = americké
    // 36768. Rozdíl 36768→36473 (plná italská) tedy dělá jen filtr maxima, ne kvalita
    // ani man-cannot-capture-king. Izoluje příčinu divergence.
    const italianNoMaxNoQuality: Ruleset = {
      ...ITALIAN_RULESET,
      mustCaptureMaximum: false,
      capturePriority: 'none',
    };
    const start = initialPosition();
    expect(perft(start, 6, italianNoMaxNoQuality)).toBe(36768);
    expect(perft(start, 6, ITALIAN_RULESET)).toBe(36473);
  });
});

describe('italská perft – ručně ověřené malé pozice (brána c: reference má zuby i na pravidlech)', () => {
  // Pozice s RUČNĚ spočteným počtem legálních tahů. Oracle = ruční číslo; knihovna
  // (perft depth 1) i nezávislá reference (perftRef depth 1) ho MUSÍ obě trefit.
  // Tím dostává reference zuby i na VÝKLADU maxima/kvality (ne jen na mechanice),
  // nezávisle na knihovně – kdyby reference kvalitu/maximum špatně mechanizovala,
  // její depth-1 by ruční číslo minula.
  const cases: [string, Position, number][] = [
    // MAXIMUM (kvantita): černý muž 5 bere 3 kameny (5→14→23→32 přes 9,18,27),
    // muž 4 bere jen 2 (4→11→20 přes 8,16). Maximum ponechá JEN 3-braní → 1 tah.
    // (Shodná pozice jako italian-max-capture.test.ts, ručně ověřená.)
    [
      'maximum: jen 3-braní přežije',
      positionWith(
        [
          [5, BLACK_MAN],
          [9, WHITE_MAN],
          [18, WHITE_MAN],
          [27, WHITE_MAN],
          [4, BLACK_MAN],
          [8, WHITE_MAN],
          [16, WHITE_MAN],
        ],
        'black',
      ),
      1,
    ],
    // KVALITA stupeň 2 (dáma > muž, stejný max 1): černý muž 9 bere 14 na 18,
    // černá dáma 22 bere 26 na 31. Kvalita nechá JEN dámu → 1 tah.
    [
      'kvalita: dáma > muž → 1 tah',
      positionWith(
        [
          [9, BLACK_MAN],
          [14, WHITE_MAN],
          [22, BLACK_KING],
          [26, WHITE_MAN],
        ],
        'black',
      ),
      1,
    ],
    // KVALITA stupeň 4 (nejdřív braná dáma): jedna černá dáma 15, dvě větve
    // count 2 i počtu dam 1; větev A (15→6→13, bere 10 DÁMU pak 9) má dámu na
    // indexu 0, větev B (15→24→31, bere 19 pak 27 DÁMU) na indexu 1. Přežije A → 1.
    [
      'kvalita: nejdřív braná dáma → 1 tah',
      positionWith(
        [
          [15, BLACK_KING],
          [10, WHITE_KING],
          [9, WHITE_MAN],
          [19, WHITE_MAN],
          [27, WHITE_KING],
        ],
        'black',
      ),
      1,
    ],
    // MNOŽINA (kvalita nesmí přeořezat): dvě černé dámy, každá bere přesně jednu
    // BÍLOU DÁMU (count 1, dam 1, index 0) – shodné ve všech stupních → 2 tahy.
    [
      'množina: dva plně shodné tahy zůstanou → 2 tahy',
      positionWith(
        [
          [5, BLACK_KING],
          [9, WHITE_KING],
          [8, BLACK_KING],
          [11, WHITE_KING],
        ],
        'black',
      ),
      2,
    ],
  ];

  it.each(cases)('%s: knihovna == reference == ruční oracle', (_name, pos, expected) => {
    expect(perft(pos, 1, ITALIAN_RULESET)).toBe(expected);
    expect(perftRef(fromPosition(pos), 1)).toBe(expected);
  });

  it.each(cases)('%s: knihovna == reference i do hloubky 3', (_name, pos) => {
    for (let d = 1; d <= 3; d++) {
      expect(perft(pos, d, ITALIAN_RULESET)).toBe(perftRef(fromPosition(pos), d));
    }
  });
});

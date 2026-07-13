import { describe, expect, it } from 'vitest';
import { AMERICAN_RULESET, ITALIAN_RULESET, POOL_RULESET } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';

import {
  endpointsFor,
  nextTargets,
  resolveChainTo,
  resolveMove,
  targetsFor,
} from '../src/selection.js';

/**
 * UI doklikávání/tažení italské partie (fáze 118, IT-8). `selection.ts` se NEZMĚNIL –
 * legalita teče výhradně z `legalMoves(position, ruleset)`, a IT-3/IT-4 už pro
 * `ITALIAN_RULESET` osekaly tahy na MAXIMUM braní + FID kvalitativní prioritu.
 * Tyto testy dokazují, že UI vrstva ta pravidla ctí AUTOMATICKY, když dostane
 * italský ruleset: nelegální kratší / nepřednostní / mužovo braní nejde ani začít
 * ani dotáhnout, povinná dámina maximální cesta se doklikat i dotáhnout dá.
 *
 * Každý bod má „zub": tatáž pozice s AMERICAN_RULESET (bez maxima i kvality)
 * odfiltrovaný tah VRÁTÍ, takže test padne, kdyby se ruleset do selection nepromítl.
 */

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

// Fixture IT-4 stupeň 2 (dáma > muž, stejný max počet 1): černý muž 9 by bral přes
// bílého 14 na 18, černá dáma 22 bere přes bílého 26 na 31. Kvalita ponechá jen dámu.
// Zdroj: packages/rules/test/italian-quality-priority.test.ts.
const kingBeatsManPos = (): Position =>
  positionWith(
    [
      [9, BLACK_MAN],
      [14, WHITE_MAN],
      [22, BLACK_KING],
      [26, WHITE_MAN],
    ],
    'black',
  );

// Fixture IT-4 stupeň 4: jediná černá dáma 15 s dvouskokem 15→6→13 (bere 10, 9).
// V italské zůstane jen tato větev; americká přidá druhou 15→24→31 (bere 19, 27).
const mandatoryChainPos = (): Position =>
  positionWith(
    [
      [15, BLACK_KING],
      [10, WHITE_KING],
      [9, WHITE_MAN],
      [19, WHITE_MAN],
      [27, WHITE_KING],
    ],
    'black',
  );

describe('IT-8 (a) mužovo nepřednostní braní nejde ani ZAČÍT', () => {
  it('italská: targetsFor(muž 9) == [] – prioritu má dáma, muž zmizí', () => {
    expect(targetsFor(kingBeatsManPos(), 9, ITALIAN_RULESET)).toEqual([]);
  });

  it('italská: povinná dáma 22 má svůj dopad (braní jde zahájit jí)', () => {
    expect(targetsFor(kingBeatsManPos(), 22, ITALIAN_RULESET)).toEqual([31]);
  });

  it('zub: bez italského rulesetu (americký default) mužovo braní 9→18 je legální', () => {
    // Kdyby selection ruleset ignorovala, obě sady by byly stejné a bod (a) by neměl zub.
    expect(targetsFor(kingBeatsManPos(), 9)).toEqual([18]);
  });
});

describe('IT-8 (b) povinná dámina maximální cesta se doklikat i dokončit dá', () => {
  it('italská: nextTargets vede hop po hopu celou cestou 15→6→13', () => {
    const pos = mandatoryChainPos();
    expect(nextTargets(pos, 15, [], ITALIAN_RULESET)).toEqual([6]); // první dopad
    expect(nextTargets(pos, 15, [6], ITALIAN_RULESET)).toEqual([13]); // druhý dopad
    expect(nextTargets(pos, 15, [6, 13], ITALIAN_RULESET)).toEqual([]); // konec – hotovo
  });

  it('italská: nabídnutá je JEN maximální větev, ne americká 15→24 odbočka', () => {
    // Zub proti tomu, že by italská nabídla i nepřednostní/jinou větev.
    expect(nextTargets(mandatoryChainPos(), 15, [], ITALIAN_RULESET)).not.toContain(24);
    // Zub naopak: bez italského rulesetu (default) druhá větev existuje.
    expect(nextTargets(mandatoryChainPos(), 15, [])).toContain(24);
  });

  it('italská: resolveMove na plné cestě vydá ten legální tah včetně obou braní', () => {
    expect(resolveMove(mandatoryChainPos(), 15, [6, 13], ITALIAN_RULESET)).toEqual({
      from: 15,
      path: [6, 13],
      captures: [10, 9],
    });
  });

  it('italská: rozpracovaná předpona (jen první dopad) ještě není hotový tah', () => {
    expect(resolveMove(mandatoryChainPos(), 15, [6], ITALIAN_RULESET)).toBeNull();
  });
});

describe('IT-8 (c) drag: endpoint kratšího/mužova braní není v endpointsFor', () => {
  it('italská: endpointsFor(muž 9) == [] – tažení mužem nejde pustit nikam', () => {
    expect(endpointsFor(kingBeatsManPos(), 9, ITALIAN_RULESET)).toEqual([]);
  });

  it('italská: endpoint mužova braní (18) není koncem ŽÁDNÉHO legálního tahu', () => {
    const allEnds = [
      ...endpointsFor(kingBeatsManPos(), 9, ITALIAN_RULESET),
      ...endpointsFor(kingBeatsManPos(), 22, ITALIAN_RULESET),
    ];
    expect(allEnds).not.toContain(18);
    expect(endpointsFor(kingBeatsManPos(), 22, ITALIAN_RULESET)).toEqual([31]); // jen dáma
  });

  it('zub: bez italského rulesetu (default) je 18 legálním koncem tažení mužem', () => {
    expect(endpointsFor(kingBeatsManPos(), 9)).toContain(18);
  });

  // resolveChainTo je funkce, kterou controller SKUTEČNĚ používá při puštění kamene
  // rovnou na koncové pole (drag-drop). endpointsFor jen zvýrazňuje; tady se řeší
  // reálná legalita dokončení tažení – proto italský zub testujeme i na ní.
  it('italská: drag dámy na koncové pole 13 (maximální cesta) dohledá celý řetěz', () => {
    expect(resolveChainTo(mandatoryChainPos(), 15, [], 13, ITALIAN_RULESET)).toEqual({
      from: 15,
      path: [6, 13],
      captures: [10, 9],
    });
  });

  it('italská: drag na koncové pole nepřednostní americké větve (31) NEJDE dotáhnout', () => {
    // 15→24→31 je legální jen v americké/pool; italská ho zahodí → resolveChainTo null.
    expect(resolveChainTo(mandatoryChainPos(), 15, [], 31, ITALIAN_RULESET)).toBeNull();
    // Zub: bez italského rulesetu (default) se tentýž drag na 31 dohledá.
    expect(resolveChainTo(mandatoryChainPos(), 15, [], 31)).not.toBeNull();
  });
});

describe('IT-8 (d) regrese: neitalské varianty selection nezměněny', () => {
  // selection.ts se nezměnil – narrowing je vázaný na ITALIAN_RULESET, ne globální.
  // Na téže pozici musí neitalské varianty nechat i americkou větev 15→24 (kterou
  // italská kvalita zahazuje), zatímco italská nabídne JEN maximální/přednostní 15→6.
  it('american exact {6,24}, pool oba směry (6 i 24), italská jen 6', () => {
    const pos = mandatoryChainPos();
    expect(new Set(nextTargets(pos, 15, [], AMERICAN_RULESET))).toEqual(new Set([6, 24]));
    // Pool má létavou dámu → nabídek víc, ale OBĚ neitalské větve (6 i 24) zůstávají.
    const poolNext = nextTargets(pos, 15, [], POOL_RULESET);
    expect(poolNext).toContain(6);
    expect(poolNext).toContain(24);
    // Italská naopak větev 24 zahodí (nepřednostní) – narrowing je jen její.
    expect(nextTargets(pos, 15, [], ITALIAN_RULESET)).toEqual([6]);
  });

  it('explicitní AMERICAN_RULESET == implicitní default (nextTargets i endpointsFor)', () => {
    const pos = mandatoryChainPos();
    expect(nextTargets(pos, 15, [], AMERICAN_RULESET)).toEqual(nextTargets(pos, 15, []));
    expect(endpointsFor(pos, 15, AMERICAN_RULESET)).toEqual(endpointsFor(pos, 15));
  });

  it('american endpointsFor dvojskoku vrátí oba konce (13 i 31); pool je nadmnožina', () => {
    const pos = mandatoryChainPos();
    expect(new Set(endpointsFor(pos, 15, AMERICAN_RULESET))).toEqual(new Set([13, 31]));
    // Létavá pool dáma přidá další konce, ale americké 13 i 31 mezi nimi zůstávají.
    const poolEnds = endpointsFor(pos, 15, POOL_RULESET);
    expect(poolEnds).toContain(13);
    expect(poolEnds).toContain(31);
  });
});

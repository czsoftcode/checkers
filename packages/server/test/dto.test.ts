/**
 * Jednotkové testy čistých helperů: serializace stavu + hledání legálního tahu.
 * Reálný kód `rules` (legalMoves, gameResultFromState), žádné mocky – findLegalMove
 * je jádro autority serveru a musí sedět na skutečném generátoru tahů.
 */

import { describe, expect, it } from 'vitest';

import { AMERICAN_RULESET, initialGameState, legalMoves, rulesetForVariant } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { findLegalMove, moveToDto, pvpGameToDto } from '../src/index.js';

/** Postaví pozici z výčtu obsazených polí; zbytek desky je prázdný. */
function positionWith(pieces: readonly (readonly [number, Cell])[], turn: Color): Position {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (const [square, cell] of pieces) {
    board[square - 1] = cell;
  }
  return { board, turn };
}

const BLACK_MAN: Cell = { color: 'black', kind: 'man' };
const WHITE_MAN: Cell = { color: 'white', kind: 'man' };
const BLACK_KING: Cell = { color: 'black', kind: 'king' };

describe('pvpGameToDto', () => {
  it('PvP tvar: mode pvp, pozice/turn/result/legalMoves/reason, žádná engine pole', () => {
    const dto = pvpGameToDto('g1', initialGameState(), 'ongoing', null);
    expect(dto.mode).toBe('pvp');
    expect(dto.id).toBe('g1');
    expect(dto.position.turn).toBe('black');
    expect(dto.result).toBe('ongoing');
    expect(dto.reason).toBeNull();
    expect(dto.legalMoves).toHaveLength(7);
    // Engine-specifická pole na PvP DTO NESMÍ existovat (ne falešně null) – kdyby
    // se sem protáhla, klient by je omylem četl jako platný stav enginu/úrovně.
    // `reason` je NAOPAK součástí PvP kontraktu (fáze 78), tak musí být přítomné.
    const keys = Object.keys(dto).sort();
    expect(keys).toEqual(['id', 'legalMoves', 'mode', 'position', 'reason', 'result']);
  });

  it('result se PŘEDÁVÁ zvenčí (efektivní výsledek), DTO ho neodvozuje', () => {
    // Rozehraná pozice, ale vnucený výsledek (simulace budoucího konce PvP).
    const dto = pvpGameToDto('g2', initialGameState(), 'black-wins', 'resign');
    expect(dto.result).toBe('black-wins');
    expect(dto.position.turn).toBe('black');
  });

  it('reason se PŘEDÁVÁ zvenčí do drátu (identita) – vzdání, dohoda, pravidla', () => {
    // Důvod konce je pár k result (fáze 78): DTO ho jen serializuje tak, jak ho
    // volající předá. Kdyby ho DTO ignorovalo nebo přepsalo, výherce by u vzdané
    // partie neviděl, PROČ vyhrál – tenhle test to hlídá pro všechny tři důvody.
    expect(pvpGameToDto('r', initialGameState(), 'white-wins', 'resign').reason).toBe('resign');
    expect(pvpGameToDto('d', initialGameState(), 'draw', 'draw-agreement').reason).toBe('draw-agreement');
    expect(pvpGameToDto('p', initialGameState(), 'draw', 'rules').reason).toBe('rules');
  });
});

describe('moveToDto', () => {
  it('vrací kopie polí (ne readonly odkaz na Move z rules)', () => {
    const [move] = legalMoves(initialGameState().position);
    if (move === undefined) {
      throw new Error('výchozí pozice musí mít legální tah');
    }
    const dto = moveToDto(move);
    expect(dto).toEqual({ from: move.from, path: [...move.path], captures: [...move.captures] });
    // Kopie, ne sdílený odkaz.
    expect(dto.path).not.toBe(move.path);
  });
});

describe('findLegalMove – match zadání klienta proti reálným legalMoves', () => {
  it('prostý tah z výchozí pozice se najde a doplní prázdné captures', () => {
    const position = initialGameState().position;
    // 9→13 je legální otevírací tah černého muže.
    const move = findLegalMove(position, 9, [13]);
    expect(move).toBeDefined();
    expect(move?.from).toBe(9);
    expect(move?.path).toEqual([13]);
    expect(move?.captures).toEqual([]);
  });

  it('nesedící cesta vrací undefined (žádný legální tah)', () => {
    const position = initialGameState().position;
    // Setrvání na místě není tah – server ho nesmí najít.
    expect(findLegalMove(position, 9, [9])).toBeUndefined();
    // Tah druhé strany (bílý kámen, když je na tahu černý).
    expect(findLegalMove(position, 23, [18])).toBeUndefined();
    // Neexistující výchozí pole.
    expect(findLegalMove(position, 15, [19])).toBeUndefined();
  });

  it('při povinném braní se prostý tah stejného kamene NENAJDE', () => {
    // Černý muž na 9, bílý na 14: povinný skok 9x18. Prostý tah je potlačen.
    const position = positionWith([[9, BLACK_MAN], [14, WHITE_MAN]], 'black');
    expect(findLegalMove(position, 9, [13])).toBeUndefined();
    const jump = findLegalMove(position, 9, [18]);
    expect(jump).toBeDefined();
    // captures si odvodil server z generátoru, klient je neposílal.
    expect(jump?.captures).toEqual([14]);
  });

  it('vícenásobný skok: plná cesta dopadů rozhoduje, ne jen výchozí pole', () => {
    // Kruh: černá dáma 18, bílí muži 6,7,14,15. Dva legální tahy – oba obkrouží
    // kruh a vrátí se na 18, liší se POŘADÍM cesty.
    const position = positionWith(
      [[18, BLACK_KING], [6, WHITE_MAN], [7, WHITE_MAN], [14, WHITE_MAN], [15, WHITE_MAN]],
      'black',
    );

    // path OBSAHUJE výchozí pole (dáma se vrací na 18) – match musí zvládnout
    // path === from na konci sekvence.
    const forward = findLegalMove(position, 18, [9, 2, 11, 18]);
    expect(forward).toBeDefined();
    expect(forward?.captures).toEqual([14, 6, 7, 15]);

    // Opačné pořadí je JINÝ legální tah (stejná množina polí, jiné pořadí).
    // Kdyby match dedupoval přes Set, spletl by si je – proto deep-equal.
    const backward = findLegalMove(position, 18, [11, 2, 9, 18]);
    expect(backward).toBeDefined();
    expect(backward?.captures).toEqual([15, 7, 6, 14]);

    // Neúplná cesta (jen část kruhu) legální není – nesmí se strefit do plné.
    expect(findLegalMove(position, 18, [9, 2, 11])).toBeUndefined();
  });
});

describe('findLegalMove – bezpečnostní hranice podle varianty (todo 56 / fáze 103)', () => {
  // Bílý muž na 14 je ZA ZÁDY černého muže na 18 → braní vzad (18x9). Americká
  // pravidla ho nedovolí, ruská ano. `findLegalMove` MUSÍ dostat ruleset varianty
  // záznamu – jinak by server (autorita) přijal nelegální tah v dané variantě.
  const backward = positionWith([[18, BLACK_MAN], [14, WHITE_MAN]], 'black');

  it('americká pravidla: braní vzad NENÍ legální tah (undefined)', () => {
    expect(findLegalMove(backward, 18, [9], AMERICAN_RULESET)).toBeUndefined();
    // Default parametru se chová jako americká (zpětná kompat volajících bez varianty).
    expect(findLegalMove(backward, 18, [9])).toBeUndefined();
  });

  it('ruská pravidla: braní vzad JE legální a server si odvodí braného soupeře', () => {
    const move = findLegalMove(backward, 18, [9], rulesetForVariant('russian'));
    expect(move).toBeDefined();
    expect(move?.from).toBe(18);
    expect(move?.path).toEqual([9]);
    expect(move?.captures).toEqual([14]);
  });
});

import { describe, expect, it } from 'vitest';

import type { Move } from '../src/index.js';
import { formatMove, parseMove } from '../src/index.js';

const SIMPLE: Move = { from: 22, path: [18], captures: [] };
const SINGLE_JUMP: Move = { from: 10, path: [19], captures: [15] };
const TRIPLE_JUMP: Move = { from: 1, path: [10, 19, 28], captures: [6, 15, 24] };
// Kruhový skok dámy s návratem na from – fixture z testů applyMove (fáze 6).
const CIRCULAR_JUMP: Move = { from: 18, path: [9, 2, 11, 18], captures: [14, 6, 7, 15] };

describe('formatMove – Move do PDN textu', () => {
  it('prostý tah', () => {
    expect(formatMove(SIMPLE)).toBe('22-18');
  });

  it('jednoduchý skok', () => {
    expect(formatMove(SINGLE_JUMP)).toBe('10x19');
  });

  it('vícenásobný skok', () => {
    expect(formatMove(TRIPLE_JUMP)).toBe('1x10x19x28');
  });

  it('kruhový skok dámy s opakovaným polem v path', () => {
    expect(formatMove(CIRCULAR_JUMP)).toBe('18x9x2x11x18');
  });

  it('strukturálně nesmyslný tah odmítá RangeError (žádné tiché vyprání)', () => {
    // Prázdná path.
    expect(() => formatMove({ from: 22, path: [], captures: [] })).toThrow(RangeError);
    // Prostý tah s více dopady.
    expect(() => formatMove({ from: 22, path: [18, 15], captures: [] })).toThrow(RangeError);
    // Prostý tah na nesousední pole (teleport).
    expect(() => formatMove({ from: 22, path: [10], captures: [] })).toThrow(RangeError);
    // Počet braní nesedí na počet dopadů.
    expect(() => formatMove({ from: 10, path: [19], captures: [15, 6] })).toThrow(RangeError);
    // Deklarované brané pole neodpovídá geometrii skoku.
    expect(() => formatMove({ from: 10, path: [19], captures: [14] })).toThrow(RangeError);
    // Krok bez skokové geometrie (sousedící pole nejsou skok).
    expect(() => formatMove({ from: 22, path: [18], captures: [18] })).toThrow(RangeError);
    // Duplicitní braní s korektní geometrií (kruh tam a zpět přes stejný
    // kámen) – porušuje kontrakt typu Move, nesmí se tiše serializovat.
    expect(() => formatMove({ from: 10, path: [19, 10], captures: [15, 15] })).toThrow(RangeError);
  });
});

describe('parseMove – PDN text do Move', () => {
  it('prostý tah', () => {
    expect(parseMove('22-18')).toEqual(SIMPLE);
  });

  it('jednoduchý skok dopočítá brané pole', () => {
    expect(parseMove('10x19')).toEqual(SINGLE_JUMP);
  });

  it('vícenásobný skok dopočítá všechna braná pole v pořadí', () => {
    expect(parseMove('1x10x19x28')).toEqual(TRIPLE_JUMP);
  });

  it('kruhový skok dámy včetně návratu na from', () => {
    expect(parseMove('18x9x2x11x18')).toEqual(CIRCULAR_JUMP);
  });

  it('nesmyslný zápis odmítá RangeError', () => {
    const invalid = [
      '', // prázdný text
      '22', // jediné pole, žádný oddělovač
      '2218', // žádný oddělovač
      '22-18x10', // smíšené oddělovače
      '22-18-15', // prostý tah se 3 poli
      '22-', // chybějící druhé pole
      'x19', // chybějící první pole
      '0-5', // pole 0 neexistuje
      '33x24', // pole mimo 1-32
      '05-09', // vedoucí nuly nejsou platný token
      'ab-cd', // cizí znaky
      ' 22-18', // bílé znaky se tiše neořezávají
      '22-9', // prostý tah na nesousední pole
      '22x18', // sousedící pole nejsou skok
      '10x19x10', // stejné pole (15) přeskočené dvakrát
    ];
    for (const text of invalid) {
      expect(() => parseMove(text), `zápis „${text}" měl být odmítnut`).toThrow(RangeError);
    }
  });
});

describe('round-trip na ručních fixtures', () => {
  it('parseMove(formatMove(move)) vrací identický tah', () => {
    for (const move of [SIMPLE, SINGLE_JUMP, TRIPLE_JUMP, CIRCULAR_JUMP]) {
      expect(parseMove(formatMove(move))).toEqual(move);
    }
  });
});

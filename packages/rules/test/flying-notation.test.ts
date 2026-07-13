import { describe, expect, it } from 'vitest';

import type { Move, Ruleset } from '../src/index.js';
import { formatMove, parseMove } from '../src/index.js';

const FLYING: Ruleset = {
  manCaptureBackward: false,
  king: 'flying',
  promoteMidCapture: false,
  kingCapturePriority: false,
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
};

describe('notace – klouzavý prostý tah létavé dámy', () => {
  it('formatMove zapíše dlouhý prostý tah pomlčkou (18-5)', () => {
    const move: Move = { from: 18, path: [5], captures: [] };
    expect(formatMove(move, FLYING)).toBe('18-5');
  });

  it('parseMove přečte dlouhý prostý tah po diagonále', () => {
    expect(parseMove('18-5', FLYING)).toEqual({ from: 18, path: [5], captures: [] });
  });

  it('roundtrip Move → text → Move pro dlouhý tah je identita', () => {
    const move: Move = { from: 18, path: [5], captures: [] };
    expect(parseMove(formatMove(move, FLYING), FLYING)).toEqual(move);
  });

  it('flying relaxace je strukturální: mimo diagonálu (18-19) odmítne obojí', () => {
    const teleport: Move = { from: 18, path: [19], captures: [] };
    expect(() => formatMove(teleport, FLYING)).toThrow(RangeError);
    expect(() => parseMove('18-19', FLYING)).toThrow(RangeError);
  });

  it("king:'short' (default) dlouhý prostý tah NEpřijme (americká notace beze změny)", () => {
    const move: Move = { from: 18, path: [5], captures: [] };
    expect(() => formatMove(move)).toThrow(RangeError);
    expect(() => parseMove('18-5')).toThrow(RangeError);
    // Krátký tah projde v obou variantách stejně.
    expect(formatMove({ from: 18, path: [14], captures: [] })).toBe('18-14');
    expect(formatMove({ from: 18, path: [14], captures: [] }, FLYING)).toBe('18-14');
  });
});

/** Pool ruleset = zdroj pravdy fáze pro klouzavé braní (jako flying-capture.test). */
const POOL: Ruleset = {
  manCaptureBackward: true,
  king: 'flying',
  promoteMidCapture: false,
  kingCapturePriority: false,
  mustCaptureMaximum: false,
  capturePriority: 'none',
  manCannotCaptureKing: false,
};

describe('notace – klouzavé braní létavé dámy (formatMove)', () => {
  it('dlouhé braní: brané pole se nepíše, výstup je jen dopad (4x18)', () => {
    // Dáma 4, bílý na 15 (SW paprsek 4→8,11,15,18), dopad 18. Braný 15 leží
    // uprostřed segmentu, do PDN se NEzapíše – jen [from, ...path].join('x').
    const move: Move = { from: 4, path: [18], captures: [15] };
    expect(formatMove(move, POOL)).toBe('4x18');
  });

  it('vzdálený dopad na stejném paprsku (4x29) – braný kámen 15 dál mlčí', () => {
    // Stejný braný kámen 15, dopad až na konci paprsku (4→...→29). Notace se
    // NEmění podle vzdálenosti dopadu, brané pole se nepíše ani teď.
    const move: Move = { from: 4, path: [29], captures: [15] };
    expect(formatMove(move, POOL)).toBe('4x29');
  });

  it('vícenásobné braní: dva segmenty, jen dopady (25x18x4)', () => {
    // Dáma 25 sebere 22 (dopad 18) a pak 11 (dopad 4). Oba brané kameny leží
    // na svém segmentu, do PDN jdou jen pole dopadu.
    const move: Move = { from: 25, path: [18, 4], captures: [22, 11] };
    expect(formatMove(move, POOL)).toBe('25x18x4');
  });

  it('ray větev přijme i krátké braní muže v poolu (segment délky 2)', () => {
    // Muž 10 sebere 15 (SE), dopad 19. Segment raySquares(10,19)=[15,19] má
    // délku 2; braný 15 leží těsně před dopadem. Flying větev to přijme stejně.
    const move: Move = { from: 10, path: [19], captures: [15] };
    expect(formatMove(move, POOL)).toBe('10x19');
  });

  it('braný kámen mimo segment (teleport braní) odmítne RangeError', () => {
    // 33 mimo desku by neprošlo dřív, tak vezmeme reálné pole 20, které na
    // paprsku 4→18 neleží – strukturálně nesmyslné captures.
    const move: Move = { from: 4, path: [18], captures: [20] };
    expect(() => formatMove(move, POOL)).toThrow(RangeError);
  });

  it('braný kámen rovný poli dopadu odmítne RangeError', () => {
    // captures[i] === landing: dopad na brané pole je nesmysl (i když leží na
    // segmentu jako jeho poslední prvek).
    const move: Move = { from: 4, path: [18], captures: [18] };
    expect(() => formatMove(move, POOL)).toThrow(RangeError);
  });
});

describe('notace – parseMove klouzavého braní je VĚDOMĚ mimo řez', () => {
  it('dlouhé létavé braní z textu VYHODÍ RangeError (brané kameny nejdou rekonstruovat)', () => {
    // formatMove({4,[29],[15]}) → "4x29". Zpětné parseMove nevidí desku a na
    // segmentu 4→29 může stát víc kamenů; jumpedSquareBetween(4,29)=null →
    // RangeError. Dokumentuje záměrnou mezeru: PDN se u létavé dámy nečte zpět.
    expect(formatMove({ from: 4, path: [29], captures: [15] }, POOL)).toBe('4x29');
    expect(() => parseMove('4x29', POOL)).toThrow(RangeError);
  });
});

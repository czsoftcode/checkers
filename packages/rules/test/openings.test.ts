import { describe, expect, it } from 'vitest';

import type { Ballot, Color, Position } from '../src/index.js';
import { THREE_MOVE_BALLOTS, playBallot } from '../src/index.js';

/** Spočítá kameny dané barvy na desce (muži i dámy). */
function countPieces(position: Position, color: Color): number {
  return position.board.filter((cell) => cell?.color === color).length;
}

describe('THREE_MOVE_BALLOTS – datový seznam', () => {
  it('obsahuje přesně 156 zahájení', () => {
    expect(THREE_MOVE_BALLOTS).toHaveLength(156);
  });

  it('neobsahuje duplicity', () => {
    const keys = THREE_MOVE_BALLOTS.map((ballot) =>
      ballot.map((ply) => `${String(ply.from)}-${String(ply.to)}`).join(' '),
    );
    expect(new Set(keys).size).toBe(THREE_MOVE_BALLOTS.length);
  });

  it('každé zahájení jsou právě tři půltahy', () => {
    for (const ballot of THREE_MOVE_BALLOTS) {
      expect(ballot).toHaveLength(3);
    }
  });
});

describe('playBallot – odehrání přes reálná pravidla', () => {
  it('odehraje všech 156 ballotů a splní invarianty zahájení', () => {
    for (const ballot of THREE_MOVE_BALLOTS) {
      const { position, moves } = playBallot(ballot);
      // tři reálné odehrané tahy
      expect(moves).toHaveLength(3);
      // vrácené tahy MUSÍ odpovídat požadovaným půltahům ballotu
      // (jinak by refaktor mohl tiše vrátit jiný tah, než jaký odehrál)
      for (let i = 0; i < 3; i++) {
        expect(moves[i]?.from).toBe(ballot[i]?.from);
        expect(moves[i]?.path.at(-1)).toBe(ballot[i]?.to);
      }
      // po třech půltazích (černý, bílý, černý) je na tahu bílý
      expect(position.turn).toBe<Color>('white');
      // černý o žádný kámen nepřijde (bílý po 1 tahu nemá co brát);
      // bílý přijde nanejvýš o jeden (8 „cross" zahájení bere na 3. půltahu)
      expect(countPieces(position, 'black')).toBe(12);
      expect(countPieces(position, 'white')).toBeGreaterThanOrEqual(11);
      expect(countPieces(position, 'white')).toBeLessThanOrEqual(12);
    }
  });

  it('u „cross" zahájení (Double Cross) odehraje 3. půltah jako braní', () => {
    // rank 1: 9-14 23-18 14x23 – bílý ztratí kámen
    const doubleCross = THREE_MOVE_BALLOTS[0]!;
    const { position, moves } = playBallot(doubleCross);
    expect(moves[2]?.captures).toHaveLength(1);
    expect(countPieces(position, 'white')).toBe(11);
  });

  // --- zuby: nelegální / neexistující cíl musí spadnout, ne projít potichu ---

  it('vyhodí RangeError, když cílové pole půltahu není legální tah', () => {
    // reálné první dva půltahy, ale 3. cíl je mimo dosah (černý muž na 14
    // se v žádném legálním tahu nedostane na pole 31)
    const broken: Ballot = [
      { from: 9, to: 14 },
      { from: 23, to: 18 },
      { from: 14, to: 31 },
    ];
    expect(() => playBallot(broken)).toThrow(RangeError);
    expect(() => playBallot(broken)).toThrow(/legálních shod/);
  });

  it('vyhodí RangeError, když z pole žádný legální tah nevede', () => {
    // černý muž na poli 5 je na startu zablokovaný (pole 9 obsazené)
    const broken: Ballot = [
      { from: 5, to: 9 },
      { from: 23, to: 18 },
      { from: 11, to: 15 },
    ];
    expect(() => playBallot(broken)).toThrow(RangeError);
  });
});

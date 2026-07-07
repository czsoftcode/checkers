/**
 * Los a nasazení třítahového zahájení (3-move ballot) pro úroveň Mistrovství.
 *
 * Zuby: testy přehrávají REÁLNOU cestou rules (`playBallot` + `advanceState`
 * uvnitř `GameStore.create`), ne mock. Kdyby store ballot nenasadil, nasadil
 * ho jinak než přes rules, nebo spletl index, invarianty i deterministický los
 * spadnou. RNG se injektuje seedovaný/řízený, aby byl los reprodukovatelný.
 */

import { describe, expect, it } from 'vitest';

import { THREE_MOVE_BALLOTS, playBallot } from '@checkers/rules';
import type { Ballot, Color, Position } from '@checkers/rules';
import { GameStore, mulberry32 } from '../src/index.js';

/** Počet kamenů dané barvy na desce (board má 32 polí, Cell = Piece | null). */
function countPieces(position: Position, color: Color): number {
  return position.board.filter((cell) => cell?.color === color).length;
}

describe('GameStore – los ballotu Mistrovství', () => {
  it('deck má 156 zahájení (kontrola proti tichému oříznutí)', () => {
    expect(THREE_MOVE_BALLOTS).toHaveLength(156);
  });

  it('deterministický los: stejný seed → stejný ballotIndex, a index je v rozsahu decku', () => {
    const a = new GameStore(mulberry32(12345)).create('championship');
    const b = new GameStore(mulberry32(12345)).create('championship');
    expect(a.ballotIndex).toBe(b.ballotIndex);
    expect(a.ballotIndex).not.toBeNull();
    expect(a.ballotIndex).toBeGreaterThanOrEqual(0);
    expect(a.ballotIndex).toBeLessThan(THREE_MOVE_BALLOTS.length);
    // Jiný seed může (ne musí) dát jiný ballot – aspoň že los na seedu závisí:
    const c = new GameStore(mulberry32(999)).create('championship');
    // Nesmí být natvrdo pořád 0 apod. – aspoň jeden ze dvou seedů se má lišit
    // od pevného indexu 0, jinak by „los" byl konstanta. (Slabý, ale levný zub.)
    expect([a.ballotIndex, c.ballotIndex].some((i) => i !== 0)).toBe(true);
  });

  it('po ballotu: bílý na tahu, černých 12, bílých 11–12, tři tahy v historii', () => {
    const rec = new GameStore(mulberry32(7)).create('championship');
    expect(rec.state.position.turn).toBe('white');
    expect(countPieces(rec.state.position, 'black')).toBe(12);
    expect(countPieces(rec.state.position, 'white')).toBeGreaterThanOrEqual(11);
    expect(countPieces(rec.state.position, 'white')).toBeLessThanOrEqual(12);
    expect(rec.moves).toHaveLength(3);
    expect(rec.engineStatus).toBe('idle');
  });

  it('VŠECH 156 ballotů se nasadí legální pozicí (reálná cesta rules pro každý index)', () => {
    // Řízený rng → floor(((i+0.5)/len)*len) === i pro každé i (střed intervalu,
    // odolný vůči zaokrouhlení – i/len by u některých i floorlo o 1 níž). Tím
    // projdeme každý ballot decku. Silný zub: kdyby `create` obešel
    // playBallot/advanceState nebo měl offset v indexu, na některém zahájení
    // invariant spadne (8 z nich má braní na 3. půltahu → bílých 11, ne 12).
    const len = THREE_MOVE_BALLOTS.length;
    for (let i = 0; i < len; i++) {
      const rec = new GameStore(() => (i + 0.5) / len).create('championship');
      expect(rec.ballotIndex).toBe(i);
      expect(rec.state.position.turn).toBe('white');
      expect(countPieces(rec.state.position, 'black')).toBe(12);
      const white = countPieces(rec.state.position, 'white');
      expect(white === 11 || white === 12).toBe(true);
      expect(rec.moves).toHaveLength(3);
    }
  });

  it('neballotová úroveň: výchozí rozestavění, černý na tahu, ballotIndex null, žádné tahy', () => {
    for (const level of ['professional', 'intermediate', 'beginner', 'education'] as const) {
      const rec = new GameStore(mulberry32(1)).create(level);
      expect(rec.ballotIndex).toBeNull();
      expect(rec.state.position.turn).toBe('black');
      expect(countPieces(rec.state.position, 'black')).toBe(12);
      expect(countPieces(rec.state.position, 'white')).toBe(12);
      expect(rec.moves).toEqual([]);
    }
  });

  it('rozbitý rng (hodnota mimo [0,1)) → index mimo deck → create("championship") throwuje hlasitě', () => {
    // rng vrátí 1.0 → floor(1.0 * len) === len → THREE_MOVE_BALLOTS[len] === undefined.
    // Guard v seedBallot to musí odhalit jako programovou chybu (RangeError),
    // ne tiše nasadit nedefinovaný ballot (TypeError uvnitř playBallot) ani
    // spustit partii bez zahájení.
    const store = new GameStore(() => 1);
    expect(() => store.create('championship')).toThrow(RangeError);
    // Neballotové úrovně se rozbitým rng nezajímají (los se nekoná).
    expect(() => store.create('professional')).not.toThrow();
  });
});

describe('GameStore – fixní ballot podle indexu (kolo 2 Mistrovství)', () => {
  it('create s ballotIndex nasadí PRÁVĚ ten ballot, ne los', () => {
    // Zub: rng napevno na index 0 (`() => 0`). Kdyby create fixní index ignoroval
    // a losoval, dostali bychom ballot 0 – test spadne. k je jiné než 0.
    const k = 42;
    const expected: Ballot | undefined = THREE_MOVE_BALLOTS[k];
    if (expected === undefined) {
      throw new Error(`test předpokládá index ${String(k)} v decku délky ${String(THREE_MOVE_BALLOTS.length)}`);
    }
    const rec = new GameStore(() => 0).create('championship', 'black', k);
    expect(rec.ballotIndex).toBe(k);
    // Tahy v historii = reálné odehrání ballotu k přes rules (ne ballotu 0).
    expect(rec.moves).toEqual(playBallot(expected).moves);
    expect(rec.moves).toHaveLength(3);
    expect(rec.state.position.turn).toBe('white');
  });

  it('fixní ballot je barvově agnostický: stejný index, obě barvy → stejné tahy', () => {
    // Kolo 1 (člověk černý) i kolo 2 (člověk bílý) přehrají STEJNÉ zahájení.
    // humanColor mění jen kdo je engine, ne tři půltahy ballotu.
    const k = 7;
    const asBlack = new GameStore(() => 0).create('championship', 'black', k);
    const asWhite = new GameStore(() => 0).create('championship', 'white', k);
    expect(asWhite.moves).toEqual(asBlack.moves);
    expect(asWhite.ballotIndex).toBe(k);
    expect(asWhite.humanColor).toBe('white');
    expect(asBlack.humanColor).toBe('black');
  });

  it('ballotIndex u ne-Mistrovství úrovně = programová chyba volajícího (RangeError)', () => {
    // Store guard proti tiché ignoraci: route tuhle kombinaci blokuje 400 dřív,
    // ale kdyby se sem dostala, ozve se hlasitě, ne tiše zahodí index.
    const store = new GameStore(() => 0);
    for (const level of ['professional', 'intermediate', 'beginner', 'education'] as const) {
      expect(() => store.create(level, 'black', 3)).toThrow(RangeError);
    }
  });
});

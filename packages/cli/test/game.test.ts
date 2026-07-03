import { initialGameState, parseMove } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { MAX_GAME_PLIES, playGame } from '../src/game.js';
import { randomPlayer } from '../src/players.js';
import { mulberry32 } from '../src/prng.js';

describe('playGame – random vs random', () => {
  it('vždy terminuje s výsledkem (30 seedů)', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const game = await playGame(
        randomPlayer(mulberry32(seed)),
        randomPlayer(mulberry32(seed + 1000)),
      );
      expect(game.result).not.toBe('ongoing');
      expect(game.pdnMoves.length).toBeGreaterThan(0);
      expect(game.pdnMoves.length).toBeLessThanOrEqual(MAX_GAME_PLIES);
    }
  });

  it('stejný seed dává identickou partii', async () => {
    const play = (): ReturnType<typeof playGame> =>
      playGame(randomPlayer(mulberry32(7)), randomPlayer(mulberry32(1007)));
    const first = await play();
    const second = await play();
    expect(second.pdnMoves).toEqual(first.pdnMoves);
    expect(second.result).toBe(first.result);
  });

  it('hlásí každý půltah přes onPly ve správném pořadí', async () => {
    const plies: string[] = [];
    const game = await playGame(
      randomPlayer(mulberry32(3)),
      randomPlayer(mulberry32(1003)),
      ({ ply, color, pdn }) => {
        plies.push(`${String(ply)}:${color}:${pdn}`);
      },
    );
    expect(plies).toHaveLength(game.pdnMoves.length);
    // Černý táhne první, barvy se střídají.
    expect(plies[0]).toMatch(/^1:black:/);
    expect(plies[1]).toMatch(/^2:white:/);
  });
});

describe('playGame – brána legality', () => {
  it('odmítne nelegální tah od strategie', async () => {
    // 22-18 je strukturálně platný tah bílého, ale na tahu je černý.
    const cheat = (): ReturnType<typeof parseMove> => parseMove('22-18');
    await expect(playGame(cheat, randomPlayer(mulberry32(1)))).rejects.toThrow(/nelegální tah/);
  });

  it('odmítne strukturálně nesmyslný tah od strategie', async () => {
    // Teleport přes celou desku – formatMove ho odmítne RangeErrorem.
    const broken = (): { from: number; path: number[]; captures: number[] } => ({
      from: 1,
      path: [32],
      captures: [],
    });
    await expect(playGame(broken, randomPlayer(mulberry32(1)))).rejects.toThrow(RangeError);
  });
});

describe('randomPlayer', () => {
  it('odmítne prázdný seznam tahů', () => {
    const player = randomPlayer(mulberry32(1));
    expect(() => player(initialGameState(), [])).toThrow(RangeError);
  });

  it('odmítne rng mimo kontrakt [0, 1)', () => {
    const player = randomPlayer(() => 1);
    const state = initialGameState();
    expect(() => player(state, [parseMove('11-15')])).toThrow(RangeError);
  });
});

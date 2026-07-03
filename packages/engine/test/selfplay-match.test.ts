import { describe, expect, it } from 'vitest';

import { evaluate, evaluateV2 } from '../src/evaluate.js';
import { generateOpenings, runMatch } from '../src/selfplay.js';

/** Konstantní evaluace = „slepý" hráč: vidí jen vynucené výhry/prohry v hloubce. */
const constEval = (): number => 0;

describe('runMatch – smoke (malé N, rychlé do CI)', () => {
  it('tally je konzistentní: games = 2×zahájení, wins+draws+losses = games, score = wins + 0,5·draws', () => {
    const openings = generateOpenings(1, 6, 4);
    const result = runMatch({ newEval: evaluateV2, oldEval: evaluate, openings, depth: 3, seed: 100 });
    expect(result.games).toBe(12);
    expect(result.wins + result.draws + result.losses).toBe(result.games);
    expect(result.score).toBe(result.wins + 0.5 * result.draws);
    expect(result.scoreRate).toBeCloseTo(result.score / result.games, 10);
  });

  it('je herně deterministický: stejné vstupy = stejný výsledek (mimo časovou telemetrii)', () => {
    const openings = generateOpenings(50, 5, 4);
    const opts = { newEval: evaluateV2, oldEval: evaluate, openings, depth: 3, seed: 7 } as const;
    // newMs/oldMs jsou reálný čas (nedeterministický) – porovnává se jen
    // herní výsledek a počty tahů, které deterministické JSOU.
    const outcome = (r: ReturnType<typeof runMatch>) => ({
      games: r.games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      score: r.score,
      scoreRate: r.scoreRate,
      newMoves: r.newMoves,
      oldMoves: r.oldMoves,
    });
    expect(outcome(runMatch(opts))).toEqual(outcome(runMatch(opts)));
  });

  it('má zuby: evaluace vidoucí materiál drtí slepou (konstantní) evaluaci', () => {
    // Kdyby harness nedokázal odlišit silnější hráče, tenhle test by ho
    // odhalil: evaluateV2 (vidí materiál a pozici) musí proti konstantní
    // evaluaci (hraje prakticky náhodně) vyhrát víc partií, než prohraje.
    const openings = generateOpenings(200, 8, 4);
    const result = runMatch({ newEval: evaluateV2, oldEval: constEval, openings, depth: 4, seed: 3 });
    expect(result.wins).toBeGreaterThan(result.losses);
  });
});

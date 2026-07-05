import { describe, expect, it } from 'vitest';

import { generateOpenings, runStrengthMatch } from '../src/selfplay.js';
import type { StrengthSide } from '../src/selfplay.js';

/** Profesionál: hluboká, pozorná hra. */
const PRO: StrengthSide = { maxDepth: 4, carelessness: 0 };
/** Slabý hráč: mělká hloubka + vysoká nepozornost. */
const WEAK: StrengthSide = { maxDepth: 1, carelessness: 0.5 };

describe('runStrengthMatch – slabší nastavení měřitelně prohrává', () => {
  it('slabý (mělká hloubka + nepozornost) prohrává s profesionálem (scoreRate < 0,5)', () => {
    // Párovaný zápas (color swap odečítá výhodu tahu), plně seedovaný. Pokud by
    // maxDepth ani carelessness do hry nezasáhly, obě strany by byly stejné a
    // scoreRate ≈ 0,5 (viz kontrolní test níž) – tady MUSÍ být výrazně pod.
    const openings = generateOpenings(500, 6, 4);
    const result = runStrengthMatch({ newSide: WEAK, oldSide: PRO, openings, seed: 11 });
    expect(result.games).toBe(12);
    expect(result.scoreRate).toBeLessThan(0.5);
    expect(result.losses).toBeGreaterThan(result.wins);
  });

  it('izoluje páku nepozornosti: při STEJNÉ hloubce prohrává nepozorný pozornému', () => {
    // Předchozí test míchá obě páky (mělká hloubka I nepozornost) – projde, i
    // kdyby fungovala jen jedna. Tady je hloubka na obou stranách shodná (4),
    // liší se JEN carelessness → doloží, že nepozornost sama o sobě oslabuje.
    // Kdyby se carelessness do chooseMove nepředala, vyšlo by ~0,5.
    const openings = generateOpenings(500, 6, 4);
    const result = runStrengthMatch({
      newSide: { maxDepth: 4, carelessness: 0.8 },
      oldSide: PRO,
      openings,
      seed: 11,
    });
    expect(result.scoreRate).toBeLessThan(0.5);
    expect(result.losses).toBeGreaterThan(result.wins);
  });

  it('má zuby: stejná síla na obou stranách → vyrovnané (scoreRate kolem 0,5)', () => {
    // Kontrola falešného poplachu: kdyby předchozí test procházel jen proto, že
    // je harness rozbitý (např. vždy prohrává „nová" strana), tady by při
    // shodné síle taky nevyšlo ~0,5. Rozdíl mezi oběma testy = důkaz, že
    // slabost dělají PARAMETRY, ne artefakt harnessu.
    const openings = generateOpenings(500, 6, 4);
    const result = runStrengthMatch({ newSide: PRO, oldSide: PRO, openings, seed: 11 });
    expect(result.scoreRate).toBeGreaterThan(0.3);
    expect(result.scoreRate).toBeLessThan(0.7);
  });

  it('je deterministický: stejné vstupy = stejný herní výsledek', () => {
    const openings = generateOpenings(500, 6, 4);
    const opts = { newSide: WEAK, oldSide: PRO, openings, seed: 11 } as const;
    const outcome = (r: ReturnType<typeof runStrengthMatch>) => ({
      games: r.games,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      scoreRate: r.scoreRate,
    });
    expect(outcome(runStrengthMatch(opts))).toEqual(outcome(runStrengthMatch(opts)));
  });
});

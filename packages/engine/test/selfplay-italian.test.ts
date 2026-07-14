/**
 * Brána fáze 119: AI hraje italskou (`ITALIAN_RULESET`) rozumně a LEGÁLNĚ,
 * bez nových vah – italská jede na stávající short-king ceně (jako americká).
 *
 * Tři nezávislé části (bez zásahu do evaluace/pravidel, jen ověření):
 *
 *  A) EVAL (short-king cesta): produkční evaluace je v1 `evaluate` (viz
 *     search.ts default `evaluateFn = evaluate`, searchTimed `options.evaluate
 *     ?? evaluate`, handler.ts volá searchTimed BEZ `evaluate`; `evaluateV2`
 *     žije jen v scripts/selfplay-gate.ts). `evaluate` čte z rulesetu jen cenu
 *     dámy: italská má `king:'short'` → 130 (NE flying 300). ZUB: tatáž pozice
 *     s POOL (flying) dá 300 → potvrzuje, že italská se omylem nedostane na
 *     flying cenu a jede short cestou.
 *
 *  B) LEGALITA (plumbing ruleset→search, fáze 100): AI-vybraný tah
 *     (`searchRoot` s ITALIAN_RULESET) je VŽDY prvkem `legalMoves(pos, ITALIAN)`
 *     – ctí maximum i „muž nebere dámu". ZUB: crafted pozice, kde AMERICAN
 *     moveGen nabídne kratší/nelegální tah (2-braní místo 3-braní; muž přes
 *     dámu). Kdyby se ruleset do searche neprotáhl, search by osekaný/nelegální
 *     tah vybral → aserce „∈ italské legalMoves" spadne.
 *
 *  C) SELF-PLAY SANITY (á la selfplay-flying-king.test.ts, část B): engine
 *     v italské porazí náhodného hráče a NIC neprohraje – celá produkční cesta
 *     `searchTimed(..., {ruleset: ITALIAN_RULESET})` netahá zjevné blbosti,
 *     partie TERMINUJÍ a KAŽDÝ engine tah je nezávisle ověřen jako legální.
 *     Není to důkaz síly (turnajová síla NENÍ cíl), je to sanity celé cesty.
 */

import {
  advanceState,
  AMERICAN_RULESET,
  gameResultFromState,
  initialGameState,
  ITALIAN_RULESET,
  legalMoves,
  POOL_RULESET,
} from '@checkers/rules';
import type { Cell, Color, GameResult, Move, Position } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { evaluate, KING_VALUE, KING_VALUE_FLYING, searchRoot } from '../src/index.js';
import type { EvalFn } from '../src/index.js';
import { mulberry32 } from '../src/prng.js';
import { makePosition } from './support/position.js';

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
const WHITE_KING: Cell = { color: 'white', kind: 'king' };

describe('italská EVAL: krátká dáma (short 130, ne flying 300)', () => {
  // Produkční evaluace je v1 `evaluate` (default searche i searchTimed; handler
  // ji nepřepisuje). Cílíme tedy TU aktivní. Lone dáma → materiál = cena dámy.
  const loneKing = makePosition('black', { 27: 'bk' });

  // Hodnoty bereme z produkčních konstant, ne natvrdo (cross-module kontrakt):
  // legitimní rekalibrace KING_VALUE nesmí shodit italský test bez italsky
  // specifické příčiny. Zub je v rozdílu short vs flying, ne v absolutním čísle.
  it('evaluate(dáma, ITALIAN) = KING_VALUE (short), NE flying', () => {
    expect(evaluate(loneKing, ITALIAN_RULESET)).toBe(KING_VALUE);
  });

  it('ZUB: tatáž pozice s POOL (flying) dá KING_VALUE_FLYING – italská jede short cestou', () => {
    // Kdyby italská omylem spadla na flying, dostala by flying cenu jako pool.
    // Rozdíl short vs flying na TÉŽE pozici dokazuje, že o ceně dámy rozhoduje
    // ruleset.king; premisa zubu je, že se ty dvě ceny reálně liší.
    expect(evaluate(loneKing, POOL_RULESET)).toBe(KING_VALUE_FLYING);
    expect(KING_VALUE).not.toBe(KING_VALUE_FLYING);
  });
});

describe('italská LEGALITA: AI-vybraný tah ∈ legalMoves(ITALIAN)', () => {
  const DEPTH = 4;
  const italianEval: EvalFn = (p) => evaluate(p, ITALIAN_RULESET);

  /** Nejlepší tahy černého s ITALIAN moveGen na dané hloubce. */
  function italianBestMoves(position: Position): readonly Move[] {
    return searchRoot(position, DEPTH, italianEval, null, false, ITALIAN_RULESET).bestMoves;
  }

  // (1) Maximum: nezávislé 3-braní (5→14→23→32) a 2-braní (4→11→20). Italsky
  //     legalMoves vrátí JEN 3-braní; americky OBĚ. (Pozice z italian-max-capture.)
  //
  //     POZOR – PLNÉ zuby na plumbing (search bez rulesetu) nese až případ (2):
  //     tady material míří stejně jako maximum (3 kameny > 2), takže i americký
  //     search by 3-braní vybral kvůli materiálu – rozdíl by NEbyl vidět. Tento
  //     případ proto NEdiskriminuje rozbité plumbing; korroboruje jen, že AI hraje
  //     z max-filtrované množiny, a s vlastními zuby drží, že filtr maxima je ŽIVÝ
  //     (2-braní je v americké množině, v italské ne). Korektnost filtru samotného
  //     kryje perft/golden na úrovni rules; tady jde o to, že AI čte z TÉ množiny.
  const maxCapture = positionWith(
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
  );

  it('maximum: AI hraje z max-filtrované množiny (filtr je živý, bestMoves ⊆ italské legalMoves)', () => {
    const twoCapture: Move = { from: 4, path: [11, 20], captures: [8, 16] };
    // Zub na tom, že filtr maxima reálně osekává: 2-braní je legální americky,
    // ale v italské množině NENÍ (kdyby filtr umřel, objevilo by se i tady).
    expect(legalMoves(maxCapture, AMERICAN_RULESET)).toContainEqual(twoCapture);
    const legal = legalMoves(maxCapture, ITALIAN_RULESET);
    expect(legal).not.toContainEqual(twoCapture);
    // AI-vybraný tah je prvkem TÉTO (max-filtrované) italské množiny.
    const best = italianBestMoves(maxCapture);
    expect(best.length).toBeGreaterThan(0);
    for (const mv of best) {
      expect(legal).toContainEqual(mv);
    }
  });

  // (2) Muž nebere dámu: muž 10 vezme muže 15 (dopad 19), z 19 by americky
  //     přeskočil DÁMU 24 na 28. Italsky sekvence končí na 19.
  const manOverKing = positionWith(
    [
      [10, BLACK_MAN],
      [15, WHITE_MAN],
      [24, WHITE_KING],
    ],
    'black',
  );

  it('muž nebere dámu: bestMoves ⊆ italské legalMoves; přeskok dámy se NEvybere', () => {
    const legal = legalMoves(manOverKing, ITALIAN_RULESET);
    const best = italianBestMoves(manOverKing);
    expect(best.length).toBeGreaterThan(0);
    for (const mv of best) {
      expect(legal).toContainEqual(mv);
    }
    // ZUB: americký přeskok přes dámu (10→19→28, bere i dámu 24) je nelegální.
    expect(best).not.toContainEqual({ from: 10, path: [19, 28], captures: [15, 24] });
    expect(best).toContainEqual({ from: 10, path: [19], captures: [15] });
    // Kontrola premisy zubu: americky ten přeskok REÁLNĚ existuje (odstranil ho
    // italský ruleset, ne jeho absence).
    expect(legalMoves(manOverKing, AMERICAN_RULESET)).toContainEqual({
      from: 10,
      path: [19, 28],
      captures: [15, 24],
    });
  });
});

describe('self-play sanity: italská engine vs random', () => {
  const GAMES = 20;
  const TIME_MS = 25;
  const MAX_PLIES = 300;
  const MIN_WINS = 12; // rezerva na variabilitu stroje; klíčové je 0 proher

  it(
    `${String(GAMES)} partií italská: 0 proher, >= ${String(MIN_WINS)} výher, partie terminují`,
    async () => {
      // searchTimed měří reálný čas → import jen zde (ať se strom nenatáhne zbytečně).
      const { searchTimed } = await import('../src/index.js');

      let wins = 0;
      let losses = 0;
      let draws = 0;
      const outcomes: string[] = [];

      for (let game = 0; game < GAMES; game++) {
        const engineColor: Color = game % 2 === 0 ? 'black' : 'white';
        const engineRng = mulberry32(game + 1);
        const randomRng = mulberry32(game + 10_001);
        let state = initialGameState(undefined, 'italian');
        let result: GameResult = 'ongoing';

        for (let ply = 0; ply < MAX_PLIES; ply++) {
          result = gameResultFromState(state);
          if (result !== 'ongoing') {
            break;
          }
          const onTurn = state.position.turn === engineColor;
          let move: Move;
          if (onTurn) {
            const { bestMoves } = searchTimed(state.position, {
              timeMs: TIME_MS,
              ruleset: ITALIAN_RULESET,
            });
            const picked = bestMoves[Math.floor(engineRng() * bestMoves.length)];
            if (picked === undefined) {
              throw new RangeError('engine: bestMoves prázdné');
            }
            // Nezávislé ověření legality (nedůvěřuj searchi) – ctí maximum+prioritu.
            expect(legalMoves(state.position, ITALIAN_RULESET)).toContainEqual(picked);
            move = picked;
          } else {
            const moves = legalMoves(state.position, ITALIAN_RULESET);
            const picked = moves[Math.floor(randomRng() * moves.length)];
            if (picked === undefined) {
              throw new RangeError('random: pozice bez tahů');
            }
            move = picked;
          }
          state = advanceState(state, move);
        }
        // ZUB na terminaci: partie NESMÍ dojet na strop MAX_PLIES bez rozhodnutí
        // remízovými pravidly. Zamrznutí/nekonečno = tichá remíza dole by chybu
        // schovala; tady ji vytáhneme napovrch.
        expect.soft(
          result,
          `partie ${String(game + 1)} nedoterminovala do ${String(MAX_PLIES)} půltahů`,
        ).not.toBe('ongoing');
        if (result === 'ongoing') {
          result = 'draw';
        }

        const engineWin: GameResult = engineColor === 'black' ? 'black-wins' : 'white-wins';
        if (result === engineWin) {
          wins++;
        } else if (result === 'draw') {
          draws++;
        } else {
          losses++;
        }
        outcomes.push(`partie ${String(game + 1)} (engine ${engineColor}): ${result}`);
      }

      const summary = outcomes.join('\n');
      expect.soft(losses, `Engine prohrál v italské:\n${summary}`).toBe(0);
      expect(
        wins,
        `Málo výher italská (${String(wins)}/${String(GAMES)}, remíz ${String(draws)}):\n${summary}`,
      ).toBeGreaterThanOrEqual(MIN_WINS);
    },
    600_000,
  );
});

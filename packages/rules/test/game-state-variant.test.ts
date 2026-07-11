/**
 * GameState nese variantu (fáze 100): `advanceState`/`gameResultFromState`
 * čtou `state.variant` → registr → ruleset a předávají ho `applyMove`/`legalMoves`.
 *
 * ZUBY: klíčový důkaz je RUSKÁ proměna UPROSTŘED braní. Muž 22, který během
 * braní dopadne na proměnnou řadu, se u ruské HNED stává DÁMOU a bere dál –
 * u americké/pool by na témž poli skončil jako MUŽ. Když advanceState variantu
 * ignoruje a jede natvrdo americky, na cíli 24 bude muž (ne dáma) a test padne.
 * To je přesně footgun, kvůli kterému je varianta POLE stavu, ne parametr.
 */

import { describe, expect, it } from 'vitest';

import type { Cell, Position } from '../src/index.js';
import {
  AMERICAN_RULESET,
  advanceState,
  applyMove,
  gameResultFromState,
  initialGameState,
  legalMoves,
  rulesetForVariant,
} from '../src/index.js';

function board(cells: [number, 'b' | 'w', 'm' | 'k'][], turn: 'black' | 'white'): Position {
  const b: Cell[] = new Array<Cell>(32).fill(null);
  for (const [sq, col, kind] of cells) {
    b[sq - 1] = {
      color: col === 'b' ? 'black' : 'white',
      kind: kind === 'k' ? 'king' : 'man',
    };
  }
  return { board: b, turn };
}

// Ruská pozice: černý muž 22 bere 26 (dopad 31 = proměnná řada → dáma), otočí se,
// bere 27, doskočí na 24 (řada 5). Sdílená fixture s russian-mid-capture.test.ts.
const RUSSIAN_MID_CAPTURE = board(
  [
    [22, 'b', 'm'],
    [26, 'w', 'm'],
    [27, 'w', 'm'],
    [20, 'w', 'm'],
  ],
  'black',
);

describe('advanceState čte variantu ze stavu (ruská mid-capture proměna)', () => {
  it('ruská partie: advanceState aplikuje mid-capture → na 24 stojí DÁMA', () => {
    const state = initialGameState(RUSSIAN_MID_CAPTURE, 'russian');
    // Generátor v RUSKÉ variantě nabídne právě mid-capture tah [31,24].
    const moves = legalMoves(RUSSIAN_MID_CAPTURE, rulesetForVariant('russian'));
    const move = moves.find((m) => m.from === 22);
    expect(move).toBeDefined();
    if (move === undefined) return;

    const next = advanceState(state, move);
    // Varianta se propaguje beze změny.
    expect(next.variant).toBe('russian');
    // Na cílovém poli 24 stojí DÁMA (proměna uprostřed braní), NE muž.
    expect(next.position.board[24 - 1]).toEqual({ color: 'black', kind: 'king' });
    // Brané kameny jsou pryč, výchozí pole prázdné, nebraný bloker 20 zůstal.
    expect(next.position.board[22 - 1]).toBeNull();
    expect(next.position.board[26 - 1]).toBeNull();
    expect(next.position.board[27 - 1]).toBeNull();
    expect(next.position.board[20 - 1]).toEqual({ color: 'white', kind: 'man' });
  });

  it('kontrast: applyMove pod AMERICKÝM rulesetem by na 24 udělal MUŽE', () => {
    // Přímý kontrolní bod: TÝŽ tah + pozice, ale ruleset bez mid-capture proměny
    // → na 24 je muž. Tím je vidět, že rozdíl v advanceState dělá právě varianta.
    const move = { from: 22, path: [31, 24], captures: [26, 27] };
    const applied = applyMove(RUSSIAN_MID_CAPTURE, move, AMERICAN_RULESET);
    expect(applied.board[24 - 1]).toEqual({ color: 'black', kind: 'man' });
  });
});

describe('advanceState/gameResultFromState – americká varianta beze změny', () => {
  it('výchozí americká partie: default variant american, běžný tah muže', () => {
    const state = initialGameState();
    expect(state.variant).toBe('american');
    const first = legalMoves(state.position).find((m) => m.from === 9);
    expect(first).toBeDefined();
    if (first === undefined) return;
    const next = advanceState(state, first);
    expect(next.variant).toBe('american');
    expect(gameResultFromState(next)).toBe('ongoing');
  });
});

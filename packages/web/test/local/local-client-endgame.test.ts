import { describe, expect, it } from 'vitest';
import { searchTimed } from '@checkers/engine';
import { applyMove, legalMoves } from '@checkers/rules';
import type { Color, Position } from '@checkers/rules';
import { createInProcessEngineWorker } from '../../src/local/engine-worker.js';
import { createLocalClient, DRAW_ACCEPT_MAX_ENGINE_SCORE } from '../../src/local-client.js';
import type { GameDto } from '../../src/server-client.js';
import { makeClock, pollUntilSettled } from './helpers.js';

function makeClient(humanSeed = 0x1234_abcd) {
  const worker = createInProcessEngineWorker({ now: makeClock() });
  return createLocalClient(worker, { seed: () => humanSeed, timeMs: 1, now: makeClock() });
}

function opposite(color: Color): Color {
  return color === 'black' ? 'white' : 'black';
}

/** Pozice po zahrání tahu (from+path) – pro sondování skóre v testu. Null, když tah není legální. */
function applyForProbe(position: Position, from: number, path: readonly number[]): Position | null {
  const move = legalMoves(position).find(
    (m) => m.from === from && m.path.length === path.length && m.path.every((p, i) => p === path[i]),
  );
  return move === undefined ? null : applyMove(position, move);
}

/** Nezávislý přepočet verdiktu remízy z primitiva – stejný vzorec, jaký má LocalClient. */
function expectedAccept(position: Position, humanColor: Color): boolean {
  const { score } = searchTimed(position, { timeMs: 1, now: makeClock() });
  const engineColor = opposite(humanColor);
  const engineScore = position.turn === engineColor ? score : -score;
  return engineScore <= DRAW_ACCEPT_MAX_ENGINE_SCORE;
}

describe('LocalClient resign', () => {
  it('člověk černý se vzdá → vyhrává engine (bílý) = white-wins', async () => {
    const client = makeClient();
    const created = await client.createGame('beginner', 'black');
    const done = await client.resign(created.id);
    expect(done.result).toBe('white-wins');
  });

  it('člověk bílý se vzdá → vyhrává engine (černý) = black-wins', async () => {
    const client = makeClient();
    const created = await client.createGame('beginner', 'white');
    // Počkej, až engine dotáhne první tah (jinak je na tahu engine); vzdát jde kdykoli.
    await pollUntilSettled(client, created.id);
    const done = await client.resign(created.id);
    expect(done.result).toBe('black-wins');
  });

  it('vzdání už skončené partie → game_over', async () => {
    const client = makeClient();
    const created = await client.createGame('beginner', 'black');
    await client.resign(created.id);
    await expect(client.resign(created.id)).rejects.toMatchObject({ code: 'game_over' });
  });
});

describe('LocalClient offerDraw', () => {
  it('PŘIJME remízu, když engine nevede (výchozí pozice, engineScore ≤ 0) – shoda s primitivem', async () => {
    const client = makeClient();
    const created = await client.createGame('beginner', 'black');
    const expected = expectedAccept(created.position, 'black');
    // Zub: nezávislý přepočet z primitiva musí ve výchozí pozici dát přijetí – kdyby
    // LocalClient obrátil znaménko/práh, verdikt by se rozešel.
    expect(expected).toBe(true);
    const offer = await client.offerDraw(created.id);
    expect(offer.accepted).toBe(true);
    expect(offer.game.result).toBe('draw');
  });

  it('ODMÍTNE remízu, když engine vede (po záměrné ztrátě materiálu) – shoda s primitivem', async () => {
    // Řízeně přivedeme člověka do prohrané pozice: v každém tahu vybereme tah, po
    // kterém má engine největší výhodu (searchTimed z pohledu strany na tahu = engine).
    // Jakmile primitivum hlásí engineScore > 0, nabídneme remízu → musí padnout odmítnutí.
    const client = makeClient();
    const humanColor: Color = 'black';
    let state: GameDto = await client.createGame('beginner', humanColor);

    let rejectedVerified = false;
    for (let step = 0; step < 20 && state.result === 'ongoing'; step++) {
      if (state.position.turn !== humanColor) {
        state = await pollUntilSettled(client, state.id);
        continue;
      }
      if (!expectedAccept(state.position, humanColor)) {
        // Engine vede → nabídka se musí ODMÍTNOUT (a partie běží dál).
        const offer = await client.offerDraw(state.id);
        expect(offer.accepted).toBe(false);
        expect(offer.game.result).toBe('ongoing');
        rejectedVerified = true;
        break;
      }
      // Vyber nejhorší tah pro člověka: po něm je na tahu engine, jeho skóre (z pohledu
      // strany na tahu = engine) chceme co největší.
      let worst = state.legalMoves[0];
      let worstScore = -Infinity;
      for (const m of state.legalMoves) {
        const after = applyForProbe(state.position, m.from, m.path);
        if (after === null) {
          continue;
        }
        const { score } = searchTimed(after, { timeMs: 1, now: makeClock() });
        if (score > worstScore) {
          worstScore = score;
          worst = m;
        }
      }
      if (worst === undefined) {
        break;
      }
      await client.postMove(state.id, worst.from, worst.path);
      state = await pollUntilSettled(client, state.id);
    }
    // Test má zuby jen když odmítnutí opravdu nastalo.
    expect(rejectedVerified).toBe(true);
  });

  it('nabídka remízy ve skončené partii → game_over', async () => {
    const client = makeClient();
    const created = await client.createGame('beginner', 'black');
    await client.resign(created.id);
    await expect(client.offerDraw(created.id)).rejects.toMatchObject({ code: 'game_over' });
  });
});

// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import type { GameStatus } from '../src/controller.js';
import type { DrawOffer, GameDto, ServerClient } from '../src/server-client.js';

const HUGE_INTERVAL = 1_000_000;
const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function gameDto(position: Position, result: GameDto['result'] = 'ongoing'): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle' };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Pozice po tahu 9→13 (na tahu bílý). */
function afterOpening(): Position {
  const start = initialPosition();
  const pieces: Record<number, Cell> = {};
  start.board.forEach((cell, i) => {
    if (cell !== null) {
      pieces[i + 1] = cell;
    }
  });
  delete pieces[9];
  pieces[13] = { color: 'black', kind: 'man' };
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  const turn: Color = 'white';
  return { board, turn };
}

/** ServerClient, kde všechny běžné cesty vrací `start`; offerDraw se injektuje. */
function clientWithOffer(start: Position, offerDraw: ServerClient['offerDraw']): ServerClient {
  return {
    createGame: () => Promise.resolve(gameDto(start)),
    getGame: () => Promise.resolve(gameDto(start)),
    postMove: () => Promise.resolve(gameDto(start)),
    resign: () => Promise.resolve(gameDto(start, 'white-wins')),
    offerDraw,
  };
}

describe('controller.offerDraw()', () => {
  it('přijetí: převezme draw stav, vrátí "accepted", onState ohlásí draw', async () => {
    const start = initialPosition();
    const client = clientWithOffer(start, () =>
      Promise.resolve<DrawOffer>({ accepted: true, game: gameDto(start, 'draw') }),
    );
    const seen: GameStatus[] = [];
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: HUGE_INTERVAL,
      onState: (s) => seen.push(s),
    });
    disposers.push(() => controller.dispose());

    const outcome = await controller.offerDraw();
    expect(outcome).toBe('accepted');
    expect(seen.at(-1)?.result).toBe('draw');
  });

  it('odmítnutí: vrátí "declined", stav zůstává ongoing', async () => {
    const start = initialPosition();
    const client = clientWithOffer(start, () =>
      Promise.resolve<DrawOffer>({ accepted: false, game: gameDto(start, 'ongoing') }),
    );
    const seen: GameStatus[] = [];
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: HUGE_INTERVAL,
      onState: (s) => seen.push(s),
    });
    disposers.push(() => controller.dispose());

    const outcome = await controller.offerDraw();
    expect(outcome).toBe('declined');
    expect(seen.at(-1)?.result).toBe('ongoing');
  });

  it('nabídka ve skončené partii je no-op (server se nevolá, vrátí "error")', async () => {
    const played = afterOpening();
    const offerSpy = vi.fn(() =>
      Promise.resolve<DrawOffer>({ accepted: false, game: gameDto(played, 'white-wins') }),
    );
    const client = clientWithOffer(played, offerSpy);
    const controller = createBoardController(client, gameDto(played, 'white-wins'), {
      pollIntervalMs: HUGE_INTERVAL,
    });
    disposers.push(() => controller.dispose());

    const outcome = await controller.offerDraw();
    expect(outcome).toBe('error');
    expect(offerSpy).not.toHaveBeenCalled();
  });

  it('selhání serveru → "error", stav se dorovná přes GET, deska se nezasekne', async () => {
    const start = initialPosition();
    const client = clientWithOffer(start, () => Promise.reject(new Error('engine selhal')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: HUGE_INTERVAL,
    });
    disposers.push(() => controller.dispose());

    const outcome = await controller.offerDraw();
    expect(outcome).toBe('error');
    // Po chybě není busy zaseknuté – další nabídka zase projde.
    const second = await controller.offerDraw();
    expect(second).toBe('error');
  });

  it('single-flight: nabídka POČKÁ, až doběhne rozehraný tah, teprve pak volá offerDraw', async () => {
    const start = initialPosition();
    const played = afterOpening();
    const calls: string[] = [];
    let releaseMove = (): void => undefined;
    const movePending = new Promise<GameDto>((resolve) => {
      releaseMove = (): void => resolve(gameDto(played));
    });
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () => Promise.resolve(gameDto(start)),
      postMove: () => {
        calls.push('move-start');
        return movePending.then((dto) => {
          calls.push('move-done');
          return dto;
        });
      },
      resign: () => Promise.resolve(gameDto(played, 'white-wins')),
      offerDraw: () => {
        calls.push('offer');
        return Promise.resolve<DrawOffer>({ accepted: false, game: gameDto(played) });
      },
    };
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: HUGE_INTERVAL,
    });
    disposers.push(() => controller.dispose());
    document.body.append(controller.element);

    // Rozjeď tah 9→13 – postMove „visí" → controller je busy.
    controller.element.querySelector<HTMLElement>('[data-square="9"]')?.click();
    controller.element.querySelector<HTMLElement>('[data-square="13"]')?.click();
    await tick();
    expect(calls).toEqual(['move-start']);

    // Nabídka během běžícího tahu nesmí předběhnout.
    void controller.offerDraw();
    await tick();
    expect(calls).toEqual(['move-start']);

    releaseMove();
    await tick();
    await tick();
    expect(calls).toEqual(['move-start', 'move-done', 'offer']);
  });
});

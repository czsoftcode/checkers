// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import type { GameStatus } from '../src/controller.js';
import type { GameDto, ServerClient } from '../src/server-client.js';

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
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle', level: 'professional' };
}

function squareEl(root: HTMLElement, square: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} nenalezeno`);
  }
  return el;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Pozice po tahu 9→13 (černý muž se posune, na tahu je bílý). */
function afterOpening(): Position {
  const pieces: Record<number, Cell> = {};
  const start = initialPosition();
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

describe('controller.resign() – čekání na běžící request (1a)', () => {
  it('vzdání POČKÁ, až doběhne rozehraný tah, a teprve pak volá resign', async () => {
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
      resign: () => {
        calls.push('resign');
        return Promise.resolve(gameDto(played, 'white-wins'));
      },
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(start) }),
    };

    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: HUGE_INTERVAL,
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    // Rozjeď tah 9→13 – postMove „visí", takže je controller busy.
    click(squareEl(controller.element, 9));
    click(squareEl(controller.element, 13));
    await tick();
    expect(calls).toEqual(['move-start']); // tah běží, vzdání ještě ne

    // Vzdání během běžícího tahu: NESMÍ propadnout ani předběhnout tah.
    controller.resign();
    await tick();
    expect(calls).toEqual(['move-start']); // pořád čeká na doběhnutí tahu

    // Tah doběhne → teprve teď se pošle vzdání.
    releaseMove();
    await tick();
    await tick();
    expect(calls).toEqual(['move-start', 'move-done', 'resign']);
  });

  it('vzdání skončené partie je no-op (server se nevolá)', async () => {
    const played = afterOpening();
    const resignSpy = vi.fn(() => Promise.resolve(gameDto(played, 'white-wins')));
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(played, 'white-wins')),
      getGame: () => Promise.resolve(gameDto(played, 'white-wins')),
      postMove: () => Promise.resolve(gameDto(played, 'white-wins')),
      resign: resignSpy,
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(played, 'white-wins') }),
    };
    // Partie je založená rovnou jako skončená (white-wins).
    const controller = createBoardController(client, gameDto(played, 'white-wins'), {
      pollIntervalMs: HUGE_INTERVAL,
    });
    disposers.push(() => {
      controller.dispose();
    });

    controller.resign();
    await tick();
    expect(resignSpy).not.toHaveBeenCalled();
  });

  it('onState ohlásí výsledek z vzdání (white-wins)', async () => {
    const start = initialPosition();
    const played = afterOpening();
    const seen: GameStatus[] = [];
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () => Promise.resolve(gameDto(start)),
      postMove: () => Promise.resolve(gameDto(start)),
      resign: () => Promise.resolve(gameDto(played, 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(start) }),
    };
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: HUGE_INTERVAL,
      onState: (s) => seen.push(s),
    });
    disposers.push(() => {
      controller.dispose();
    });

    // Výchozí ohlášení hned při vytvoření.
    expect(seen[0]?.result).toBe('ongoing');

    controller.resign();
    await tick();
    expect(seen.at(-1)?.result).toBe('white-wins');
  });

  it('po dispose se doběhlý poll už neprojeví (žádný onState po dispose)', async () => {
    const start = initialPosition();
    let releaseGet = (): void => undefined;
    const getPending = new Promise<GameDto>((resolve) => {
      releaseGet = (): void => resolve(gameDto(afterOpening()));
    });
    const seen: GameStatus[] = [];
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () => getPending, // poll „visí" → doběhne až po dispose
      postMove: () => Promise.resolve(gameDto(start)),
      resign: () => Promise.resolve(gameDto(start, 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(start) }),
    };
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: 5,
      onState: (s) => seen.push(s),
    });
    disposers.push(() => {
      controller.dispose();
    });

    await delay(15); // stihl se rozjet aspoň jeden poll (a zablokovat se)
    const before = seen.length;

    controller.dispose();
    releaseGet(); // poll doběhne AŽ TEĎ, po dispose
    await tick();
    await tick();

    // Zuby: bez `disposed` guardu by doběhlý poll zavolal onState a seen by narostlo.
    expect(seen.length).toBe(before);
  });
});

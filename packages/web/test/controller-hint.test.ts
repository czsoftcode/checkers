// @vitest-environment jsdom
import { applyMove, initialPosition, legalMoves } from '@checkers/rules';
import type { GameResult, Move, Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import type { GameDto, MoveDto, ServerClient } from '../src/server-client.js';
import { ServerError } from '../src/server-client.js';

/**
 * Testy nápovědy ve Výuce (fáze 45) přes reálný controller + board-view (jsdom).
 * Ověřují: nápověda se ve Výuce načte přes `getHint` a zvýrazní na desce; MIMO
 * Výuku se `getHint` vůbec nevolá; nefetchuje se opakovaně každým pollem; při
 * odeslání tahu / dispose během načítání se rada zahodí; chyba `/hint` degraduje
 * bez zaseknutí desky (člověk může dál hrát).
 */

const HUGE = 1_000_000;
const disposers: (() => void)[] = [];

function gameDto(
  position: Position,
  level: GameDto['level'],
  engineStatus: GameDto['engineStatus'] = 'idle',
  result: GameResult = 'ongoing',
): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus, level, ballotMoves: null };
}

/** První legální (prostý) tah černého ve výchozí pozici – použije se jako nápověda. */
const opening: Move = (() => {
  const m = legalMoves(initialPosition())[0];
  if (m === undefined) {
    throw new Error('výchozí pozice musí mít legální tah');
  }
  return m;
})();
const openingTo = opening.path[opening.path.length - 1]!;
const hintDto: MoveDto = { from: opening.from, path: [...opening.path], captures: [...opening.captures] };
/** Pozice po zahrání `opening` (na tahu je pak bílý = engine). */
const afterOpening = applyMove(initialPosition(), opening);

/** Základní fake klient; jednotlivé metody se přepisují v `overrides`. */
function makeClient(overrides: Partial<ServerClient> = {}): ServerClient {
  return {
    createGame: () => Promise.resolve(gameDto(initialPosition(), 'education')),
    getGame: () => Promise.resolve(gameDto(initialPosition(), 'education')),
    postMove: () => Promise.resolve(gameDto(afterOpening, 'education')),
    resign: () => Promise.resolve(gameDto(initialPosition(), 'education', 'idle', 'white-wins')),
    offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(initialPosition(), 'education') }),
    ...overrides,
  };
}

function mount(game: GameDto, client: ServerClient, pollIntervalMs = HUGE): HTMLElement {
  const controller = createBoardController(client, game, { pollIntervalMs });
  disposers.push(() => {
    controller.dispose();
  });
  document.body.append(controller.element);
  return controller.element;
}

function sq(root: HTMLElement, square: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} nenalezeno`);
  }
  return el;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** Nechá doběhnout mikroúlohy (řetěz runRequest → getHint → setHighlights). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
  }
};
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('nápověda ve Výuce', () => {
  it('načte hint a zvýrazní výchozí pole + cíl doporučeného tahu', async () => {
    const getHint = vi.fn(() => Promise.resolve(hintDto));
    const board = mount(gameDto(initialPosition(), 'education'), makeClient({ getHint }));

    await flush();

    expect(getHint).toHaveBeenCalledTimes(1);
    expect(sq(board, opening.from).classList.contains('hint-from')).toBe(true);
    expect(sq(board, openingTo).classList.contains('hint-to')).toBe(true);
  });

  it('MIMO Výuku (Profesionál) se getHint vůbec nevolá', async () => {
    const getHint = vi.fn(() => Promise.resolve(hintDto));
    const board = mount(gameDto(initialPosition(), 'professional'), makeClient({ getHint }));

    await flush();

    expect(getHint).not.toHaveBeenCalled();
    expect(board.querySelectorAll('.hint-from, .hint-to')).toHaveLength(0);
  });

  it('nefetchuje nápovědu opakovaně každým pollem (jen jednou za tah)', async () => {
    const getHint = vi.fn(() => Promise.resolve(hintDto));
    // Malý poll interval → proběhne mnoho tiků; hintRequested je musí ututlat.
    mount(gameDto(initialPosition(), 'education'), makeClient({ getHint }), 5);

    await delay(60); // ~12 tiků pollu

    expect(getHint).toHaveBeenCalledTimes(1);
  });

  it('při odeslání tahu se nápověda zahodí (a nezůstane po přechodu na tah enginu)', async () => {
    const getHint = vi.fn(() => Promise.resolve(hintDto));
    const board = mount(gameDto(initialPosition(), 'education'), makeClient({ getHint }));
    await flush();
    expect(sq(board, opening.from).classList.contains('hint-from')).toBe(true);

    // Zahraj doporučený tah: vyber výchozí pole a klikni na cíl.
    click(sq(board, opening.from));
    click(sq(board, openingTo));
    // SYNCHRONNĚ (postMove ještě neodpověděl, tah se v lokálním stavu nezměnil):
    // nápověda je pryč díky vyčištění v submitMove, NE až díky pozdější změně tahu.
    // Tím má test zuby na submitMove: bez `hintMove = null` by tu rada ještě svítila.
    expect(board.querySelectorAll('.hint-from, .hint-to')).toHaveLength(0);

    await flush();
    // I po přechodu na tah bílého zůstává pryč.
    expect(board.querySelectorAll('.hint-from, .hint-to')).toHaveLength(0);
  });

  it('konec partie ve Výuce (vzdání) nápovědu zhasne, i když se tah nezmění', async () => {
    const getHint = vi.fn(() => Promise.resolve(hintDto));
    const client = makeClient({ getHint });
    const controller = createBoardController(client, gameDto(initialPosition(), 'education'), {
      pollIntervalMs: HUGE,
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);
    await flush();
    // Nápověda svítí.
    expect(controller.element.querySelector('.hint-from')).not.toBeNull();

    // Vzdání mění jen výsledek (white-wins), pozice i strana na tahu (black) zůstávají.
    // Reset při změně tahu proto nenastane – radu musí zhasnout guard na lastResult.
    controller.resign();
    await flush();

    expect(controller.element.querySelectorAll('.hint-from, .hint-to')).toHaveLength(0);
  });

  it('chyba /hint degraduje: žádná nápověda, deska se nezasekne (člověk může hrát)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const getHint = vi.fn(() => Promise.reject(new ServerError(503, 'engine_unavailable', 'x')));
    const board = mount(gameDto(initialPosition(), 'education'), makeClient({ getHint }));

    await flush();

    expect(getHint).toHaveBeenCalledTimes(1);
    expect(board.querySelectorAll('.hint-from, .hint-to')).toHaveLength(0);
    // Deska není zaseknutá (busy se uvolnil): klik na vlastní kámen ho vybere.
    click(sq(board, opening.from));
    expect(sq(board, opening.from).classList.contains('selected')).toBe(true);
  });

  it('dispose během načítání hintu: dorazivší rada se už neaplikuje', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let resolveHint: (m: MoveDto) => void = () => undefined;
    const getHint = vi.fn(() => new Promise<MoveDto>((resolve) => {
      resolveHint = resolve;
    }));
    const board = mount(gameDto(initialPosition(), 'education'), makeClient({ getHint }));
    await flush();
    expect(getHint).toHaveBeenCalledTimes(1);

    // Nová hra během počítání nápovědy → dispose; teprve pak rada dorazí.
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    resolveHint(hintDto);
    await flush();

    // disposed guard: rada se nezvýraznila.
    expect(board.querySelectorAll('.hint-from, .hint-to')).toHaveLength(0);
  });
});

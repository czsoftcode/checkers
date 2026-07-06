// @vitest-environment jsdom
import { applyMove, initialPosition, legalMoves } from '@checkers/rules';
import type { Cell, Color, GameResult, Move, Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import { createBoardView } from '../src/board-view.js';
import type { GameDto, ServerClient } from '../src/server-client.js';
import { ServerError } from '../src/server-client.js';

/** Perioda, při které se polling v běžných testech nespustí. */
const HUGE_INTERVAL = 1_000_000;

const disposers: (() => void)[] = [];

/** Serverový stav ve tvaru pro klienta; `legalMoves` klient nečte. */
function gameDto(
  position: Position,
  engineStatus: GameDto['engineStatus'] = 'idle',
  result: GameResult = 'ongoing',
): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus, level: 'professional' };
}

/** Postaví pozici z řídkého zápisu `{ pole: kámen }` (pole 1–32). */
function position(turn: Color, pieces: Record<number, Cell>): Position {
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  return { board, turn };
}

const blackMan: Cell = { color: 'black', kind: 'man' };
const whiteMan: Cell = { color: 'white', kind: 'man' };
const blackKing: Cell = { color: 'black', kind: 'king' };

/** Najde v pozici tah odpovídající from + celé cestě (jinak vyhodí – fake „server"). */
function findMove(pos: Position, from: number, path: readonly number[]): Move {
  const move = legalMoves(pos).find(
    (m) => m.from === from && m.path.length === path.length && m.path.every((s, i) => s === path[i]),
  );
  if (move === undefined) {
    throw new Error(`fake server dostal nelegální tah: from=${String(from)} path=${path.join(',')}`);
  }
  return move;
}

interface Fake {
  readonly client: ServerClient;
  readonly posted: { from: number; path: number[] }[];
  current(): Position;
}

/**
 * Fake serveru pro testy: chová se jako autorita – tah člověka ověří a aplikuje
 * přes `rules` (jako reálný server) a vrací plný stav. `posted` zaznamenává, co
 * dostal, ať jde ověřit odeslané from+path.
 */
function serverFake(start: Position): Fake {
  let pos = start;
  let result: GameResult = 'ongoing';
  const posted: { from: number; path: number[] }[] = [];
  return {
    posted,
    current: () => pos,
    client: {
      createGame: () => Promise.resolve(gameDto(pos, 'idle', result)),
      getGame: () => Promise.resolve(gameDto(pos, 'idle', result)),
      postMove: (_id, from, path) => {
        posted.push({ from, path: [...path] });
        pos = applyMove(pos, findMove(pos, from, path));
        return Promise.resolve(gameDto(pos, 'idle', result));
      },
      // Vzdání: člověk (černý) → vyhrává bílý. Pozice zůstává, mění se jen výsledek.
      resign: () => {
        result = 'white-wins';
        return Promise.resolve(gameDto(pos, 'idle', result));
      },
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(pos, 'idle', result) }),
    },
  };
}

interface MountOpts {
  readonly client?: ServerClient;
  readonly game?: GameDto;
  readonly pollIntervalMs?: number;
}

function mount(start: Position = initialPosition(), opts: MountOpts = {}): HTMLElement {
  const client = opts.client ?? serverFake(start).client;
  const game = opts.game ?? gameDto(start);
  const controller = createBoardController(client, game, {
    pollIntervalMs: opts.pollIntervalMs ?? HUGE_INTERVAL,
  });
  disposers.push(() => {
    controller.dispose();
  });
  document.body.append(controller.element);
  return controller.element;
}

function hasPiece(root: HTMLElement, square: number, cls: string): boolean {
  return squareEl(root, square).querySelector(`.piece.${cls}`) !== null;
}

function isEmpty(root: HTMLElement, square: number): boolean {
  return squareEl(root, square).querySelector('.piece') === null;
}

function squareEl(root: HTMLElement, square: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} v desce nenalezeno`);
  }
  return el;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
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

describe('render desky', () => {
  it('má 64 polí, z toho 32 hracích s čísly 1–32', () => {
    const board = mount();
    expect(board.querySelectorAll('.square')).toHaveLength(64);

    const numbers = [...board.querySelectorAll<HTMLElement>('[data-square]')]
      .map((el) => Number(el.dataset.square))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
  });

  it('má otočenou orientaci: pole 29–32 v horní řadě, 1–4 v dolní', () => {
    const board = mount();
    const cells = [...board.querySelectorAll<HTMLElement>('.square')];
    expect(cells).toHaveLength(64);

    const numbersIn = (from: number, to: number): number[] =>
      cells
        .slice(from, to)
        .map((el) => el.dataset.square)
        .filter((s): s is string => s !== undefined)
        .map(Number)
        .sort((a, b) => a - b);

    // Deska je otočená o 180°: strana soupeře (bílý) nahoře, strana člověka
    // (černý, pole 1–12) dole.
    expect(numbersIn(0, 8)).toEqual([29, 30, 31, 32]); // horní řada = strana bílého
    expect(numbersIn(56, 64)).toEqual([1, 2, 3, 4]); // dolní řada = strana černého (člověk)
  });

  it('vykreslí výchozí rozestavění: 12 černých a 12 bílých kamenů', () => {
    const board = mount();
    expect(board.querySelectorAll('.piece.black')).toHaveLength(12);
    expect(board.querySelectorAll('.piece.white')).toHaveLength(12);
  });
});

describe('interakce výběru', () => {
  it('klik na vlastní kámen ho vybere a zvýrazní cíle', () => {
    const board = mount();
    click(squareEl(board, 9));

    expect(squareEl(board, 9).classList.contains('selected')).toBe(true);
    expect(squareEl(board, 13).classList.contains('target')).toBe(true);
    expect(squareEl(board, 14).classList.contains('target')).toBe(true);
  });

  it('opětovný klik na vybraný kámen výběr zruší', () => {
    const board = mount();
    click(squareEl(board, 9));
    click(squareEl(board, 9));

    expect(board.querySelectorAll('.selected')).toHaveLength(0);
    expect(board.querySelectorAll('.target')).toHaveLength(0);
  });

  it('klik na kámen soupeře výběr zruší (nevybere ho)', () => {
    const board = mount();
    click(squareEl(board, 9)); // vybráno
    click(squareEl(board, 21)); // bílý – černý je na tahu

    expect(board.querySelectorAll('.selected')).toHaveLength(0);
  });

  it('klik na světlé (nehrací) pole výběr zruší', () => {
    const board = mount();
    click(squareEl(board, 9));
    const light = board.querySelector<HTMLElement>('.square.light');
    expect(light).not.toBeNull();
    click(light!);

    expect(board.querySelectorAll('.selected')).toHaveLength(0);
  });

  it('když je na tahu engine (bílý), klik nic nevybere ani neodešle', () => {
    const whiteTurn = position('white', { 22: whiteMan, 9: blackMan });
    const fake = serverFake(whiteTurn);
    const board = mount(whiteTurn, { client: fake.client, game: gameDto(whiteTurn, 'thinking') });

    click(squareEl(board, 22)); // bílý kámen – ale hraje engine
    expect(board.querySelectorAll('.selected')).toHaveLength(0);
    expect(fake.posted).toEqual([]);
  });
});

describe('vícenásobný skok a odeslání tahu serveru', () => {
  // Černý muž 6 přeskočí bílé 10 a 18, cesta [15, 22].
  const doubleJump = (): Position =>
    position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });

  it('mezidopad: kámen doskočí na dopad a nabídne další', () => {
    const board = mount(doubleJump());
    click(squareEl(board, 6)); // vybere kámen, cíl 15
    expect(squareEl(board, 15).classList.contains('target')).toBe(true);

    click(squareEl(board, 15)); // první dopad – kámen na něm ZŮSTANE a čeká
    // Kámen je opticky na dopadu 15 (výběr tam), trasa (výchozí pole) je 'path',
    // nabídne se další dopad 22. Tah ještě není odeslán (server nic nedostal).
    expect(squareEl(board, 15).classList.contains('selected')).toBe(true);
    expect(squareEl(board, 6).classList.contains('path')).toBe(true);
    expect(squareEl(board, 22).classList.contains('target')).toBe(true);
    expect(hasPiece(board, 15, 'black')).toBe(true); // kámen doskočil na 15
    expect(isEmpty(board, 6)).toBe(true); // výchozí pole je prázdné
    expect(isEmpty(board, 10)).toBe(true); // sebraný meziskoku opticky zmizel
  });

  it('dokončení sekvence odešle serveru celé from+path a překreslí desku', async () => {
    const fake = serverFake(doubleJump());
    const board = mount(doubleJump(), { client: fake.client });
    click(squareEl(board, 6));
    click(squareEl(board, 15));
    click(squareEl(board, 22)); // poslední dopad → odeslání
    await tick();

    expect(fake.posted).toEqual([{ from: 6, path: [15, 22] }]);
    expect(hasPiece(board, 22, 'black')).toBe(true); // stav ze serveru: kámen dorazil
    expect(isEmpty(board, 6)).toBe(true);
    expect(isEmpty(board, 10)).toBe(true); // sebráno serverem
    expect(isEmpty(board, 18)).toBe(true);
    expect(board.querySelectorAll('.selected, .path, .target')).toHaveLength(0);
  });

  it('u větvení nespadne do prvního směru, ale nabídne obě větve', async () => {
    // Dáma 1 skočí přes 6 na 10, pak buď přes 7 na 3, nebo přes 14 na 17.
    const branch = (): Position =>
      position('black', { 1: blackKing, 6: whiteMan, 7: whiteMan, 14: whiteMan });
    const fake = serverFake(branch());
    const board = mount(branch(), { client: fake.client });
    click(squareEl(board, 1));
    click(squareEl(board, 10)); // společný první dopad

    expect(squareEl(board, 3).classList.contains('target')).toBe(true);
    expect(squareEl(board, 17).classList.contains('target')).toBe(true);

    click(squareEl(board, 17)); // zvolená větev → odeslání
    await tick();

    expect(fake.posted).toEqual([{ from: 1, path: [10, 17] }]);
    expect(hasPiece(board, 17, 'black')).toBe(true);
    expect(isEmpty(board, 6)).toBe(true);
    expect(isEmpty(board, 14)).toBe(true);
    expect(hasPiece(board, 7, 'white')).toBe(true); // druhá větev nesebrána
  });

  it('výběr zablokovaného vlastního kamene nenabídne cíle a nezpůsobí pád', () => {
    // Černý muž 1 (horní řada) má pole 5, 6 obsazená vlastními – žádný tah.
    const board = mount(initialPosition());
    expect(() => {
      click(squareEl(board, 1));
    }).not.toThrow();
    expect(squareEl(board, 1).classList.contains('selected')).toBe(true);
    expect(board.querySelectorAll('.target')).toHaveLength(0);
  });

  it('klik na výchozí kámen uprostřed sekvence zruší rozpracovaný skok', () => {
    const board = mount(doubleJump());
    click(squareEl(board, 6));
    click(squareEl(board, 15)); // rozpracovaná sekvence, kámen doskočil na 15
    expect(squareEl(board, 15).classList.contains('selected')).toBe(true);

    click(squareEl(board, 6)); // klik na výchozí pole = úplný reset
    expect(board.querySelectorAll('.selected, .path, .target')).toHaveLength(0);
    // Reset vrátí kámen na výchozí pole a sebrané kameny obnoví (server je pravda).
    expect(hasPiece(board, 6, 'black')).toBe(true);
    expect(hasPiece(board, 10, 'white')).toBe(true);
    expect(isEmpty(board, 15)).toBe(true);
  });

  it('klik mimo zvýrazněná pole uprostřed sekvence zruší rozpracovaný skok', () => {
    const board = mount(doubleJump());
    click(squareEl(board, 6));
    click(squareEl(board, 15)); // mezidopad
    click(squareEl(board, 1)); // jiné hrací pole = reset
    expect(board.querySelectorAll('.selected, .path, .target')).toHaveLength(0);
    expect(hasPiece(board, 6, 'black')).toBe(true);
  });

  it('proměna na dámu při dopadu na poslední řadu se vykreslí jako king', async () => {
    // Černý muž 23 přeskočí bílého 27 a dopadne na 32 (poslední řada) → dáma.
    const promo = (): Position => position('black', { 23: blackMan, 27: whiteMan });
    const board = mount(promo(), { client: serverFake(promo()).client });
    click(squareEl(board, 23));
    click(squareEl(board, 32));
    await tick();

    expect(hasPiece(board, 32, 'black')).toBe(true);
    expect(squareEl(board, 32).querySelector('.piece.king')).not.toBeNull();
    expect(isEmpty(board, 27)).toBe(true);
  });
});

describe('stabilita kamenů při překreslení (nález 22-1)', () => {
  it('opakovaný update() se stejnou pozicí nerecykluje .piece element', () => {
    // Regrese: kdyby renderPiece kámen pokaždé mazal a tvořil znovu, poll à 250 ms
    // by spolkl klik, který na kámen právě padá. Element musí zůstat tentýž.
    const view = createBoardView(() => undefined);
    const pos = initialPosition();
    void view.update({ position: pos, selected: null, path: [], targets: [] });
    const before = view.element.querySelector('[data-square="9"] .piece');
    expect(before).not.toBeNull();

    void view.update({ position: pos, selected: null, path: [], targets: [] });
    const after = view.element.querySelector('[data-square="9"] .piece');
    expect(after).toBe(before); // stejná instance – žádná recyklace
  });

  it('proměna man→king upraví třídu beze změny elementu', () => {
    const view = createBoardView(() => undefined);
    void view.update({ position: position('black', { 9: blackMan }), selected: null, path: [], targets: [] });
    const man = view.element.querySelector('[data-square="9"] .piece');
    expect(man?.classList.contains('king')).toBe(false);

    void view.update({ position: position('black', { 9: blackKing }), selected: null, path: [], targets: [] });
    const king = view.element.querySelector('[data-square="9"] .piece');
    expect(king).toBe(man); // tentýž element
    expect(king?.classList.contains('king')).toBe(true);
  });

  it('odchod kamene z pole element odstraní', () => {
    const view = createBoardView(() => undefined);
    void view.update({ position: position('black', { 9: blackMan }), selected: null, path: [], targets: [] });
    expect(view.element.querySelector('[data-square="9"] .piece')).not.toBeNull();

    void view.update({ position: position('black', {}), selected: null, path: [], targets: [] });
    expect(view.element.querySelector('[data-square="9"] .piece')).toBeNull();
  });
});

describe('polling tahu enginu', () => {
  it('opakovaný dotaz přebere tah enginu a překreslí desku', async () => {
    const before = position('white', { 22: whiteMan }); // na tahu engine
    const after = position('black', { 18: whiteMan }); // engine už táhl
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(before, 'thinking')),
      getGame: () => Promise.resolve(gameDto(after)),
      postMove: () => Promise.resolve(gameDto(after)),
      resign: () => Promise.resolve(gameDto(after, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(after) }),
    };
    const board = mount(before, { client, game: gameDto(before, 'thinking'), pollIntervalMs: 5 });
    expect(hasPiece(board, 22, 'white')).toBe(true); // před pollingem

    await delay(30);
    expect(isEmpty(board, 22)).toBe(true);
    expect(hasPiece(board, 18, 'white')).toBe(true);
  });

  it('single-flight: dokud běží tah, polling se přeskočí', async () => {
    const start = initialPosition();
    let resolvePost: (value: GameDto) => void = () => undefined;
    const pending = new Promise<GameDto>((resolve) => {
      resolvePost = resolve;
    });
    let getCount = 0;
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () => {
        getCount += 1;
        return Promise.resolve(gameDto(start));
      },
      postMove: () => pending, // tah „visí" → busy zůstává true
      resign: () => Promise.resolve(gameDto(start, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(start) }),
    };
    const board = mount(start, { client, pollIntervalMs: 5 });

    click(squareEl(board, 9));
    click(squareEl(board, 13)); // prostý tah 9→13 → sendMove, postMove visí
    const countAfterClick = getCount;

    await delay(30); // proběhlo by víc poll tiků
    expect(getCount).toBe(countAfterClick); // žádný poll neproběhl (busy)

    resolvePost(gameDto(start)); // úklid – ať promise nezůstane висet
    await tick();
  });
});

describe('defenzivní cesty', () => {
  it('odmítnutý tah (409) dorovná stav z GET a deska se nezasekne', async () => {
    const start = initialPosition();
    const resynced = position('black', { 14: blackMan }); // odlišný serverový stav
    let getCount = 0;
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () => {
        getCount += 1;
        return Promise.resolve(gameDto(resynced));
      },
      postMove: () => Promise.reject(new ServerError(409, 'illegal_move', 'Nelegální tah')),
      resign: () => Promise.resolve(gameDto(resynced, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(resynced) }),
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const board = mount(start, { client });
    click(squareEl(board, 9));
    click(squareEl(board, 13)); // sendMove → postMove reject → resync přes GET
    await tick();

    expect(getCount).toBeGreaterThanOrEqual(1); // proběhlo dorovnání z GET
    expect(hasPiece(board, 14, 'black')).toBe(true); // deska přebrala serverový stav

    // Deska není zaseknutá: nový klik zase vybírá.
    click(squareEl(board, 14));
    expect(squareEl(board, 14).classList.contains('selected')).toBe(true);
  });

  it('síťová chyba při tahu nezasekne desku (busy se uvolní)', async () => {
    const start = initialPosition();
    let getFails = true;
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      // I dorovnání selže (síť pořád dole) – nesmí to nechat desku zaseknutou.
      getGame: () =>
        getFails
          ? Promise.reject(new ServerError(0, undefined, 'síť'))
          : Promise.resolve(gameDto(start)),
      postMove: () => Promise.reject(new ServerError(0, undefined, 'síť')),
      resign: () => Promise.reject(new ServerError(0, undefined, 'síť')),
      offerDraw: () => Promise.reject(new ServerError(0, undefined, 'síť')),
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const board = mount(start, { client });
    click(squareEl(board, 9));
    click(squareEl(board, 13)); // tah selže, i resync selže
    await tick();

    getFails = false; // „síť se vrátila"
    // Deska se nezasekla – další výběr funguje.
    click(squareEl(board, 9));
    expect(squareEl(board, 9).classList.contains('selected')).toBe(true);
  });

  it('engineStatus=error z pollingu jen zaloguje a desku nezasekne', async () => {
    const start = initialPosition();
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () => Promise.resolve(gameDto(start, 'error')),
      postMove: () => Promise.resolve(gameDto(start)),
      resign: () => Promise.resolve(gameDto(start, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(start) }),
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const board = mount(start, { client, pollIntervalMs: 5 });
    await delay(30); // proběhl poll s engineStatus=error

    expect(errorSpy).toHaveBeenCalled(); // chyba se zalogovala
    // Deska žije: na tahu je pořád člověk (černý), výběr funguje.
    click(squareEl(board, 9));
    expect(squareEl(board, 9).classList.contains('selected')).toBe(true);
  });
});

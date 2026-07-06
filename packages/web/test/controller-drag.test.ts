// @vitest-environment jsdom
import { applyMove, legalMoves } from '@checkers/rules';
import type { Cell, Color, GameResult, Move, Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import type { GameDto, ServerClient } from '../src/server-client.js';
import { ServerError } from '../src/server-client.js';
import type { SoundEvent, SoundPlayer } from '../src/sound.js';

/**
 * Testy drag & dropu na úrovni controller + board-view. jsdom nemá layout, proto
 * se pole pod bodem puštění dodá přes mock `document.elementFromPoint`; samotný
 * plynulý pohyb (WAAPI) tu neběží a ověří ho člověk. Testujeme LOGIKU dropu:
 * prostý tah, souvislé braní na koncové pole, hop po hopu, nelegální/mimo →
 * návrat, koexistenci s tapem, potlačení `click` po tažení a zvuk (jen `land`).
 */

const HUGE_INTERVAL = 1_000_000;
const disposers: (() => void)[] = [];

function gameDto(
  position: Position,
  engineStatus: GameDto['engineStatus'] = 'idle',
  result: GameResult = 'ongoing',
): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus, level: 'professional' };
}

function position(turn: Color, pieces: Record<number, Cell>): Position {
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  return { board, turn };
}

const blackMan: Cell = { color: 'black', kind: 'man' };
const whiteMan: Cell = { color: 'white', kind: 'man' };

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
}

function serverFake(start: Position): Fake {
  let pos = start;
  const posted: { from: number; path: number[] }[] = [];
  return {
    posted,
    client: {
      createGame: () => Promise.resolve(gameDto(pos)),
      getGame: () => Promise.resolve(gameDto(pos)),
      postMove: (_id, from, path) => {
        posted.push({ from, path: [...path] });
        pos = applyMove(pos, findMove(pos, from, path));
        return Promise.resolve(gameDto(pos));
      },
      resign: () => Promise.resolve(gameDto(pos, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(pos) }),
    },
  };
}

function fakePlayer(): { player: SoundPlayer; play: ReturnType<typeof vi.fn> } {
  const play = vi.fn();
  return { player: { unlock: vi.fn(), play }, play };
}
const countOf = (play: ReturnType<typeof vi.fn>, event: SoundEvent): number =>
  play.mock.calls.filter((c) => c[0] === event).length;

interface Mounted {
  readonly board: HTMLElement;
  readonly fake: Fake;
  readonly play: ReturnType<typeof vi.fn>;
}

function mount(start: Position): Mounted {
  const fake = serverFake(start);
  const { player, play } = fakePlayer();
  const controller = createBoardController(fake.client, gameDto(start), {
    pollIntervalMs: HUGE_INTERVAL,
    soundPlayer: player,
    aiMovePauseMs: 0,
  });
  disposers.push(() => {
    controller.dispose();
  });
  document.body.append(controller.element);
  return { board: controller.element, fake, play };
}

function squareEl(root: HTMLElement, square: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} nenalezeno`);
  }
  return el;
}
function hasPiece(root: HTMLElement, square: number, cls: string): boolean {
  return squareEl(root, square).querySelector(`.piece.${cls}`) !== null;
}
function isEmpty(root: HTMLElement, square: number): boolean {
  return squareEl(root, square).querySelector('.piece') === null;
}

/** Vyrobí pointer událost s potřebnými poli (jsdom neumí PointerEvent konstruktor spolehlivě). */
function pointer(type: string, x: number, y: number): Event {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, {
    pointerId: 1,
    isPrimary: true,
    pointerType: 'mouse',
    button: 0,
    clientX: x,
    clientY: y,
  });
  return e;
}

/**
 * Odsimuluje tažení kamene z pole `from` a puštění nad `to` (`to=null` = mimo
 * hrací pole). Pole pod bodem puštění dodá mock `elementFromPoint`. Threshold
 * překročíme skokem o 20 px.
 */
function drag(board: HTMLElement, from: number, to: number | null): void {
  const toEl = to === null ? null : squareEl(board, to);
  // jsdom nemá layout ani `elementFromPoint` – dodáme pole pod bodem puštění ručně.
  const doc = document as unknown as { elementFromPoint: (x: number, y: number) => Element | null };
  const original = doc.elementFromPoint;
  doc.elementFromPoint = () => toEl;
  try {
    squareEl(board, from).dispatchEvent(pointer('pointerdown', 0, 0));
    board.dispatchEvent(pointer('pointermove', 20, 20)); // > DRAG_THRESHOLD_PX
    board.dispatchEvent(pointer('pointerup', 40, 40));
  } finally {
    doc.elementFromPoint = original;
  }
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * Realistické ťuknutí: pointerdown + pointerup na stejném poli (bez pohybu) a pak
 * `click`. Důležité PO tažení – `pointerdown` shodí `suppressNextClick`, takže se
 * tento (nový, samostatný) tap nespolkne jako doznívající klik z gesta tažení.
 */
function tap(board: HTMLElement, square: number): void {
  const el = squareEl(board, square);
  el.dispatchEvent(pointer('pointerdown', 0, 0));
  el.dispatchEvent(pointer('pointerup', 0, 0));
  click(el);
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

describe('drag & drop – prostý tah', () => {
  it('tažení na legální pole odešle tah a usadí kámen (jen zvuk dopadu)', async () => {
    const { board, fake, play } = mount(position('black', { 9: blackMan }));
    drag(board, 9, 13);
    await tick();

    expect(fake.posted).toEqual([{ from: 9, path: [13] }]);
    expect(hasPiece(board, 13, 'black')).toBe(true);
    expect(isEmpty(board, 9)).toBe(true);
    // Tažením zní jen dopad, ne rozjezd (server potvrzení se usadí bez animace).
    expect(countOf(play, 'land')).toBe(1);
    expect(countOf(play, 'move')).toBe(0);
  });

  it('tažení na nelegální pole nic neodešle a vrátí kámen (žádný zvuk)', async () => {
    const { board, fake, play } = mount(position('black', { 9: blackMan }));
    drag(board, 9, 18); // 9 může jen na 13/14
    await tick();

    expect(fake.posted).toEqual([]);
    expect(hasPiece(board, 9, 'black')).toBe(true);
    expect(countOf(play, 'land')).toBe(0);
    expect(countOf(play, 'move')).toBe(0);
  });

  it('puštění mimo hrací pole (null) vrátí kámen', async () => {
    const { board, fake } = mount(position('black', { 9: blackMan }));
    drag(board, 9, null);
    await tick();

    expect(fake.posted).toEqual([]);
    expect(hasPiece(board, 9, 'black')).toBe(true);
  });

  it('kámen soupeře / mimo tah nejde táhnout', async () => {
    // Na tahu je bílý (engine) – černý kámen se nesmí zvednout.
    const { board, fake } = mount(position('white', { 9: blackMan, 22: whiteMan }));
    drag(board, 9, 13);
    await tick();
    expect(fake.posted).toEqual([]);
    expect(hasPiece(board, 9, 'black')).toBe(true);
  });
});

describe('drag & drop – braní', () => {
  // Černý 6 přeskočí bílé 10 a 18: cesta [15, 22].
  const dbl = (): Position => position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });

  it('souvislé tažení až na koncové pole pošle celý řetěz', async () => {
    const { board, fake } = mount(dbl());
    drag(board, 6, 22); // puštění rovnou na konec braní
    await tick();

    expect(fake.posted).toEqual([{ from: 6, path: [15, 22] }]);
    expect(hasPiece(board, 22, 'black')).toBe(true);
    expect(isEmpty(board, 6)).toBe(true);
    expect(isEmpty(board, 10)).toBe(true);
    expect(isEmpty(board, 18)).toBe(true);
  });

  it('hop po hopu: kámen zůstane na dopadu a čeká na další skok', async () => {
    const { board, fake, play } = mount(dbl());
    drag(board, 6, 15); // meziskok
    await tick();

    expect(fake.posted).toEqual([]); // ještě neodesláno
    expect(hasPiece(board, 15, 'black')).toBe(true); // kámen ZŮSTAL na dopadu 15
    expect(isEmpty(board, 6)).toBe(true); // výchozí pole prázdné
    expect(isEmpty(board, 10)).toBe(true); // sebraný meziskoku zmizel
    expect(squareEl(board, 22).classList.contains('target')).toBe(true); // nabídnut další dopad
    expect(countOf(play, 'land')).toBe(1); // dopad meziskoku
    expect(countOf(play, 'move')).toBe(0); // žádný zvuk rozjezdu

    // Druhé tažení začíná z dopadu 15 (tam kámen stojí) a tah dokončí.
    drag(board, 15, 22);
    await tick();
    expect(fake.posted).toEqual([{ from: 6, path: [15, 22] }]);
    expect(hasPiece(board, 22, 'black')).toBe(true);
    expect(isEmpty(board, 6)).toBe(true);
    expect(isEmpty(board, 18)).toBe(true);
  });

  it('poll během rozpracované sekvence nevzkřísí stav ani nerozhodí desku (nález 1)', async () => {
    // Reálný polling (malý interval): po meziskoku tažením musí deska zůstat
    // konzistentní – kámen na dopadu, sebraný pryč, nabídnutý další dopad. Dřív by
    // poll překreslil z neaktuální serverové pozice a stav rozhodil.
    const fake = serverFake(dbl());
    const controller = createBoardController(fake.client, gameDto(dbl()), {
      pollIntervalMs: 5,
      soundPlayer: fakePlayer().player,
      aiMovePauseMs: 0,
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);
    const board = controller.element;

    drag(board, 6, 15); // meziskok
    await new Promise((r) => setTimeout(r, 40)); // nech proběhnout několik poll tiků

    expect(fake.posted).toEqual([]); // sekvence se nedokončila
    expect(hasPiece(board, 15, 'black')).toBe(true); // kámen drží dopad, nevrátil se
    expect(isEmpty(board, 6)).toBe(true); // výchozí pole prázdné
    expect(isEmpty(board, 10)).toBe(true); // sebraný nevzkříšen
    expect(hasPiece(board, 18, 'white')).toBe(true); // druhý soupeř ještě na desce
    expect(squareEl(board, 22).classList.contains('target')).toBe(true); // další dopad drží

    // Sekvence jde pořád dokončit (tažením z dopadu 15).
    drag(board, 15, 22);
    await tick();
    expect(fake.posted).toEqual([{ from: 6, path: [15, 22] }]);
    expect(hasPiece(board, 22, 'black')).toBe(true);
  });

  it('hop lze dokončit i tapem (koexistence tap + drag v jedné sekvenci)', async () => {
    const { board, fake } = mount(dbl());
    drag(board, 6, 15); // meziskok tažením
    tap(board, 22); // dokončení ťuknutím (nový gest → suppressNextClick se shodí)
    await tick();
    expect(fake.posted).toEqual([{ from: 6, path: [15, 22] }]);
    expect(hasPiece(board, 22, 'black')).toBe(true);
  });
});

describe('drag & drop – chybová cesta serveru', () => {
  // Černý 6 přeskočí bílé 10 a 18: cesta [15, 22].
  const dbl = (): Position => position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan });

  it('odmítnutý tah tažením vrátí kámen z cíle na výchozí pole a obnoví sebrané', async () => {
    // Drag má jinou výchozí DOM situaci při selhání než tap: kámen je už opticky na
    // cíli a sebrané jsou odstraněné. Odmítnutí (409) musí desku dorovnat ze serveru.
    const start = dbl();
    let getCalls = 0;
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      // GET vrací PŮVODNÍ stav (tah se neprovedl) – podle něj se deska dorovná.
      getGame: () => {
        getCalls += 1;
        return Promise.resolve(gameDto(start));
      },
      postMove: () => Promise.reject(new ServerError(409, 'illegal_move', 'Nelegální tah')),
      resign: () => Promise.resolve(gameDto(start, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(start) }),
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: HUGE_INTERVAL,
      soundPlayer: fakePlayer().player,
      aiMovePauseMs: 0,
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);
    const board = controller.element;

    drag(board, 6, 22); // souvislé braní; server ho odmítne
    await tick();
    await tick();

    expect(getCalls).toBeGreaterThanOrEqual(1); // proběhlo dorovnání z GET
    expect(hasPiece(board, 6, 'black')).toBe(true); // kámen zpět na výchozím poli
    expect(hasPiece(board, 10, 'white')).toBe(true); // sebrané obnoveny
    expect(hasPiece(board, 18, 'white')).toBe(true);
    expect(isEmpty(board, 22)).toBe(true); // z cíle zmizel

    // Deska není zaseknutá: nový výběr zase funguje (canDrag/busy se uvolnily).
    tap(board, 6); // tap = nové gesto (pointerdown shodí suppressNextClick z dragu)
    expect(squareEl(board, 6).classList.contains('selected')).toBe(true);
  });
});

describe('drag & drop – uchopení při stisku', () => {
  it('pointerdown na vlastním kameni ho hned vybere, zvýrazní cíle a zapne grabbing', () => {
    const { board } = mount(position('black', { 9: blackMan }));
    squareEl(board, 9).dispatchEvent(pointer('pointerdown', 0, 0));

    // Uchopení dá okamžitou zpětnou vazbu ještě před jakýmkoli pohybem/puštěním.
    expect(squareEl(board, 9).classList.contains('selected')).toBe(true);
    expect(squareEl(board, 13).classList.contains('target')).toBe(true);
    expect(squareEl(board, 14).classList.contains('target')).toBe(true);
    expect(board.classList.contains('grabbing')).toBe(true); // kurzor „pěst" po dobu držení
  });

  it('puštění na stejném poli kámen nechá vybraný a vypne grabbing', () => {
    const { board, fake } = mount(position('black', { 9: blackMan }));
    // Uchop a pusť na tomtéž poli (žádný pohyb) – jako klik myší na kámen.
    const el = squareEl(board, 9);
    el.dispatchEvent(pointer('pointerdown', 0, 0));
    const doc = document as unknown as { elementFromPoint: (x: number, y: number) => Element | null };
    const original = doc.elementFromPoint;
    doc.elementFromPoint = () => el;
    try {
      el.dispatchEvent(pointer('pointerup', 0, 0));
    } finally {
      doc.elementFromPoint = original;
    }

    expect(board.classList.contains('grabbing')).toBe(false); // držení skončilo
    expect(squareEl(board, 9).classList.contains('selected')).toBe(true); // zůstal vybraný
    expect(fake.posted).toEqual([]); // nic se neodeslalo
  });

  it('nad kamenem soupeře uchopení nenastane (grabbing se nezapne)', () => {
    const { board } = mount(position('white', { 9: blackMan, 22: whiteMan }));
    squareEl(board, 9).dispatchEvent(pointer('pointerdown', 0, 0));
    expect(board.classList.contains('grabbing')).toBe(false);
    expect(squareEl(board, 9).classList.contains('selected')).toBe(false);
  });

  it('pointercancel uprostřed tažení uklidí stav a další uchopení zase funguje', () => {
    // Regrese: prohlížeč občas gesto zruší (nativní drag) → pointercancel, často s
    // clientX/Y = 0. Nesmí to desku zaseknout (jinak „nejde tažení, jen klik").
    const { board } = mount(position('black', { 9: blackMan }));
    squareEl(board, 9).dispatchEvent(pointer('pointerdown', 100, 100));
    board.dispatchEvent(pointer('pointermove', 120, 120));
    expect(board.classList.contains('grabbing')).toBe(true);

    board.dispatchEvent(pointer('pointercancel', 0, 0));
    expect(board.classList.contains('grabbing')).toBe(false); // uklizeno

    // Deska není zaseknutá: nové uchopení zase zvedne a vybere.
    squareEl(board, 9).dispatchEvent(pointer('pointerdown', 100, 100));
    expect(board.classList.contains('grabbing')).toBe(true);
    expect(squareEl(board, 9).classList.contains('selected')).toBe(true);
  });
});

describe('drag & drop – koexistence s tapem', () => {
  it('ťuknutí (tap) dál vybírá a táhne beze změny', async () => {
    const { board, fake } = mount(position('black', { 9: blackMan }));
    click(squareEl(board, 9));
    expect(squareEl(board, 9).classList.contains('selected')).toBe(true);
    click(squareEl(board, 13));
    await tick();
    expect(fake.posted).toEqual([{ from: 9, path: [13] }]);
  });

  it('po tažení se následný click spolkne (tažení není i tap)', async () => {
    const { board, fake } = mount(position('black', { 9: blackMan }));
    drag(board, 9, 18); // nelegální → návrat, ale nastaví suppressNextClick
    // Prohlížeč by po gestu ještě vyslal click – ten musí být ignorován.
    click(squareEl(board, 14));
    await tick();
    expect(fake.posted).toEqual([]); // spolknutý klik neodeslal 9→14

    // Další (už nepotlačený) klik zase funguje.
    click(squareEl(board, 14));
    await tick();
    expect(fake.posted).toEqual([{ from: 9, path: [14] }]);
  });
});

// @vitest-environment jsdom
import type { Cell, Color, Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardView } from '../src/board-view.js';
import type { BoardView } from '../src/board-view.js';
import type { SoundPlayer } from '../src/sound.js';

/**
 * Tyto testy ověřují pohyb kamenů, ne zvuk. Injektujeme tichý přehrávač, ať se
 * v jsdom nevolá reálné `Audio.play()` (nepodporované → hlásí „Not implemented").
 * Ozvučení má vlastní testy v `board-view-sound.test.ts`.
 */
const SILENT: SoundPlayer = { unlock: () => undefined, play: () => undefined };

/**
 * Testy ANIMAČNÍ vrstvy. jsdom sám Web Animations API nemá, takže by animace
 * nikdy nenaběhla – proto tu `Element.prototype.animate` (a getBoundingClientRect)
 * mockujeme. Bez toho by celá cesta `startAnimation`/snap/mizení byla mrtvá a
 * nešla by otestovat (kdyby se rozbila, testy by o tom mlčely).
 */

const blackMan: Cell = { color: 'black', kind: 'man' };
const whiteMan: Cell = { color: 'white', kind: 'man' };

function position(turn: Color, pieces: Record<number, Cell>): Position {
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  return { board, turn };
}

/** Řízená fake-animace: `finished` vyřešíme, až kdy test chce; `cancel` je špeh. */
interface FakeAnimation {
  finished: Promise<void>;
  resolve: () => void;
  cancel: ReturnType<typeof vi.fn>;
  pause: () => void; // drag lift ho volá (kámen drží posun, dokud ho updateLift nepřepíše)
}

const animations: FakeAnimation[] = [];

function squareEl(view: BoardView, square: number): HTMLElement {
  const el = view.element.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} nenalezeno`);
  }
  return el;
}

const hasPiece = (view: BoardView, square: number): boolean =>
  squareEl(view, square).querySelector('.piece') !== null;

const isMoving = (view: BoardView, square: number): boolean =>
  squareEl(view, square).querySelector('.piece.moving') !== null;

/** Nechá doběhnout mikroúlohy (řetěz `.finished.then(...)`). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

/**
 * Vyřeší všechny fake-animace a nechá doběhnout návazné `then`. Opakuje po kolech,
 * protože doběhnutí posunu kamene teprve SPUSTÍ fade sebraných (nové animace).
 */
async function resolveAll(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    const before = animations.length;
    for (const a of animations) {
      a.resolve();
    }
    await flush();
    if (animations.length === before) {
      break; // nevznikly žádné nové animace → hotovo
    }
  }
}

beforeEach(() => {
  document.body.replaceChildren();
  animations.length = 0;
  // jsdom `animate` na prototypu NEMÁ – nejde spyOn, proto ho definujeme.
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: () => {
      let resolve: () => void = () => undefined;
      const finished = new Promise<void>((r) => {
        resolve = r;
      });
      const anim: FakeAnimation = { finished, resolve, cancel: vi.fn(), pause: () => undefined };
      animations.push(anim);
      return anim as unknown as Animation;
    },
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    const sq = Number((this as HTMLElement).dataset.square ?? '0');
    return { left: sq * 10, top: sq * 10, right: 0, bottom: 0, width: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'animate');
  document.body.replaceChildren();
});

describe('animace tahu (mockované WAAPI)', () => {
  // Černý muž 6 přeskočí bílého 10, dopadne na 15.
  const prev = (): Position => position('black', { 6: blackMan, 10: whiteMan });
  const next = (): Position => position('white', { 15: blackMan });

  it('rozjede skok: kámen je vyzdvižený v cíli, sebraný ještě drží', () => {
    const view = createBoardView(() => undefined, SILENT);
    document.body.append(view.element);
    void view.update({ position: prev(), selected: null, path: [], targets: [] });
    void view.update({ position: next(), selected: null, path: [], targets: [] });

    // Kámen je v cílovém poli a označený jako pohybující se.
    expect(hasPiece(view, 15)).toBe(true);
    expect(isMoving(view, 15)).toBe(true);
    // Výchozí pole prázdné, ale SEBRANÝ kámen se ještě drží (zmizí až při skoku).
    expect(hasPiece(view, 6)).toBe(false);
    expect(hasPiece(view, 10)).toBe(true);
    // Animace se opravdu spustila (posun kamene).
    expect(animations.length).toBeGreaterThanOrEqual(1);
  });

  it('po doběhnutí: sebraný zmizí, kámen v cíli bez třídy moving', async () => {
    const view = createBoardView(() => undefined, SILENT);
    document.body.append(view.element);
    void view.update({ position: prev(), selected: null, path: [], targets: [] });
    void view.update({ position: next(), selected: null, path: [], targets: [] });

    await resolveAll();

    expect(hasPiece(view, 15)).toBe(true);
    expect(isMoving(view, 15)).toBe(false);
    expect(hasPiece(view, 10)).toBe(false); // sebraný odebrán
    expect(hasPiece(view, 6)).toBe(false);
  });

  it('jiná pozice během animace ji přeruší (snap na cíl) a zpracuje novou', () => {
    const view = createBoardView(() => undefined, SILENT);
    document.body.append(view.element);
    void view.update({ position: prev(), selected: null, path: [], targets: [] });
    void view.update({ position: next(), selected: null, path: [], targets: [] });
    const moverAnim = animations[0];

    // Přijde JINÁ pozice (nejde o jeden tah z `next` → instant): 15 zůstává,
    // navíc „přibude" bílý na 22 → diffMove vrátí null.
    const other = position('black', { 15: blackMan, 22: whiteMan });
    void view.update({ position: other, selected: null, path: [], targets: [] });

    // Běžící animace byla zrušena (snap).
    expect(moverAnim?.cancel).toHaveBeenCalled();
    // Deska je na nové pozici, nic nevisí jako moving, sebraný je pryč.
    expect(hasPiece(view, 15)).toBe(true);
    expect(hasPiece(view, 22)).toBe(true);
    expect(hasPiece(view, 10)).toBe(false);
    expect(view.element.querySelectorAll('.piece.moving')).toHaveLength(0);
  });

  it('stejná pozice (opakovaný poll) animaci NEPŘERUŠÍ', () => {
    const view = createBoardView(() => undefined, SILENT);
    document.body.append(view.element);
    void view.update({ position: prev(), selected: null, path: [], targets: [] });
    void view.update({ position: next(), selected: null, path: [], targets: [] });
    const moverAnim = animations[0];

    // Tentýž stav (poll à 250 ms vrací stejnou pozici) – animace běží dál.
    void view.update({ position: next(), selected: null, path: [], targets: [] });

    expect(moverAnim?.cancel).not.toHaveBeenCalled();
    expect(isMoving(view, 15)).toBe(true);
  });

  it('dispose() uprostřed animace ji zruší a dorovná desku', () => {
    const view = createBoardView(() => undefined, SILENT);
    document.body.append(view.element);
    void view.update({ position: prev(), selected: null, path: [], targets: [] });
    void view.update({ position: next(), selected: null, path: [], targets: [] });
    const moverAnim = animations[0];

    view.dispose();

    expect(moverAnim?.cancel).toHaveBeenCalled();
    expect(view.element.querySelectorAll('.piece.moving')).toHaveLength(0);
    expect(hasPiece(view, 15)).toBe(true);
    expect(hasPiece(view, 10)).toBe(false);
  });
});

/** Pointer událost (jsdom neumí spolehlivě konstruktor). */
function pointerEvt(type: string, x: number, y: number): Event {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
  return e;
}

/** Odsimuluje tažení z pole `from` na `to` (pole pod bodem puštění přes mock elementFromPoint). */
function dragTo(view: BoardView, from: number, to: number): void {
  const toEl = squareEl(view, to);
  const doc = document as unknown as { elementFromPoint: (x: number, y: number) => Element | null };
  const original = doc.elementFromPoint;
  doc.elementFromPoint = () => toEl;
  try {
    squareEl(view, from).dispatchEvent(pointerEvt('pointerdown', 0, 0));
    view.element.dispatchEvent(pointerEvt('pointermove', 20, 20));
    view.element.dispatchEvent(pointerEvt('pointerup', 40, 40));
  } finally {
    doc.elementFromPoint = original;
  }
}

describe('usazení desky během doznívajícího fadu sebraného kamene (mockované WAAPI)', () => {
  // Tažené braní 6 → 15 přes bílého 10; onDrop dodá 'commit' se sebraným 10.
  const beforeMove = (): Position => position('black', { 6: blackMan, 10: whiteMan });

  it('settle na pozici PŘED braním obnoví sebraný kámen, i když jeho fade doběhne', async () => {
    const view = createBoardView(() => undefined, SILENT, {
      canDrag: () => true,
      onDragStart: () => undefined,
      onDrop: () => ({ kind: 'commit', landing: 15, captured: [10] }),
    });
    document.body.append(view.element);
    view.settle({ position: beforeMove(), selected: null, path: [], targets: [] });

    // Táhni braní: kámen na 15, sebraný 10 začne mizet (fade běží, element ještě drží).
    dragTo(view, 6, 15);
    expect(hasPiece(view, 15)).toBe(true);
    expect(hasPiece(view, 10)).toBe(true); // fade ještě neodstranil

    // Server tah ODMÍTL → deska se usadí zpět na pozici před tahem (kámen 6, sebraný 10).
    view.settle({ position: beforeMove(), selected: null, path: [], targets: [] });
    expect(hasPiece(view, 6)).toBe(true);
    expect(hasPiece(view, 10)).toBe(true);
    expect(hasPiece(view, 15)).toBe(false);

    // I když teď doběhnou VŠECHNY fake-animace (včetně fadu sebraného), kámen 10
    // ZŮSTANE – revive fade zrušil a jeho `finished` handler element neodstraní.
    await resolveAll();
    expect(hasPiece(view, 10)).toBe(true);
  });
});

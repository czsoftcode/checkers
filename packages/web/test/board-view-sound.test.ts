// @vitest-environment jsdom
import type { Cell, Color, Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardView } from '../src/board-view.js';
import type { SoundEvent, SoundPlayer } from '../src/sound.js';

/**
 * Testy OZVUČENÍ animace tahu. Dvě události:
 * - `move` (rozjezd) zní JEDNOU na začátku tahu,
 * - `land` (dopad) zní na KAŽDÉM dopadu: mezidopady přes `setTimeout`
 *   (`hopArrivalMs`), finální dopad v `finalize` na vyřešení `anim.finished`
 *   (aby ho `clearTimers` nemohl uklidit dřív, než zazní).
 *
 * Fake `animate` proto musí jít vyřešit – jinak by test žil ve světě, kde
 * finalize nikdy neproběhne, a finální dopad by nikdy netestoval.
 */

const blackMan: Cell = { color: 'black', kind: 'man' };
const whiteMan: Cell = { color: 'white', kind: 'man' };

function position(turn: Color, pieces: Record<number, Cell>): Position {
  const board: Cell[] = Array.from({ length: 32 }, (_, i) => pieces[i + 1] ?? null);
  return { board, turn };
}

function fakePlayer(): { player: SoundPlayer; play: ReturnType<typeof vi.fn> } {
  const play = vi.fn();
  return { player: { unlock: vi.fn(), play }, play };
}

/** Kolikrát padla daná událost. */
const countOf = (play: ReturnType<typeof vi.fn>, event: SoundEvent): number =>
  play.mock.calls.filter((c) => c[0] === event).length;

/** Řízená fake-animace: `finished` vyřešíme (finalize) až kdy test chce. */
interface FakeAnimation {
  finished: Promise<void>;
  resolve: () => void;
  cancel: ReturnType<typeof vi.fn>;
}
const animations: FakeAnimation[] = [];

/** Nechá doběhnout mikroúlohy (řetěz `.finished.then(...)`). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

/**
 * Vyřeší všechny animace (mover i následné fade sebraných) a nechá doběhnout
 * finalize. Opakuje po kolech, protože dokončení moveru teprve SPUSTÍ fade
 * sebraných (nové animace).
 */
async function finishAnimation(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    const before = animations.length;
    for (const a of animations) {
      a.resolve();
    }
    await flush();
    if (animations.length === before) {
      break;
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  animations.length = 0;
  document.body.replaceChildren();
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: () => {
      let resolve: () => void = () => undefined;
      const finished = new Promise<void>((r) => {
        resolve = r;
      });
      const anim: FakeAnimation = { finished, resolve, cancel: vi.fn() };
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
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, 'animate');
  document.body.replaceChildren();
});

describe('ozvučení animace tahu', () => {
  it('prostý tah: rozjezd na začátku, dopad až na dokončení animace', async () => {
    const { player, play } = fakePlayer();
    const view = createBoardView(() => undefined, player);
    document.body.append(view.element);

    void view.update({ position: position('black', { 9: blackMan }), selected: null, path: [], targets: [] });
    void view.update({ position: position('white', { 13: blackMan }), selected: null, path: [], targets: [] });

    // Rozjezd zazní hned na začátku; dopad ještě ne (nevisí na timeru).
    expect(countOf(play, 'move')).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(countOf(play, 'land')).toBe(0);

    // Teprve dokončení animace (finalize, které navíc volá clearTimers) přehraje dopad.
    await finishAnimation();
    expect(countOf(play, 'move')).toBe(1);
    expect(countOf(play, 'land')).toBe(1);
  });

  it('dvojskok: střídá se rozjezd→dopad→rozjezd→dopad (bez hluchého místa)', async () => {
    const { player, play } = fakePlayer();
    const view = createBoardView(() => undefined, player);
    document.body.append(view.element);

    // Černý 6 přeskočí 10 (dopad 15) a pak 18 (dopad 22) → hops = [15, 22].
    // HOP_MS=300, DWELL_MS=300: dopad hop0 @300, rozjezd hop1 @600, dopad hop1 @konec.
    void view.update({
      position: position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan }),
      selected: null,
      path: [],
      targets: [],
    });
    void view.update({ position: position('white', { 22: blackMan }), selected: null, path: [], targets: [] });

    // t=0: rozjezd prvního skoku.
    expect(countOf(play, 'move')).toBe(1);
    expect(countOf(play, 'land')).toBe(0);

    // t=300: mezidopad (dopad prvního skoku).
    vi.advanceTimersByTime(300);
    expect(countOf(play, 'move')).toBe(1);
    expect(countOf(play, 'land')).toBe(1);

    // t=600: rozjezd druhého skoku (po prodlevě = délce skoku na mezidopadu).
    vi.advanceTimersByTime(300);
    expect(countOf(play, 'move')).toBe(2);
    expect(countOf(play, 'land')).toBe(1);

    // Finální dopad nevisí na timeru – přidá ho až dokončení animace.
    vi.advanceTimersByTime(5000);
    expect(countOf(play, 'land')).toBe(1);
    await finishAnimation();
    expect(countOf(play, 'land')).toBe(2);
    expect(countOf(play, 'move')).toBe(2);
  });

  it('mezidopad zazní dřív než finální dopad (postupně, ne naráz)', () => {
    const { player, play } = fakePlayer();
    const view = createBoardView(() => undefined, player);
    document.body.append(view.element);

    void view.update({
      position: position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan }),
      selected: null,
      path: [],
      targets: [],
    });
    void view.update({ position: position('white', { 22: blackMan }), selected: null, path: [], targets: [] });

    expect(countOf(play, 'land')).toBe(0); // před prvním dopadem žádný dopad
    vi.advanceTimersByTime(300); // po prvním skoku (HOP_MS) → mezidopad
    expect(countOf(play, 'land')).toBe(1);
  });

  it('přerušení tahu zruší DOPADY (rozjezd už zazněl, dopady ne)', async () => {
    const { player, play } = fakePlayer();
    const view = createBoardView(() => undefined, player);
    document.body.append(view.element);

    void view.update({
      position: position('black', { 6: blackMan, 10: whiteMan, 18: whiteMan }),
      selected: null,
      path: [],
      targets: [],
    });
    void view.update({ position: position('white', { 22: blackMan }), selected: null, path: [], targets: [] });

    // Přeruš PŘED prvním dopadem jinou pozicí (dva kameny navíc → diffMove null → instant).
    const other = position('black', { 22: blackMan, 5: whiteMan, 14: whiteMan });
    void view.update({ position: other, selected: null, path: [], targets: [] });

    vi.advanceTimersByTime(5000);
    await finishAnimation(); // i kdyby zrušená animace „doběhla", finalize je cancelled
    expect(countOf(play, 'move')).toBe(1); // rozjezd stihl zaznít při startu
    expect(countOf(play, 'land')).toBe(0); // žádný dopad
  });

  it('bez WAAPI (reduced-motion / staré prostředí) reálný tah zahraje jeden dopad', () => {
    // Odeber animate → canAnimate() vrátí false → tah jde přes instant.
    Reflect.deleteProperty(Element.prototype, 'animate');
    const { player, play } = fakePlayer();
    const view = createBoardView(() => undefined, player);
    document.body.append(view.element);

    void view.update({ position: position('black', { 9: blackMan }), selected: null, path: [], targets: [] });
    expect(play).not.toHaveBeenCalled(); // první render (move===null) je tichý
    void view.update({ position: position('white', { 13: blackMan }), selected: null, path: [], targets: [] });

    // Instant překreslení (kámen rovnou „dopadne"): zazní dopad, ne rozjezd.
    expect(countOf(play, 'land')).toBe(1);
    expect(countOf(play, 'move')).toBe(0);
  });

  it('dispose během animace zruší dopady', async () => {
    const { player, play } = fakePlayer();
    const view = createBoardView(() => undefined, player);
    document.body.append(view.element);

    void view.update({ position: position('black', { 9: blackMan }), selected: null, path: [], targets: [] });
    void view.update({ position: position('white', { 13: blackMan }), selected: null, path: [], targets: [] });

    view.dispose();

    vi.advanceTimersByTime(5000);
    await finishAnimation();
    expect(countOf(play, 'land')).toBe(0);
  });
});

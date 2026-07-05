// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import type { GameDto, ServerClient } from '../src/server-client.js';
import type { SoundEvent, SoundPlayer } from '../src/sound.js';

/**
 * Testy ZVUKU KONCE PARTIE. Člověk hraje černé (HUMAN_COLOR), takže `black-wins`
 * je výhra (fanfára), `white-wins` prohra a `draw` zvuk remízy. Zvuk
 * zazní JEDNOU na přechodu ongoing → terminální stav, ne při načtení už skončené
 * partie a ne opakovaně dalšími polly. Player injektujeme fake, ať netřeba Audio.
 */

const HUGE_INTERVAL = 1_000_000;
const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'animate'); // pro test s mockovaným WAAPI
});

function gameDto(position: Position, result: GameDto['result'] = 'ongoing'): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle' };
}

function fakePlayer(): {
  player: SoundPlayer;
  play: ReturnType<typeof vi.fn>;
  unlock: ReturnType<typeof vi.fn>;
} {
  const play = vi.fn();
  const unlock = vi.fn();
  return { player: { unlock, play }, play, unlock };
}

const countOf = (play: ReturnType<typeof vi.fn>, event: SoundEvent): number =>
  play.mock.calls.filter((c) => c[0] === event).length;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Klient, jehož getGame (poll) vrací zadaný výsledek. */
function pollingClient(pollResult: GameDto): ServerClient {
  const start = initialPosition();
  return {
    createGame: () => Promise.resolve(gameDto(start)),
    getGame: () => Promise.resolve(pollResult),
    postMove: () => Promise.resolve(pollResult),
    resign: () => Promise.resolve(gameDto(afterOpening(), 'white-wins')),
    offerDraw: () => Promise.resolve({ accepted: true, game: gameDto(afterOpening(), 'draw') }),
  };
}

/**
 * Klient, jehož poll vrací TÝŽ `position`, ale s výsledky podle `results` v pořadí
 * (poslední se drží dál). Simuluje server, který by identickou desku poslal
 * nejdřív jako `ongoing`, pak terminální.
 */
function sequencedClient(position: Position, results: GameDto['result'][]): ServerClient {
  let i = 0;
  const at = (): GameDto => gameDto(position, results[Math.min(i, results.length - 1)]);
  return {
    createGame: () => Promise.resolve(gameDto(initialPosition())),
    getGame: () => {
      const dto = at();
      i++;
      return Promise.resolve(dto);
    },
    postMove: () => Promise.resolve(gameDto(position, results[results.length - 1])),
    resign: () => Promise.resolve(gameDto(position, 'white-wins')),
    offerDraw: () => Promise.resolve({ accepted: true, game: gameDto(position, 'draw') }),
  };
}

/** Namockuje WAAPI s ručně řízeným `finished`; vrací resolver poslední animace. */
function mockControllableAnimation(): { resolve: () => void } {
  const ref = { resolve: (): void => undefined };
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: () => {
      const finished = new Promise<void>((resolve) => {
        ref.resolve = resolve;
      });
      return { finished, cancel: vi.fn() } as unknown as Animation;
    },
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 0, bottom: 0, width: 10, height: 10, x: 0, y: 0, toJSON: () => ({}),
  });
  return ref;
}

function mount(client: ServerClient, initial: GameDto, player: SoundPlayer, pollIntervalMs = HUGE_INTERVAL): ReturnType<typeof createBoardController> {
  const controller = createBoardController(client, initial, { pollIntervalMs, soundPlayer: player });
  disposers.push(() => {
    controller.dispose();
  });
  return controller;
}

describe('zvuk konce partie', () => {
  it('výhra člověka (black-wins) přehraje fanfáru, jednou', async () => {
    const { player, play } = fakePlayer();
    const start = initialPosition();
    // Poll à malý interval dorovná stav na black-wins.
    mount(pollingClient(gameDto(afterOpening(), 'black-wins')), gameDto(start), player, 5);

    // Zvuk konce je zpožděný ~500 ms za dokončením animace tahu (v jsdom bez
    // WAAPI jde tah přes instant → resolve hned, pak prodleva END_SOUND_DELAY_MS).
    await delay(600);
    expect(countOf(play, 'win')).toBe(1);
    expect(countOf(play, 'loss')).toBe(0);

    // Další polly (pořád black-wins) už zvuk NEopakují.
    await delay(200);
    expect(countOf(play, 'win')).toBe(1);
  });

  it('zvuk konce ČEKÁ na dokončení animace vítězného tahu (ne na jeho začátek)', async () => {
    const anim = mockControllableAnimation();
    const { player, play } = fakePlayer();
    const start = initialPosition();
    // Poll dorazí s vítězným tahem 9→13 (black-wins) → deska ho animuje.
    mount(pollingClient(gameDto(afterOpening(), 'black-wins')), gameDto(start), player, 5);

    await delay(50);
    // Animace vítězného tahu BĚŽÍ (finished nevyřešené) → fanfára ještě NEzazněla.
    // Přesně tohle byl bug: zvuk se pouštěl synchronně na začátku tahu.
    expect(countOf(play, 'win')).toBe(0);

    anim.resolve(); // tah dokončen (poslední dopad)
    await delay(600); // + prodleva END_SOUND_DELAY_MS
    expect(countOf(play, 'win')).toBe(1);
  });

  it('stejná pozice ongoing→terminální během animace: zvuk stále čeká na konec', async () => {
    // Server (hypoteticky) pošle TÝŽ vítězný tah nejdřív jako ongoing, pak
    // black-wins. Druhý snímek spadne do „running same position" větve – ta musí
    // vrátit promise BĚŽÍCÍ animace, ne hned vyřešený, jinak zvuk zazní do pohybu.
    const anim = mockControllableAnimation();
    const { player, play } = fakePlayer();
    const start = initialPosition();
    mount(sequencedClient(afterOpening(), ['ongoing', 'black-wins']), gameDto(start), player, 5);

    // Oba snímky dorazily, animace pořád běží (finished nevyřešené).
    await delay(600);
    expect(countOf(play, 'win')).toBe(0); // KLÍČ: i po >500 ms mlčí, dokud tah běží

    anim.resolve();
    await delay(600);
    expect(countOf(play, 'win')).toBe(1);
  });

  it('prohra člověka (white-wins) přehraje zvuk prohry', async () => {
    const { player, play } = fakePlayer();
    const start = initialPosition();
    mount(pollingClient(gameDto(afterOpening(), 'white-wins')), gameDto(start), player, 5);

    await delay(600);
    expect(countOf(play, 'loss')).toBe(1);
    expect(countOf(play, 'win')).toBe(0);
  });

  it('remíza přehraje zvuk remízy, jednou', async () => {
    const { player, play } = fakePlayer();
    const start = initialPosition();
    // Poll à malý interval dorovná stav na draw.
    mount(pollingClient(gameDto(afterOpening(), 'draw')), gameDto(start), player, 5);

    await delay(600); // zvuk remízy přijde až po prodlevě za dokončením tahu
    expect(countOf(play, 'draw')).toBe(1);
    expect(countOf(play, 'win')).toBe(0);
    expect(countOf(play, 'loss')).toBe(0);

    // Další polly (pořád draw) už zvuk NEopakují.
    await delay(300);
    expect(countOf(play, 'draw')).toBe(1);
  });

  it('vzdání = zvuk prohry (a odemkne audio)', async () => {
    const { player, play, unlock } = fakePlayer();
    const start = initialPosition();
    const controller = mount(pollingClient(gameDto(start)), gameDto(start), player);

    controller.resign();
    await tick();
    await tick();
    expect(unlock).toHaveBeenCalled(); // vzdání je gest → odemče autoplay (hned)

    await delay(600); // zvuk prohry přijde až po prodlevě za dokončením tahu
    expect(countOf(play, 'loss')).toBe(1);
  });

  it('načtení UŽ skončené partie nezvučí (žádný přechod z ongoing)', async () => {
    const { player, play } = fakePlayer();
    const ended = gameDto(afterOpening(), 'white-wins');
    // Partie je založená rovnou jako white-wins; poll vrací totéž.
    mount(pollingClient(ended), ended, player, 5);

    await delay(600); // žádný přechod z ongoing → ticho i po prodlevě
    expect(countOf(play, 'win')).toBe(0);
    expect(countOf(play, 'loss')).toBe(0);
  });
});

/**
 * Zvuk TAHU AI. Člověk (černý) táhne první, engine (bílý) odpovídá; jeho tah
 * dorazí klientovi až pollem (POST tahu vrací stav hned po tahu člověka). Tady
 * reprodukujeme render tahu enginu: partie startuje po tahu člověka (na tahu
 * bílý) a poll doručí pozici po tahu enginu. `board-view` ten rozdíl přehraje
 * jako zvuk (rozjezd/dopad). Reálné odemčení autoplay (unlock) se dělá na
 * uživatelské gesto v prohlížeči – to jsdom neověří (viz report, human-verify).
 */

/** Zvuky vlastního POHYBU kamene (rozjezd + dopady), bez zvuků konce partie. */
const moveSoundCount = (play: ReturnType<typeof vi.fn>): number =>
  countOf(play, 'move') + countOf(play, 'land');

/** Pozice po tahu enginu (bílý 22→18); z `afterOpening` (na tahu bílý) → na tahu černý. */
function afterEngineReply(afterHuman: Position): Position {
  // Pojistka proti tichému chybnému předpokladu o rozestavění: 22 MUSÍ být bílý
  // kámen a 18 prázdné, jinak by diff nedával jeden tah bílého.
  const from = afterHuman.board[22 - 1];
  if (from === null || from?.color !== 'white') {
    throw new Error('Test čekal bílý kámen na poli 22 (rozestavění se změnilo).');
  }
  if (afterHuman.board[18 - 1] !== null) {
    throw new Error('Test čekal prázdné pole 18 (rozestavění se změnilo).');
  }
  const board = afterHuman.board.slice();
  board[22 - 1] = null;
  board[18 - 1] = { color: 'white', kind: 'man' };
  return { board, turn: 'black' };
}

describe('zvuk tahu AI (dorazí pollem)', () => {
  it('tah enginu z pollu spustí zvuk pohybu', async () => {
    const { player, play } = fakePlayer();
    const afterHuman = afterOpening(); // člověk odehrál 9→13, na tahu bílý (engine)
    const afterEngine = afterEngineReply(afterHuman);
    // Partie stojí po tahu člověka; poll doručí tah enginu (jiná pozice).
    mount(pollingClient(gameDto(afterEngine)), gameDto(afterHuman), player, 5);

    await delay(50); // poll stihne dorazit a board-view tah enginu přehraje
    expect(moveSoundCount(play)).toBeGreaterThanOrEqual(1);
  });

  it('shodná pozice z pollu (nic se nezměnilo) žádný zvuk pohybu nespustí', async () => {
    const { player, play } = fakePlayer();
    const afterHuman = afterOpening();
    // Poll vrací TÝŽ stav jako start → diff je prázdný → board-view nic nepřehraje.
    mount(pollingClient(gameDto(afterHuman)), gameDto(afterHuman), player, 5);

    await delay(50);
    expect(moveSoundCount(play)).toBe(0);
  });
});

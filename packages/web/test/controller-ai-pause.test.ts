// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import type { GameDto, ServerClient } from '../src/server-client.js';

/**
 * Rozmýšlecí PAUZA AI. Po tahu člověka (černý) engine (bílý) odpovídá; jeho tah
 * dorazí klientovi až pollem. Aby tah AI „neproblikl" hned po dopadu tvého tahu,
 * controller ho pozdrží: od konce animace tahu člověka nechá uplynout aspoň
 * `aiMovePauseMs`. Je to PODLAHA – když engine počítal dlouho, pauza už uplynula
 * a nečeká se znovu (jinak by se zdržení přičítalo a hra by byla líná).
 *
 * jsdom nemá WAAPI → tah člověka jde přes „instant" (bez animace), takže konec
 * animace = hned; časování pauzy tím zůstává deterministické.
 */

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'animate'); // úklid po mocku WAAPI
});

/** Namockuje WAAPI s ručně řízeným `finished`; vrací resolver POSLEDNÍ animace. */
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

function gameDto(position: Position, result: GameDto['result'] = 'ongoing'): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle', level: 'professional', ballotMoves: null };
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

/** Pozice po tahu člověka 9→13 (na tahu je bílý = engine). */
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

/** Pozice po tahu enginu (bílý 22→18); na tahu zpět černý. */
function afterEngineReply(afterHuman: Position): Position {
  // Pojistka proti tichému chybnému předpokladu o rozestavění.
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

/** Odehraje tah člověka 9→13 (klikem) a počká, než controller převezme odpověď postMove. */
async function playHumanMove(root: HTMLElement): Promise<void> {
  click(squareEl(root, 9));
  click(squareEl(root, 13));
  await tick();
  await tick();
}

describe('rozmýšlecí pauza AI po tahu člověka', () => {
  it('tah enginu se zobrazí až po pauze (rychlá odpověď enginu)', async () => {
    const start = initialPosition();
    const afterHuman = afterOpening();
    const afterEngine = afterEngineReply(afterHuman);
    // Server po tahu člověka „hned" odpoví enginem (poll pak vrací tah enginu),
    // ale postMove nese stav po tahu ČLOVĚKA (na tahu bílý = engine přemýšlí).
    let poll = gameDto(start);
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () => Promise.resolve(poll),
      postMove: () => {
        poll = gameDto(afterEngine);
        return Promise.resolve(gameDto(afterHuman));
      },
      resign: () => Promise.resolve(gameDto(afterHuman, 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(afterHuman) }),
    };

    const turns: Color[] = [];
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: 5,
      aiMovePauseMs: 300,
      onState: (s) => turns.push(s.turn),
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    await playHumanMove(controller.element);
    expect(turns.at(-1)).toBe('white'); // po tvém tahu je na tahu engine

    await delay(80);
    // ZUBY: bez pauzy by tah enginu (black) naskočil hned; s pauzou engine „přemýšlí".
    expect(turns.at(-1)).toBe('white');

    await delay(400);
    expect(turns.at(-1)).toBe('black'); // po pauze se tah AI zobrazil
  });

  it('dlouho počítající engine nedostane pauzu navíc (podlaha, ne přičtení)', async () => {
    const start = initialPosition();
    const afterHuman = afterOpening();
    const afterEngine = afterEngineReply(afterHuman);
    // Engine „počítá" 350 ms: do té doby poll vrací stav po tahu člověka (bílý na
    // tahu = thinking), pak teprve tah enginu. Práh je 250 ms < 350 ms.
    let engineReadyAt = Number.POSITIVE_INFINITY;
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () =>
        Promise.resolve(performance.now() >= engineReadyAt ? gameDto(afterEngine) : gameDto(afterHuman)),
      postMove: () => {
        engineReadyAt = performance.now() + 350;
        return Promise.resolve(gameDto(afterHuman));
      },
      resign: () => Promise.resolve(gameDto(afterHuman, 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(afterHuman) }),
    };

    const turns: Color[] = [];
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: 5,
      aiMovePauseMs: 250,
      onState: (s) => turns.push(s.turn),
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    await playHumanMove(controller.element);
    expect(turns.at(-1)).toBe('white');

    await delay(250); // engine pořád počítá (hotový ~350 ms) → tah AI ještě není
    expect(turns.at(-1)).toBe('white');

    await delay(230); // ~480 ms od tahu: engine hotový ~350 ms, elapsed>práh → BEZ přičtení
    // ZUBY proti „přičti vždy": additivní chování (350+250≈600 ms) by tu mělo ještě 'white'.
    expect(turns.at(-1)).toBe('black');
  });

  it('tah enginu POČKÁ, až doběhne animace tahu člověka (await lastRender)', async () => {
    // Klíčová větev, kterou předchozí testy míjí: v jsdom bez WAAPI jde tah
    // „instant" (lastRender hned splněný). Tady WAAPI namockujeme, takže animace
    // tahu člověka reálně BĚŽÍ; tah enginu se nesmí zobrazit, dokud nedoběhne –
    // jinak by ho nová animace usekla a pauza by se neměřila od jeho konce.
    // Zuby i proti regresi „lastRender se nikdy nevyřeší" → trvalé busy/zamrznutí.
    const anim = mockControllableAnimation();
    const start = initialPosition();
    const afterHuman = afterOpening();
    const afterEngine = afterEngineReply(afterHuman);
    let poll = gameDto(start);
    const client: ServerClient = {
      createGame: () => Promise.resolve(gameDto(start)),
      getGame: () => Promise.resolve(poll),
      postMove: () => {
        poll = gameDto(afterEngine);
        return Promise.resolve(gameDto(afterHuman));
      },
      resign: () => Promise.resolve(gameDto(afterHuman, 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(afterHuman) }),
    };

    const turns: Color[] = [];
    const controller = createBoardController(client, gameDto(start), {
      pollIntervalMs: 5,
      aiMovePauseMs: 50, // malá pauza – tady testujeme čekání na animaci, ne délku
      onState: (s) => turns.push(s.turn),
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    await playHumanMove(controller.element);
    expect(turns.at(-1)).toBe('white'); // tah člověka běží (animace nevyřešená)

    // Poll dávno doručil tah enginu, ale animace tahu člověka pořád běží → tah AI
    // NESMÍ naskočit (čeká na `lastRender`). Bez `await lastRender` by tu bylo 'black'.
    await delay(120);
    expect(turns.at(-1)).toBe('white');

    anim.resolve(); // animace tahu člověka dokončena → teprve teď se měří pauza
    await delay(200); // + malá pauza (50 ms) → tah AI se zobrazí
    expect(turns.at(-1)).toBe('black');
  });
});

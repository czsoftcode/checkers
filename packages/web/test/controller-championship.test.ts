// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Color, Position } from '@checkers/rules';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import type { EngineStatus, GameDto, ServerClient } from '../src/server-client.js';

/**
 * Úroveň Mistrovství z pohledu controlleru: partie startuje s BÍLÝM (engine) na
 * tahu (server nasadil vylosované zahájení), takže POČÍTAČ TÁHNE PRVNÍ. Klient na
 * to nemá zvláštní větev – spoléhá, že polling běží od založení BEZPODMÍNEČNĚ
 * (nezávisle na tom, kdo je na tahu). Tenhle test ten předpoklad přibíjí: kdyby se
 * polling gateoval na „na tahu je člověk" (nebo se na startu nespustil), první tah
 * enginu z bílé pozice by se nikdy nenačetl a partie by tiše stála. (Detekce
 * `engineJustMoved` řídí jen rozmýšlecí pauzu AI, ne aplikaci stavu – tu hlídá
 * `controller-ai-pause.test`, ne tenhle test.)
 *
 * jsdom nemá WAAPI → render jde „instant", časování pauzy je deterministické.
 */

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** GameDto s volitelným stavem enginu; úroveň Mistrovství (championship). */
function championshipDto(
  position: Position,
  engineStatus: EngineStatus,
  result: GameDto['result'] = 'ongoing',
): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus, level: 'championship' };
}

/**
 * Popballotová počáteční pozice: černý odehrál 9→13 (jeden z půltahů zahájení),
 * na tahu je BÍLÝ = engine. Tvar stačí pro controller (jen render + poll), nemusí
 * to být reálný ballot – testujeme mechaniku klienta, ne los serveru.
 */
function whiteToMoveStart(): Position {
  const start = initialPosition();
  const board = start.board.slice();
  board[9 - 1] = null;
  board[13 - 1] = { color: 'black', kind: 'man' };
  return { board, turn: 'white' };
}

/** Pozice po tahu enginu (bílý 22→18); na tahu zpět černý (člověk). */
function afterEngineReply(whiteStart: Position): Position {
  // Pojistka proti tichému chybnému předpokladu o rozestavění.
  if (whiteStart.board[22 - 1]?.color !== 'white' || whiteStart.board[18 - 1] !== null) {
    throw new Error('Test čekal bílý kámen na 22 a prázdné 18 (rozestavění se změnilo).');
  }
  const board = whiteStart.board.slice();
  board[22 - 1] = null;
  board[18 - 1] = { color: 'white', kind: 'man' };
  return { board, turn: 'black' };
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

describe('Mistrovství: počítač táhne první', () => {
  it('první poll aplikuje tah enginu z počáteční bílé pozice (bez tahu člověka)', async () => {
    const start = whiteToMoveStart();
    const afterEngine = afterEngineReply(start);
    // Server nasadil ballot → partie začíná bílým na tahu, engine „přemýšlí".
    // Poll pak vrátí stav PO tahu enginu (na tahu zpět černý). Člověk netáhne.
    const client: ServerClient = {
      createGame: () => Promise.resolve(championshipDto(start, 'thinking')),
      getGame: () => Promise.resolve(championshipDto(afterEngine, 'idle')),
      postMove: () => Promise.reject(new Error('člověk nesmí táhnout, je na tahu engine')),
      resign: () => Promise.resolve(championshipDto(afterEngine, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: championshipDto(afterEngine, 'idle') }),
    };

    const turns: Color[] = [];
    const controller = createBoardController(client, championshipDto(start, 'thinking'), {
      pollIntervalMs: 5,
      aiMovePauseMs: 20,
      onState: (s) => turns.push(s.turn),
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    // Počáteční stav: na tahu bílý (počítač). Tenhle snímek přijde hned při vzniku.
    expect(turns[0]).toBe('white');

    // Bez jediného tahu člověka poll vezme tah enginu → přechod na černého.
    // ZUB: kdyby se polling na startu nespustil (nebo se gateoval na tah člověka),
    // `turns` by zůstalo na 'white' a tohle by vypršelo (chyba testu).
    await delay(80);
    expect(turns.at(-1)).toBe('black');
  });

  it('člověk nemůže táhnout, dokud je na tahu počítač (bílý) – postMove se nezavolá', async () => {
    const start = whiteToMoveStart();
    // Engine „pořád přemýšlí": poll vrací stále bílý na tahu, tah nikdy nedorazí.
    const postMove = vi.fn(() => Promise.resolve(championshipDto(start, 'thinking')));
    const client: ServerClient = {
      createGame: () => Promise.resolve(championshipDto(start, 'thinking')),
      getGame: () => Promise.resolve(championshipDto(start, 'thinking')),
      postMove,
      resign: () => Promise.resolve(championshipDto(start, 'thinking', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: championshipDto(start, 'thinking') }),
    };

    const controller = createBoardController(client, championshipDto(start, 'thinking'), {
      pollIntervalMs: 5,
      aiMovePauseMs: 20,
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    // Člověk (černý) zkusí táhnout svým kamenem, i když je na tahu bílý. Klik na
    // vlastní kámen (11) a cíl (15) nesmí vyústit v tah – autorita barvy drží
    // interakci jen na tahu člověka.
    click(squareEl(controller.element, 11));
    click(squareEl(controller.element, 15));
    await tick();
    await tick();

    // ZUB: kdyby controller pustil výběr/tah i mimo tah člověka, postMove by se
    // zavolalo a autorita barvy klienta by neplatila.
    expect(postMove).not.toHaveBeenCalled();
  });
});

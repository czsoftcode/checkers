// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppShell } from '../src/app-shell.js';
import { setLocale } from '../src/i18n.js';
import type { BoardController, BoardControllerOptions } from '../src/controller.js';
import type { GameDto, ServerClient } from '../src/server-client.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function gameDto(position: Position): GameDto {
  return {
    id: 'g1',
    position,
    result: 'ongoing',
    legalMoves: [],
    engineStatus: 'idle',
    level: 'professional',
    ballotMoves: null,
  };
}

/** Fake client: createGame vrací DTO s echnutou úrovní (server = autorita). */
function fakeClient(): ServerClient {
  const dto = gameDto(initialPosition());
  return {
    createGame: (level) => Promise.resolve({ ...dto, level }),
    getGame: () => Promise.resolve(dto),
    postMove: () => Promise.resolve(dto),
    resign: () => Promise.resolve({ ...dto, result: 'white-wins' }),
    offerDraw: () => Promise.resolve({ accepted: false, game: dto }),
  };
}

/** Fake controller: jen ohlásí výchozí stav (jako reálný). */
function fakeFactory(): (client: ServerClient, game: GameDto, opts: BoardControllerOptions) => BoardController {
  return (_client, game, opts) => {
    opts.onState?.({ result: game.result, turn: game.position.turn, engineStatus: game.engineStatus });
    return {
      element: document.createElement('div'),
      resign: vi.fn(),
      offerDraw: vi.fn().mockResolvedValue('declined'),
      dispose: vi.fn(),
    };
  };
}

async function mount(variant?: 'american' | 'pool' | 'russian' | 'czech') {
  const shell = createAppShell(fakeClient(), {
    createController: fakeFactory(),
    ...(variant === undefined ? {} : { variant }),
  });
  document.body.append(shell.element);
  await tick();
  const select = shell.element.querySelector<HTMLSelectElement>('.level-select');
  if (select === null) {
    throw new Error('level-select nenalezen');
  }
  return { shell, select, values: Array.from(select.options).map((o) => o.value) };
}

beforeEach(() => {
  setLocale('cs');
  localStorage.clear();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('createAppShell – filtr Mistrovství podle varianty', () => {
  it('americká (default) nabízí championship', async () => {
    const { values } = await mount('american');
    expect(values).toContain('championship');
    expect(values).toContain('professional');
  });

  it('ne-americká (ruská) championship VŮBEC nenabídne', async () => {
    const { values } = await mount('russian');
    expect(values).not.toContain('championship');
    // Ostatní úrovně zůstávají.
    expect(values).toContain('professional');
    expect(values).toContain('beginner');
  });

  it('uložená úroveň championship + ne-americká varianta spadne na professional', async () => {
    localStorage.setItem('checkers.level', 'championship');
    const { select } = await mount('pool');
    // Championship tu není mezi <option> → hodnota selectu zůstane na prvním
    // (professional), místo aby byla prázdná / neplatná pro createGame.
    expect(select.value).toBe('professional');
  });

  it('bez varianty (výchozí) se chová jako americká', async () => {
    const { values } = await mount();
    expect(values).toContain('championship');
  });

  it('vstup do ne-americké varianty NEPŘEPÍŠE uloženou preferenci Mistrovství', async () => {
    // Hráč měl v americké nastavené Mistrovství. Ne-americká partie (kde championship
    // není v nabídce a level spadne na professional) NESMÍ sdílený klíč přepsat –
    // jinak by se americká preference Mistrovství tiše ztratila.
    localStorage.setItem('checkers.level', 'championship');
    await mount('russian');
    expect(localStorage.getItem('checkers.level')).toBe('championship');
  });

  it('americká varianta uloženou úroveň dál čte i ukládá (beze změny chování)', async () => {
    localStorage.setItem('checkers.level', 'beginner');
    const { select } = await mount('american');
    // Americká cesta uloženou úroveň předvybere (beginner je platná option)…
    expect(select.value).toBe('beginner');
    // …a auto hra ji zase uloží (klíč zůstává beginner, ne přepsán na professional).
    expect(localStorage.getItem('checkers.level')).toBe('beginner');
  });
});

describe('createAppShell – název varianty nad deskou (fáze 107)', () => {
  it('vykreslí HOLÝ název zvolené varianty (ruská) s dovětkem dáma, bez prefixu „Varianta:"', async () => {
    const { shell } = await mount('russian');
    const line = shell.element.querySelector('.game-variant');
    expect(line?.textContent).toBe('Ruská dáma');
  });

  it('přeloží název varianty do aktivního jazyka (en)', async () => {
    setLocale('en');
    const { shell } = await mount('czech');
    const line = shell.element.querySelector('.game-variant');
    expect(line?.textContent).toBe('Czech checkers');
  });

  it('bez varianty spadne na americkou (dnešní chování)', async () => {
    const { shell } = await mount();
    const line = shell.element.querySelector('.game-variant');
    expect(line?.textContent).toBe('Americká dáma');
  });
});

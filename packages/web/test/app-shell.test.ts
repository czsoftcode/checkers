// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Position } from '@checkers/rules';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { createAppShell } from '../src/app-shell.js';
import type { BoardController, BoardControllerOptions, GameStatus } from '../src/controller.js';
import type { GameDto, ServerClient } from '../src/server-client.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function gameDto(position: Position, result: GameDto['result'] = 'ongoing'): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle' };
}

/** Fake controller: neřídí desku, jen zaznamenává dispose/resign a umí emitovat stav. */
interface FakeCtl {
  readonly element: HTMLElement;
  readonly resign: Mock<() => void>;
  readonly dispose: Mock<() => void>;
  emit(status: GameStatus): void;
}

/**
 * Tovární funkce controllerů pro skořápku: každý vytvořený fake si pamatuje a
 * hned (jako reálný controller) ohlásí výchozí stav z `game`. Test tak vidí, co
 * skořápka udělala s dispose/resign a jak reaguje na onState.
 */
function fakeFactory(): {
  factory: (client: ServerClient, game: GameDto, opts: BoardControllerOptions) => BoardController;
  created: FakeCtl[];
} {
  const created: FakeCtl[] = [];
  const factory = (
    _client: ServerClient,
    game: GameDto,
    opts: BoardControllerOptions,
  ): BoardController => {
    const element = document.createElement('div');
    element.className = 'fake-board';
    const ctl: FakeCtl = {
      element,
      resign: vi.fn<() => void>(),
      dispose: vi.fn<() => void>(),
      emit: (status: GameStatus) => opts.onState?.(status),
    };
    created.push(ctl);
    // Reálný controller po vzniku ohlásí výchozí stav – zopakuj to.
    opts.onState?.({
      result: game.result,
      turn: game.position.turn,
      engineStatus: game.engineStatus,
    });
    return ctl;
  };
  return { factory, created };
}

function fakeClient(dto: GameDto): ServerClient {
  return {
    createGame: () => Promise.resolve(dto),
    getGame: () => Promise.resolve(dto),
    postMove: () => Promise.resolve(dto),
    resign: () => Promise.resolve({ ...dto, result: 'white-wins' }),
  };
}

function q(root: HTMLElement, sel: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) {
    throw new Error(`prvek ${sel} nenalezen`);
  }
  return el;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const OVER: GameStatus = { result: 'white-wins', turn: 'white', engineStatus: 'idle' };

describe('app-shell – stav tlačítek podle výsledku', () => {
  it('za běhu je aktivní jen Vzdávám hru, po konci jen Nová hra', async () => {
    const { factory, created } = fakeFactory();
    const shell = createAppShell(fakeClient(gameDto(initialPosition())), {
      createController: factory,
    });
    document.body.append(shell.element);
    await tick(); // createGame doběhne, controller ohlásí výchozí ongoing stav

    const resignBtn = q(shell.element, '.btn-resign') as HTMLButtonElement;
    const newBtn = q(shell.element, '.btn-newgame') as HTMLButtonElement;
    expect(resignBtn.disabled).toBe(false);
    expect(newBtn.disabled).toBe(true);

    // Partie skončí (např. vzdáním / enginem) → tlačítka se prohodí.
    created[0]?.emit(OVER);
    expect(resignBtn.disabled).toBe(true);
    expect(newBtn.disabled).toBe(false);
    expect(q(shell.element, '.status').textContent).toBe('Konec: vyhrál počítač.');
  });
});

describe('app-shell – inline potvrzení vzdání', () => {
  it('„Vzdávám hru" ukáže potvrzení; „Ano" vzdá, „Zrušit" ne', async () => {
    const { factory, created } = fakeFactory();
    const shell = createAppShell(fakeClient(gameDto(initialPosition())), {
      createController: factory,
    });
    document.body.append(shell.element);
    await tick();

    const controls = q(shell.element, '.controls');
    const confirm = q(shell.element, '.confirm');
    expect(confirm.classList.contains('hidden')).toBe(true);

    // Klik na vzdání → potvrzení se ukáže, hlavní tlačítka se schovají.
    click(q(shell.element, '.btn-resign'));
    expect(confirm.classList.contains('hidden')).toBe(false);
    expect(controls.classList.contains('hidden')).toBe(true);

    // „Zrušit" → potvrzení pryč, controller.resign se NEvolal.
    click(q(shell.element, '.btn-confirm-no'));
    expect(confirm.classList.contains('hidden')).toBe(true);
    expect(controls.classList.contains('hidden')).toBe(false);
    expect(created[0]?.resign).not.toHaveBeenCalled();

    // Znovu vzdání → „Ano" → controller.resign se zavolá právě jednou.
    click(q(shell.element, '.btn-resign'));
    click(q(shell.element, '.btn-confirm-yes'));
    expect(created[0]?.resign).toHaveBeenCalledTimes(1);
    expect(confirm.classList.contains('hidden')).toBe(true);
  });
});

describe('app-shell – Nová hra uklidí starý controller (polling)', () => {
  it('dispose starého controlleru a vytvoření nového', async () => {
    const { factory, created } = fakeFactory();
    const shell = createAppShell(fakeClient(gameDto(initialPosition())), {
      createController: factory,
    });
    document.body.append(shell.element);
    await tick();
    expect(created).toHaveLength(1);

    // Partie skončí → Nová hra se povolí.
    created[0]?.emit(OVER);
    const newBtn = q(shell.element, '.btn-newgame') as HTMLButtonElement;
    expect(newBtn.disabled).toBe(false);

    click(newBtn);
    await tick(); // createGame nové partie doběhne

    // Starý controller byl uklizen (dispose = zastavení pollingu) a vznikl nový.
    expect(created[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
    expect(created[1]?.dispose).not.toHaveBeenCalled();
    // V DOM je jen nová deska.
    expect(shell.element.querySelectorAll('.fake-board')).toHaveLength(1);
    expect(shell.element.contains(created[1]?.element ?? null)).toBe(true);
  });
});

describe('app-shell – selhání při zakládání partie', () => {
  it('createGame selže → hláška, Nová hra aktivní, Vzdávám hru zamčené', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client: ServerClient = {
      createGame: () => Promise.reject(new Error('síť dole')),
      getGame: () => Promise.resolve(gameDto(initialPosition())),
      postMove: () => Promise.resolve(gameDto(initialPosition())),
      resign: () => Promise.resolve(gameDto(initialPosition(), 'white-wins')),
    };
    const shell = createAppShell(client);
    document.body.append(shell.element);
    await tick();

    const resignBtn = q(shell.element, '.btn-resign') as HTMLButtonElement;
    const newBtn = q(shell.element, '.btn-newgame') as HTMLButtonElement;
    expect(q(shell.element, '.status').textContent).toContain('nepodařilo');
    expect(resignBtn.disabled).toBe(true);
    expect(newBtn.disabled).toBe(false);
  });
});

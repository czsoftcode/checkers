// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { createAppShell } from '../src/app-shell.js';
import type { BoardController, BoardControllerOptions, GameStatus } from '../src/controller.js';
import { initLocale, setLocale } from '../src/i18n.js';
import type { GameDto, GameLevel, ServerClient } from '../src/server-client.js';

/**
 * i18n obrazovky hry proti počítači (fáze 83). Dvě rizika:
 *  1. KONTRAKT ÚROVNÍ – lokalizuje se jen POPISEK (`<option>` text), ale ODESLANÁ
 *     hodnota (`<option value>` → `createGame`) musí zůstat anglická (`professional`
 *     …). Kdyby migrace přeložila i hodnotu, server by úroveň odmítl 400.
 *  2. VÝSLEDEK z pohledu člověka – párování `humanWon` (vyhráli jste / vyhrál
 *     počítač) přes `terminalMessage`. Kdyby se prohodilo nebo chyběl en klíč,
 *     hráč by v en verzi viděl opačný výsledek.
 *
 * Testy jedou nad REÁLNÝM `createAppShell` a reálnými slovníky (žádný mock `t()`).
 */

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function gameDto(position: Position, result: GameDto['result'] = 'ongoing'): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle', level: 'professional', ballotMoves: null };
}

/** Fake controller: neřídí desku, jen si drží emit výchozího/dalšího stavu. */
interface FakeCtl {
  readonly element: HTMLElement;
  emit(status: GameStatus): void;
}

function fakeFactory(): {
  factory: (client: ServerClient, game: GameDto, opts: BoardControllerOptions) => BoardController;
  created: FakeCtl[];
} {
  const created: FakeCtl[] = [];
  const factory = (_client: ServerClient, game: GameDto, opts: BoardControllerOptions): BoardController => {
    const element = document.createElement('div');
    element.className = 'fake-board';
    const ctl: BoardController & FakeCtl = {
      element,
      resign: vi.fn(),
      offerDraw: vi.fn<() => Promise<'declined'>>().mockResolvedValue('declined'),
      dispose: vi.fn(),
      emit: (status: GameStatus) => opts.onState?.(status),
    };
    created.push(ctl);
    // Reálný controller po vzniku ohlásí výchozí stav – zopakuj to.
    opts.onState?.({ result: game.result, turn: game.position.turn, engineStatus: game.engineStatus });
    return ctl;
  };
  return { factory, created };
}

/** Fake createGame, které v odpovědi VRÁTÍ zvolenou úroveň i barvu (server = autorita). */
function levelEchoClient(): {
  client: ServerClient;
  createGame: Mock<(level: GameLevel, humanColor: 'black' | 'white') => Promise<GameDto>>;
} {
  const createGame = vi.fn<(level: GameLevel, humanColor: 'black' | 'white') => Promise<GameDto>>(
    (level, humanColor) => Promise.resolve({ ...gameDto(initialPosition()), level, humanColor }),
  );
  const client: ServerClient = {
    createGame,
    getGame: () => Promise.resolve(gameDto(initialPosition())),
    postMove: () => Promise.resolve(gameDto(initialPosition())),
    resign: () => Promise.resolve({ ...gameDto(initialPosition()), result: 'white-wins' }),
    offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(initialPosition()) }),
    getHint: () => Promise.resolve(null),
  } as unknown as ServerClient;
  return { client, createGame };
}

function q(root: HTMLElement, sel: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) {
    throw new Error(`prvek ${sel} nenalezen`);
  }
  return el;
}

const shells: { dispose(): void }[] = [];

async function mount(
  locale: 'cs' | 'en',
  client: ServerClient,
): Promise<{ element: HTMLElement; created: FakeCtl[] }> {
  setLocale(locale);
  const { factory, created } = fakeFactory();
  const shell = createAppShell(client, { createController: factory, createStoneImage: null });
  shells.push(shell);
  document.body.append(shell.element);
  await tick(); // automatická první hra doběhne, controller ohlásí výchozí stav
  return { element: shell.element, created };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const s of shells) {
    s.dispose();
  }
  shells.length = 0;
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  initLocale();
});

describe('app-shell i18n – kontrakt úrovní (hodnota EN, popisek lokalizovaný)', () => {
  it('en: <option> má anglický popisek, ale ODESLANÁ hodnota zůstává anglický klíč', async () => {
    const { client, createGame } = levelEchoClient();
    const { element } = await mount('en', client);

    const select = q(element, '.level-select') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));
    const byValue = (v: string): HTMLOptionElement => {
      const o = options.find((opt) => opt.value === v);
      if (o === undefined) {
        throw new Error(`option value=${v} chybí`);
      }
      return o;
    };
    // Hodnota = anglický interní klíč; popisek = anglický překlad.
    expect(byValue('professional').textContent).toBe('Professional');
    expect(byValue('championship').textContent).toBe('Championship');
    expect(byValue('education').textContent).toBe('Tutorial');
    // Žádná option nesmí mít jako VALUE lokalizovaný label.
    for (const opt of options) {
      expect(opt.value).not.toBe(opt.textContent);
    }

    // Vyber jinou úroveň před prvním tahem → přehraje partii; createGame musí dostat
    // ANGLICKOU hodnotu 'championship', ne 'Championship'.
    select.value = 'championship';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    const lastCall = createGame.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('championship');
  });

  it('cs: popisek je český, hodnota stejná anglická', async () => {
    const { client } = levelEchoClient();
    const { element } = await mount('cs', client);
    const select = q(element, '.level-select') as HTMLSelectElement;
    const champ = Array.from(select.querySelectorAll('option')).find((o) => o.value === 'championship');
    expect(champ?.value).toBe('championship'); // hodnota beze změny
    expect(champ?.textContent).toBe('Mistrovství'); // popisek přeložený
  });
});

describe('app-shell i18n – výsledek z pohledu člověka', () => {
  interface ResultCase {
    readonly name: string;
    readonly humanColor: 'black' | 'white';
    readonly status: GameStatus;
    readonly cs: string;
    readonly en: string;
  }
  const RESULT_CASES: readonly ResultCase[] = [
    { name: 'člověk (černý) vyhrál', humanColor: 'black', status: { result: 'black-wins', turn: 'black', engineStatus: 'idle' }, cs: 'Vyhráli jste.', en: 'You won.' },
    { name: 'počítač porazil černého', humanColor: 'black', status: { result: 'white-wins', turn: 'white', engineStatus: 'idle' }, cs: 'Vyhrál počítač.', en: 'The computer won.' },
    { name: 'člověk (bílý) vyhrál', humanColor: 'white', status: { result: 'white-wins', turn: 'white', engineStatus: 'idle' }, cs: 'Vyhráli jste.', en: 'You won.' },
    { name: 'počítač porazil bílého', humanColor: 'white', status: { result: 'black-wins', turn: 'black', engineStatus: 'idle' }, cs: 'Vyhrál počítač.', en: 'The computer won.' },
    { name: 'remíza', humanColor: 'black', status: { result: 'draw', turn: 'black', engineStatus: 'idle' }, cs: 'Remíza.', en: 'Draw.' },
    { name: 'chyba enginu', humanColor: 'black', status: { result: 'ongoing', turn: 'black', engineStatus: 'error' }, cs: 'Počítač hlásí chybu, partie stojí.', en: 'The computer reports an error, the game is halted.' },
  ];

  for (const c of RESULT_CASES) {
    for (const locale of ['cs', 'en'] as const) {
      it(`${locale}: ${c.name}`, async () => {
        const { client, createGame } = levelEchoClient();
        // Server je autorita nad barvou člověka – vrať ji v DTO, ať terminalMessage
        // mapuje výsledek na správnou stranu.
        createGame.mockImplementation((level, humanColor) =>
          Promise.resolve({ ...gameDto(initialPosition()), level, humanColor }),
        );
        // Výchozí barva partie je 'black'; pro perspektivu bílého ji vynutíme přes select? Ne –
        // app-shell posílá nextColor (default black). Pro white testy si vynutíme přes localStorage.
        if (c.humanColor === 'white') {
          localStorage.setItem('checkers.nextColor', 'white');
        }
        const { element, created } = await mount(locale, client);
        created[0]?.emit(c.status);
        const modal = q(element, '.modal-overlay');
        expect(q(modal, '.modal-msg').textContent).toBe(locale === 'cs' ? c.cs : c.en);
      });
    }
  }

  it('výhra ≠ prohra: párování se nesmí zaměnit (en)', async () => {
    const { client } = levelEchoClient();
    const { element, created } = await mount('en', client);
    created[0]?.emit({ result: 'black-wins', turn: 'black', engineStatus: 'idle' }); // člověk černý → výhra
    const win = q(q(element, '.modal-overlay'), '.modal-msg').textContent;
    expect(win).toBe('You won.');
    expect(win).not.toBe('The computer won.');
  });
});

describe('app-shell i18n – statické ovládání anglicky', () => {
  it('tlačítka, potvrzení vzdání a modal jsou anglicky', async () => {
    const { client } = levelEchoClient();
    const { element } = await mount('en', client);
    expect(q(element, '.btn-offer-draw').textContent).toBe('Draw');
    expect(q(element, '.btn-resign').textContent).toBe('Resign');
    expect(q(element, '.btn-newgame').textContent).toBe('New game');
    expect(q(element, '.btn-modal-close').textContent).toBe('Close');
    expect(q(element, '.level-select').getAttribute('aria-label')).toBe('Opponent level for a new game');
    // Potvrzení vzdání (skryté, ale text je nastavený při stavbě).
    expect(q(element, '.btn-confirm-yes').textContent).toBe('Yes');
    expect(q(element, '.btn-confirm-no').textContent).toBe('Cancel');
    expect(q(element, '.confirm span').textContent).toBe('Really resign?');
  });
});

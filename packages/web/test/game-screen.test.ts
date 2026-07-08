// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { GameResult } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameScreen } from '../src/game-screen.js';
import type { GameWebSocket } from '../src/game-socket.js';
import type { GameLink } from '../src/lobby.js';
import type { ChallengeAcceptedInfo } from '../src/room-client.js';
import type { PvpGameDto } from '../src/server-client.js';

/** Ovladatelný fake WS partie (bez `send` – čtecí kanál). Test spouští push/close. */
class FakeSocket implements GameWebSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  close(): void {
    this.readyState = 3;
  }
  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  fireClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

/** Validní PvP stav: výchozí pozice s daným hráčem na tahu a výsledkem. */
function pvpGame(turn: 'black' | 'white' = 'black', result: GameResult = 'ongoing'): PvpGameDto {
  return { mode: 'pvp', id: 'g1', position: { ...initialPosition(), turn }, result, legalMoves: [] };
}

/**
 * Fake `Image`: po nastavení `src` asynchronně (microtask) vyvolá `onload`, nebo
 * `onerror` když je URL ve `failUrls`. Deterministické ověření přepnutí na webp bez
 * reálného načítání (v jsdom by se událost nevyvolala a fallback by držel).
 */
function fakeImageFactory(failUrls: ReadonlySet<string> = new Set()): () => HTMLImageElement {
  return () => {
    const img = {
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      set src(value: string) {
        void Promise.resolve().then(() => {
          if (failUrls.has(value)) {
            this.onerror?.();
          } else {
            this.onload?.();
          }
        });
      },
    };
    return img as unknown as HTMLImageElement;
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const info: ChallengeAcceptedInfo = { gameId: 'g1', color: 'black', opponentNick: 'Karel' };

interface Mounted {
  readonly element: HTMLElement;
  readonly socket: FakeSocket;
  readonly dispose: () => void;
  readonly backCalls: () => number;
  emitError(message: string): void;
}

/** Postaví herní obrazovku s fake socketem/linkem a vrátí ovládací háčky pro test. */
function mount(overrides: { color?: 'black' | 'white'; createStoneImage?: () => HTMLImageElement } = {}): Mounted {
  let socket: FakeSocket | undefined;
  let backCount = 0;
  let errorHandler: ((message: string) => void) | null = null;
  const link: GameLink = {
    move: () => true,
    onError: (handler) => {
      errorHandler = handler;
      return () => {
        errorHandler = null;
      };
    },
  };
  const screen = createGameScreen(
    { ...info, ...(overrides.color === undefined ? {} : { color: overrides.color }) },
    {
      onBackToRoom: () => {
        backCount += 1;
      },
      link,
      gameSocketUrl: 'ws://test/games/g1/ws',
      gameSocketFactory: (url) => {
        socket = new FakeSocket(url);
        return socket;
      },
      ...(overrides.createStoneImage === undefined ? {} : { createStoneImage: overrides.createStoneImage }),
    },
  );
  document.body.append(screen.element);
  return {
    element: screen.element,
    socket: socket!,
    dispose: () => {
      screen.dispose();
    },
    backCalls: () => backCount,
    emitError: (message) => errorHandler?.(message),
  };
}

beforeEach(() => {
  // Úvodní REST snapshot v game-socket volá fetch – utni ho na „nic" (ne-ok), ať
  // v jsdom neběží reálná síť ani nespadne do console.error.
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: false } as Response));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createGameScreen – rozvržení', () => {
  it('má panel s popiskem Soupeř: a TUČNOU přezdívkou a tlačítko Zpět, bez nadpisu/řádku barvy', () => {
    const m = mount();
    const nick = m.element.querySelector('.pvp-opponent');
    expect(nick?.textContent).toBe('Karel');
    // Popisek „Soupeř:" před přezdívkou, ať je jasné, že jméno patří soupeři.
    expect(m.element.querySelector('.pvp-opponent-label')?.textContent).toBe('Soupeř:');
    // Přezdívka je v panelu s ovládáním (sdílené třídy s AI).
    expect(m.element.querySelector('.panel .pvp-controls .pvp-opponent')).not.toBeNull();
    expect(m.element.querySelector('.btn-back-room')?.textContent).toBe('Zpět do místnosti');
    // Zrušené prvky: žádný nadpis „Partie" ani řádek „Hraješ za …".
    expect(m.element.querySelector('h1')).toBeNull();
    expect(m.element.textContent).not.toContain('Hraješ za');
    // Rozvržení sdílené s AI: root .game, deska v .board-row, pozadí .page-bg.
    expect(m.element.classList.contains('game')).toBe(true);
    expect(m.element.querySelector('.board-row')).not.toBeNull();
    expect(m.element.querySelector('.page-bg')).not.toBeNull();
  });

  it('tlačítko Zpět zavolá onBackToRoom', () => {
    const m = mount();
    m.element.querySelector<HTMLButtonElement>('.btn-back-room')!.click();
    expect(m.backCalls()).toBe(1);
  });
});

describe('createGameScreen – indikátor na tahu', () => {
  it('je skrytý před prvním stavem', () => {
    const m = mount();
    expect(m.element.querySelector('.pvp-turn')!.classList.contains('hidden')).toBe(true);
  });

  it('za běhu ukazuje kámen strany na tahu a nastaví aria-label', () => {
    const m = mount({ color: 'black' });
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    const indicator = m.element.querySelector('.pvp-turn')!;
    const stone = m.element.querySelector('.pvp-turn-stone')!;
    expect(indicator.classList.contains('hidden')).toBe(false);
    expect(stone.classList.contains('black')).toBe(true);
    expect(stone.classList.contains('white')).toBe(false);
    expect(indicator.getAttribute('aria-label')).toBe('Na tahu: ty'); // černý = já

    // Změna tahu: mění se JEN třída kamene, obal (element) je pořád tentýž.
    m.socket.message({ type: 'game-state', game: pvpGame('white') });
    expect(m.element.querySelector('.pvp-turn')).toBe(indicator); // stejný uzel
    expect(stone.classList.contains('white')).toBe(true);
    expect(stone.classList.contains('black')).toBe(false);
    expect(indicator.getAttribute('aria-label')).toBe('Na tahu: soupeř'); // bílý = soupeř
  });

  it('po konci partie se skryje a řádek ukáže výsledek', () => {
    const m = mount({ color: 'black' });
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'black-wins') });
    expect(m.element.querySelector('.pvp-turn')!.classList.contains('hidden')).toBe(true);
    const status = m.element.querySelector('.status')!;
    expect(status.classList.contains('hidden')).toBe(false);
    expect(status.textContent).toBe('Vyhrál jsi!'); // černý vyhrál, hraju černé
  });
});

describe('createGameScreen – kámen webp / fallback', () => {
  it('při ověřeném načtení obou kamenů zapne webp (.pvp-turn--img)', async () => {
    const m = mount({ createStoneImage: fakeImageFactory() });
    await flush();
    expect(m.element.querySelector('.pvp-turn')!.classList.contains('pvp-turn--img')).toBe(true);
  });

  it('když se kámen nenačte, zůstane CSS fallback (žádné .pvp-turn--img)', async () => {
    // Selže bílý kámen → fallback drží (buď oba webp, nebo žádný).
    const m = mount({
      createStoneImage: (): HTMLImageElement => {
        // Vytvoř fake, který u JAKÉKOLI src vyvolá onerror (nechceme znát přesnou URL).
        const img = {
          onload: null as (() => void) | null,
          onerror: null as (() => void) | null,
          set src(_value: string) {
            void Promise.resolve().then(() => this.onerror?.());
          },
        };
        return img as unknown as HTMLImageElement;
      },
    });
    await flush();
    expect(m.element.querySelector('.pvp-turn')!.classList.contains('pvp-turn--img')).toBe(false);
  });
});

describe('createGameScreen – chyba tahu a spojení', () => {
  it('chyba tahu z room WS se ukáže ve stavovém pruhu', () => {
    const m = mount();
    m.emitError('Neplatný tah.');
    const err = m.element.querySelector('.pvp-error')!;
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toBe('Neplatný tah.');
  });

  it('ztráta spojení zamkne desku, ukáže trvalou hlášku a schová indikátor na tahu', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') }); // ať partie běží
    expect(m.element.querySelector('.pvp-turn')!.classList.contains('hidden')).toBe(false);
    m.socket.fireClose();
    const status = m.element.querySelector('.status')!;
    expect(status.classList.contains('hidden')).toBe(false);
    expect(status.textContent).toContain('Spojení');
    expect(m.element.querySelector('.pvp-turn')!.classList.contains('hidden')).toBe(true);
  });

  it('po ztrátě spojení opožděná chyba tahu NEpřepíše hlášku o spojení', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.socket.fireClose(); // spojení ztraceno → deska zamčená, hláška svítí
    m.emitError('Neplatný tah.'); // opožděné odmítnutí z (živého) room WS
    const status = m.element.querySelector('.status')!;
    expect(status.textContent).toContain('Spojení'); // hláška o spojení zůstala
    // Zastaralá chyba tahu se vůbec neukázala (deska je nevratně zamčená).
    expect(m.element.querySelector('.pvp-error')!.classList.contains('hidden')).toBe(true);
  });
});

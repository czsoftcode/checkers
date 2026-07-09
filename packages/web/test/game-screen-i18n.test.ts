// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Color, GameResult } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameScreen, outcomeText } from '../src/game-screen.js';
import type { GameWebSocket } from '../src/game-socket.js';
import { initLocale, setLocale } from '../src/i18n.js';
import type { Locale } from '../src/i18n.js';
import type { GameLink } from '../src/lobby.js';
import type { ChallengeAcceptedInfo } from '../src/room-client.js';
import type { EndReason, PvpGameDto } from '../src/server-client.js';

/**
 * i18n herní obrazovky (fáze 82): jádrem je `outcomeText` – párování výsledku (kdo
 * vyhrál z mého pohledu) × důvodu konce × jazyka. To je nejrizikovější místo: kdyby
 * se párování `iWin × reason` rozjelo nebo chyběl anglický klíč, hráč by v en verzi
 * viděl „vzdal ses" místo „soupeř se vzdal" (nebo naopak).
 *
 * Testy jedou nad REÁLNOU exportovanou funkcí a reálnými slovníky (ne mock `t()`):
 * když někdo přehodí větev nebo smaže klíč, konkrétní český/anglický assert spadne.
 */

/** Očekávaný text pro jeden vstup, v obou jazycích – tak se pozná záměna klíče i strany. */
interface Case {
  readonly name: string;
  readonly result: Exclude<GameResult, 'ongoing'>;
  readonly myColor: Color;
  readonly reason: EndReason | null;
  readonly cs: string;
  readonly en: string;
}

const CASES: readonly Case[] = [
  // Remíza: reason rozhoduje o textu, barva ne.
  { name: 'remíza dohodou', result: 'draw', myColor: 'black', reason: 'draw-agreement', cs: 'Remíza dohodou.', en: 'Draw by agreement.' },
  { name: 'remíza dle pravidel', result: 'draw', myColor: 'white', reason: 'rules', cs: 'Remíza podle pravidel.', en: 'Draw by the rules.' },
  { name: 'remíza bez důvodu', result: 'draw', myColor: 'black', reason: null, cs: 'Remíza.', en: 'Draw.' },
  // Nekonzistentní stav (draw + resign) spadne na neutrální „Remíza." – reason u draw se bere jen pro agreement/rules.
  { name: 'remíza + resign = neutrální', result: 'draw', myColor: 'white', reason: 'resign', cs: 'Remíza.', en: 'Draw.' },

  // Vzdání: výhra vs. prohra se NESMÍ zaměnit (jádro rizika).
  { name: 'černý vyhrál vzdáním, hraju černé → výhra', result: 'black-wins', myColor: 'black', reason: 'resign', cs: 'Soupeř se vzdal – vyhrál jsi!', en: 'Your opponent resigned – you win!' },
  { name: 'černý vyhrál vzdáním, hraju bílé → prohra', result: 'black-wins', myColor: 'white', reason: 'resign', cs: 'Vzdal ses – prohrál jsi.', en: 'You resigned – you lost.' },
  { name: 'bílý vyhrál vzdáním, hraju bílé → výhra', result: 'white-wins', myColor: 'white', reason: 'resign', cs: 'Soupeř se vzdal – vyhrál jsi!', en: 'Your opponent resigned – you win!' },
  { name: 'bílý vyhrál vzdáním, hraju černé → prohra', result: 'white-wins', myColor: 'black', reason: 'resign', cs: 'Vzdal ses – prohrál jsi.', en: 'You resigned – you lost.' },

  // Normální konec (bez důvodu / mimo resign): jen výhra/prohra podle barvy.
  { name: 'černý vyhrál, hraju černé → výhra', result: 'black-wins', myColor: 'black', reason: null, cs: 'Vyhrál jsi!', en: 'You win!' },
  { name: 'černý vyhrál, hraju bílé → prohra', result: 'black-wins', myColor: 'white', reason: null, cs: 'Prohrál jsi.', en: 'You lost.' },
  { name: 'bílý vyhrál, hraju bílé → výhra', result: 'white-wins', myColor: 'white', reason: null, cs: 'Vyhrál jsi!', en: 'You win!' },
  { name: 'bílý vyhrál, hraju černé → prohra', result: 'white-wins', myColor: 'black', reason: null, cs: 'Prohrál jsi.', en: 'You lost.' },
];

afterEach(() => {
  // Vrať aktivní jazyk podle prohlížeče (mezi soubory izoluje vitest; uvnitř si každý
  // test stejně nastaví jazyk sám před voláním).
  initLocale();
});

describe('outcomeText – výsledek × důvod × jazyk', () => {
  for (const c of CASES) {
    it(`cs: ${c.name}`, () => {
      setLocale('cs');
      expect(outcomeText(c.result, c.myColor, c.reason)).toBe(c.cs);
    });
    it(`en: ${c.name}`, () => {
      setLocale('en');
      expect(outcomeText(c.result, c.myColor, c.reason)).toBe(c.en);
    });
  }

  it('vzdání nezamění stranu: výhra ≠ prohra (cs i en)', () => {
    for (const locale of ['cs', 'en'] as const) {
      setLocale(locale);
      const win = outcomeText('black-wins', 'black', 'resign');
      const loss = outcomeText('black-wins', 'white', 'resign');
      expect(win).not.toBe(loss);
    }
  });

  it('jazyk se opravdu přepíná: cs ≠ en pro tentýž vstup', () => {
    setLocale('cs');
    const cs = outcomeText('black-wins', 'black', 'resign');
    setLocale('en');
    const en = outcomeText('black-wins', 'black', 'resign');
    expect(cs).not.toBe(en);
  });

  it('žádný výstup není prázdný ani nedosazený placeholder', () => {
    for (const locale of ['cs', 'en'] as const) {
      setLocale(locale);
      for (const c of CASES) {
        const text = outcomeText(c.result, c.myColor, c.reason);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/\{\w+\}/); // žádné {placeholder} neproklouzlo
      }
    }
  });
});

/* ---- DOM smoke: obrazovka reálně sahá do slovníku (ne jen čistá funkce) ---- */

/** Fake WS partie: test ručně pushne stav / zavře. */
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
}

/** GameLink, který nic neposílá (smoke jen kreslí texty). `on*` vrací no-op odregistraci. */
function inertLink(): GameLink {
  // Registrátor: přijme handler, ignoruje ho a vrátí prázdnou odregistraci (kterou
  // volá dispose). POZOR: musí VRÁTIT funkci, ne jí být – jinak dispose spadne.
  const sub = (): (() => void) => () => undefined;
  return {
    move: () => true,
    onError: sub,
    resign: () => true,
    offerDraw: () => true,
    acceptDraw: () => true,
    rejectDraw: () => true,
    leaveGame: () => true,
    offerRematch: () => true,
    acceptRematch: () => true,
    declineRematch: () => true,
    onDrawOffered: sub,
    onDrawRejected: sub,
    onRematchOffered: sub,
    onRematchDeclined: sub,
    onGameClosed: sub,
  };
}

const info: ChallengeAcceptedInfo = {
  gameId: 'g1',
  color: 'black',
  opponentId: 'op-1',
  opponentNick: 'Karel',
};

function pvpGame(result: GameResult, reason: EndReason | null): PvpGameDto {
  return { mode: 'pvp', id: 'g1', position: { ...initialPosition(), turn: 'black' }, result, legalMoves: [], reason };
}

const screens: { dispose(): void }[] = [];

function mount(locale: Locale): { element: HTMLElement; socket: FakeSocket } {
  setLocale(locale);
  let socket: FakeSocket | undefined;
  const screen = createGameScreen(info, {
    onBackToRoom: () => undefined,
    link: inertLink(),
    gameSocketUrl: 'ws://test/games/g1/ws',
    gameSocketFactory: (url) => {
      socket = new FakeSocket(url);
      return socket;
    },
    createStoneImage: null, // bez preloadu → žádný async, indikátor na CSS fallbacku
  });
  screens.push(screen);
  if (socket === undefined) {
    throw new Error('socket se nevytvořil');
  }
  return { element: screen.element, socket };
}

beforeEach(() => {
  // Úvodní REST snapshot v game-socket volá fetch – utni ho, ať v jsdom neběží síť.
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: false } as Response));
});

afterEach(() => {
  for (const s of screens) {
    s.dispose();
  }
  screens.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('createGameScreen – anglická obrazovka', () => {
  it('statické popisky a tlačítka jsou anglicky', () => {
    const { element } = mount('en');
    expect(element.querySelector('.pvp-opponent-label')?.textContent).toBe('Opponent:');
    expect(element.querySelector('.btn-offer-draw')?.textContent).toBe('Offer a draw');
    expect(element.querySelector('.btn-resign')?.textContent).toBe('Resign');
    expect(element.querySelector('.status')?.textContent).toBe('Connecting to the game…');
  });

  it('výsledkový modal po konci partie je anglicky', () => {
    const { element, socket } = mount('en');
    // Hraju černé (info.color); černý vyhrál vzdáním → „you win".
    socket.message({ type: 'game-state', game: pvpGame('black-wins', 'resign') });
    expect(element.querySelector('.modal-msg')?.textContent).toBe('Your opponent resigned – you win!');
    expect(element.querySelector('.modal-actions button:first-child')?.textContent).toBe('Rematch');
    expect(element.querySelector('.modal-actions button:last-child')?.textContent).toBe('End');
  });
});

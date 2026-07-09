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

/** Validní PvP stav: výchozí pozice s daným hráčem na tahu, výsledkem a důvodem konce. */
function pvpGame(
  turn: 'black' | 'white' = 'black',
  result: GameResult = 'ongoing',
  reason: PvpGameDto['reason'] = null,
): PvpGameDto {
  return { mode: 'pvp', id: 'g1', position: { ...initialPosition(), turn }, result, legalMoves: [], reason };
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

const info: ChallengeAcceptedInfo = {
  gameId: 'g1',
  color: 'black',
  opponentId: 'op-1',
  opponentNick: 'Karel',
};

interface Mounted {
  readonly element: HTMLElement;
  readonly socket: FakeSocket;
  readonly dispose: () => void;
  readonly backCalls: () => number;
  emitError(message: string): void;
  /** Příkazy odeslané přes GameLink v pořadí (resign/offerDraw/acceptDraw/rejectDraw). */
  commands(): string[];
  /** Simuluje příchozí signál „soupeř nabídl remízu" (jako z room WS přes lobby). */
  emitDrawOffered(): void;
  /** Simuluje příchozí signál „soupeř odmítl mou nabídku". */
  emitDrawRejected(): void;
  /** Simuluje příchozí signál „soupeř nabídl odvetu". */
  emitRematchOffered(): void;
  /** Simuluje příchozí signál „soupeř odvetu odmítl". */
  emitRematchDeclined(): void;
  /** Simuluje příchozí signál „soupeř dal Konec – partie skončila pro oba". */
  emitGameClosed(): void;
  /** Přepne, zda GameLink příkazy „odešlou" (true) nebo selžou jako při ztrátě spojení (false). */
  setLinkOk(ok: boolean): void;
}

/** Postaví herní obrazovku s fake socketem/linkem a vrátí ovládací háčky pro test. */
function mount(overrides: { color?: 'black' | 'white'; createStoneImage?: () => HTMLImageElement } = {}): Mounted {
  let socket: FakeSocket | undefined;
  let backCount = 0;
  let errorHandler: ((message: string) => void) | null = null;
  let drawOfferedHandler: (() => void) | null = null;
  let drawRejectedHandler: (() => void) | null = null;
  let rematchOfferedHandler: (() => void) | null = null;
  let rematchDeclinedHandler: (() => void) | null = null;
  let gameClosedHandler: (() => void) | null = null;
  const commands: string[] = [];
  let linkOk = true;
  const record = (name: string): boolean => {
    commands.push(name);
    return linkOk;
  };
  const link: GameLink = {
    move: () => true,
    onError: (handler) => {
      errorHandler = handler;
      return () => {
        errorHandler = null;
      };
    },
    resign: () => record('resign'),
    offerDraw: () => record('offerDraw'),
    acceptDraw: () => record('acceptDraw'),
    rejectDraw: () => record('rejectDraw'),
    leaveGame: () => record('leaveGame'),
    offerRematch: () => record('offerRematch'),
    acceptRematch: () => record('acceptRematch'),
    declineRematch: () => record('declineRematch'),
    onDrawOffered: (handler) => {
      drawOfferedHandler = handler;
      return () => {
        drawOfferedHandler = null;
      };
    },
    onDrawRejected: (handler) => {
      drawRejectedHandler = handler;
      return () => {
        drawRejectedHandler = null;
      };
    },
    onRematchOffered: (handler) => {
      rematchOfferedHandler = handler;
      return () => {
        rematchOfferedHandler = null;
      };
    },
    onRematchDeclined: (handler) => {
      rematchDeclinedHandler = handler;
      return () => {
        rematchDeclinedHandler = null;
      };
    },
    onGameClosed: (handler) => {
      gameClosedHandler = handler;
      return () => {
        gameClosedHandler = null;
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
  const mounted: Mounted = {
    element: screen.element,
    socket: socket!,
    dispose: () => {
      screen.dispose();
    },
    backCalls: () => backCount,
    emitError: (message) => errorHandler?.(message),
    commands: () => commands,
    emitDrawOffered: () => drawOfferedHandler?.(),
    emitDrawRejected: () => drawRejectedHandler?.(),
    emitRematchOffered: () => rematchOfferedHandler?.(),
    emitRematchDeclined: () => rematchDeclinedHandler?.(),
    emitGameClosed: () => gameClosedHandler?.(),
    setLinkOk: (ok) => {
      linkOk = ok;
    },
  };
  mountedScreens.push(mounted);
  return mounted;
}

// Všechny postavené obrazovky – afterEach je disposne, ať globální listener (Esc na
// `document`) neuniká mezi testy a nespouští se na cizí (odmountovanou) obrazovku.
const mountedScreens: Mounted[] = [];

/** Klikne na tlačítko podle selektoru (musí existovat). */
function click(m: Mounted, selector: string): void {
  const btn = m.element.querySelector<HTMLButtonElement>(selector);
  if (btn === null) {
    throw new Error(`tlačítko ${selector} nenalezeno`);
  }
  btn.click();
}

/** Je tlačítko podle selektoru zamčené (disabled)? */
function disabled(m: Mounted, selector: string): boolean {
  return m.element.querySelector<HTMLButtonElement>(selector)!.disabled;
}

/** Je prvek podle selektoru skrytý (třída hidden)? */
function hidden(m: Mounted, selector: string): boolean {
  return m.element.querySelector(selector)!.classList.contains('hidden');
}

/** Je modal (dotaz vzdání/remízy) zavřený? */
function modalClosed(m: Mounted): boolean {
  return hidden(m, '.modal-overlay');
}

/** Text zprávy v modalu (dotaz). */
function modalText(m: Mounted): string {
  return m.element.querySelector('.modal-msg')!.textContent ?? '';
}

/** Klik na primární (kladné) tlačítko modalu – první v `.modal-actions`. */
function clickModalPrimary(m: Mounted): void {
  m.element.querySelector<HTMLButtonElement>('.modal-actions button:first-child')!.click();
}

/** Klik na sekundární (záporné) tlačítko modalu – poslední v `.modal-actions`. */
function clickModalSecondary(m: Mounted): void {
  m.element.querySelector<HTMLButtonElement>('.modal-actions button:last-child')!.click();
}

/** Vyvolá stisk klávesy na dokumentu (pro Esc chování modalu). */
function pressKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

beforeEach(() => {
  // Úvodní REST snapshot v game-socket volá fetch – utni ho na „nic" (ne-ok), ať
  // v jsdom neběží reálná síť ani nespadne do console.error.
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: false } as Response));
});

afterEach(() => {
  for (const m of mountedScreens) {
    m.dispose(); // odregistruje i globální keydown listener (Esc na document)
  }
  mountedScreens.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createGameScreen – rozvržení', () => {
  it('má panel s popiskem Soupeř: a TUČNOU přezdívkou, BEZ tlačítka Zpět / nadpisu / řádku barvy', () => {
    const m = mount();
    const nick = m.element.querySelector('.pvp-opponent');
    expect(nick?.textContent).toBe('Karel');
    // Popisek „Soupeř:" před přezdívkou, ať je jasné, že jméno patří soupeři.
    expect(m.element.querySelector('.pvp-opponent-label')?.textContent).toBe('Soupeř:');
    // Přezdívka je v panelu s ovládáním (sdílené třídy s AI).
    expect(m.element.querySelector('.panel .pvp-controls .pvp-opponent')).not.toBeNull();
    // Za běhu NENÍ „Zpět do místnosti" (nechá tě busy → blokace do refreshe, fáze 77).
    expect(m.element.querySelector('.btn-back-room')).toBeNull();
    // Zrušené prvky: žádný nadpis „Partie" ani řádek „Hraješ za …".
    expect(m.element.querySelector('h1')).toBeNull();
    expect(m.element.textContent).not.toContain('Hraješ za');
    // Rozvržení sdílené s AI: root .game, deska v .board-row, pozadí .page-bg.
    expect(m.element.classList.contains('game')).toBe(true);
    expect(m.element.querySelector('.board-row')).not.toBeNull();
    expect(m.element.querySelector('.page-bg')).not.toBeNull();
  });

  it('signál game-closed (soupeř dal Konec) přesune do místnosti', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'white-wins') });
    // Soupeř dal Konec → moje obrazovka se má přesunout do místnosti bez mého kliknutí.
    m.emitGameClosed();
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

  it('ztráta spojení zamkne desku, schová indikátor a otevře NOUZOVÝ modal s cestou do místnosti', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') }); // ať partie běží
    expect(m.element.querySelector('.pvp-turn')!.classList.contains('hidden')).toBe(false);
    m.socket.fireClose();
    expect(m.element.querySelector('.status')!.textContent).toContain('Spojení');
    expect(m.element.querySelector('.pvp-turn')!.classList.contains('hidden')).toBe(true);
    // KLÍČOVÉ (regrese po odebrání back buttonu): musí existovat cesta ven. Modal
    // s „Zpět do místnosti" – bez něj by uživatel uvázl a musel reloadovat.
    expect(modalClosed(m)).toBe(false);
    expect(modalText(m)).toContain('Spojení');
    const btn = m.element.querySelector<HTMLButtonElement>('.modal-actions button:first-child')!;
    expect(btn.textContent).toBe('Zpět do místnosti');
    btn.click();
    expect(m.backCalls()).toBe(1);
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

describe('createGameScreen – vzdání modalem (fáze 77)', () => {
  it('tlačítko Vzdát se je zamčené před prvním stavem, aktivní za běhu, zamčené po konci', () => {
    const m = mount();
    expect(disabled(m, '.btn-resign')).toBe(true); // partie se teprve načítá
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    expect(disabled(m, '.btn-resign')).toBe(false);
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'white-wins') });
    expect(disabled(m, '.btn-resign')).toBe(true);
  });

  it('klik Vzdát se otevře MODAL s dotazem, příkaz NEodešle; teprve „Ano" ho odešle a modal zavře', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    click(m, '.btn-resign');
    expect(modalClosed(m)).toBe(false);
    expect(modalText(m)).toContain('vzdát');
    expect(m.commands()).toEqual([]); // zatím nic
    clickModalPrimary(m); // „Ano, vzdát se"
    expect(m.commands()).toEqual(['resign']);
    expect(modalClosed(m)).toBe(true);
  });

  it('„Zrušit" zavře modal, příkaz neodešle a tlačítko zas odemkne', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    click(m, '.btn-resign');
    expect(disabled(m, '.btn-resign')).toBe(true); // otevřený dotaz tlačítko zamkl
    clickModalSecondary(m); // „Zrušit"
    expect(modalClosed(m)).toBe(true);
    expect(m.commands()).toEqual([]);
    expect(disabled(m, '.btn-resign')).toBe(false); // zpět aktivní, partie běží dál
  });

  it('Esc i klik na pozadí zavřou dotaz na vzdání (bezpečné = Zrušit)', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    click(m, '.btn-resign');
    pressKey('Escape');
    expect(modalClosed(m)).toBe(true);
    expect(m.commands()).toEqual([]);
    // A backdrop klik taky zavře (znovu otevři a klikni na overlay).
    click(m, '.btn-resign');
    m.element.querySelector<HTMLElement>('.modal-overlay')!.click();
    expect(modalClosed(m)).toBe(true);
  });

  it('když příkaz vzdání neodejde (spojení dole), modal se zavře a tlačítko zas odemkne', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.setLinkOk(false); // resign() vrátí false (room WS dole), game hub ale žije
    click(m, '.btn-resign');
    clickModalPrimary(m);
    expect(m.commands()).toEqual(['resign']); // pokus proběhl
    expect(modalClosed(m)).toBe(true);
    expect(disabled(m, '.btn-resign')).toBe(false); // NEzaseklo se v zamčeném stavu
    expect(m.element.querySelector('.pvp-notice')!.textContent).toContain('Spojení');
  });

  it('nový stav (tah soupeře) zavře otevřený dotaz na vzdání', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    click(m, '.btn-resign'); // dotaz otevřený
    expect(modalClosed(m)).toBe(false);
    m.socket.message({ type: 'game-state', game: pvpGame('white') }); // přišel nový stav
    expect(modalClosed(m)).toBe(true);
  });
});

describe('createGameScreen – nabídka remízy modalem (fáze 77)', () => {
  it('klik Nabídnout remízu odešle offerDraw, ukáže „čekám" a zamkne tlačítko', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    click(m, '.btn-offer-draw');
    expect(m.commands()).toEqual(['offerDraw']);
    expect(disabled(m, '.btn-offer-draw')).toBe(true);
    const notice = m.element.querySelector('.pvp-notice')!;
    expect(notice.classList.contains('hidden')).toBe(false);
    expect(notice.textContent).toContain('čekám');
  });

  it('soupeř odmítne mou nabídku → notice a tlačítko zas aktivní', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    click(m, '.btn-offer-draw');
    m.emitDrawRejected();
    expect(disabled(m, '.btn-offer-draw')).toBe(false);
    expect(m.element.querySelector('.pvp-notice')!.textContent).toContain('odmítl');
  });

  it('odmítnutá nabídka serverem (error) zruší „čekám" a odemkne tlačítko', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    click(m, '.btn-offer-draw');
    m.emitError('Remíza už je nabídnutá.');
    expect(disabled(m, '.btn-offer-draw')).toBe(false);
    expect(hidden(m, '.pvp-notice')).toBe(true);
  });

  it('příchozí nabídka soupeře otevře MODAL; Přijmout odešle acceptDraw a modal zavře', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.emitDrawOffered();
    expect(modalClosed(m)).toBe(false);
    expect(modalText(m)).toContain('remízu');
    // Dokud visí soupeřova nabídka, sám nenabízím.
    expect(disabled(m, '.btn-offer-draw')).toBe(true);
    clickModalPrimary(m); // „Přijmout remízu"
    expect(m.commands()).toEqual(['acceptDraw']);
    expect(modalClosed(m)).toBe(true);
  });

  it('příchozí nabídku lze odmítnout → rejectDraw, modal zmizí, partie běží', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.emitDrawOffered();
    clickModalSecondary(m); // „Odmítnout"
    expect(m.commands()).toEqual(['rejectDraw']);
    expect(modalClosed(m)).toBe(true);
    expect(disabled(m, '.btn-offer-draw')).toBe(false); // zas můžu nabídnout
  });

  it('Esc ani klik na pozadí nabídku remízy NEZAVŘOU (nutná volba Přijmout/Odmítnout)', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.emitDrawOffered();
    pressKey('Escape');
    expect(modalClosed(m)).toBe(false); // pořád visí
    m.element.querySelector<HTMLElement>('.modal-overlay')!.click(); // klik na pozadí
    expect(modalClosed(m)).toBe(false);
    expect(m.commands()).toEqual([]); // nic se neodeslalo
  });

  it('když přijetí neodejde (spojení dole), modal ZŮSTANE otevřený', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.emitDrawOffered();
    m.setLinkOk(false); // acceptDraw vrátí false
    clickModalPrimary(m);
    // Modal se NESMÍ zavřít: serverová nabídka visí dál, uživatel musí mít šanci zkusit znovu.
    expect(modalClosed(m)).toBe(false);
    expect(m.element.querySelector('.pvp-notice')!.textContent).toContain('Spojení');
    m.setLinkOk(true); // spojení zpět → přijetí projde a modal zmizí
    clickModalPrimary(m);
    expect(m.commands()).toEqual(['acceptDraw', 'acceptDraw']);
    expect(modalClosed(m)).toBe(true);
  });

  it('nový stav (tah) zavře visící nabídku (implicitní odmítnutí)', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.emitDrawOffered();
    expect(modalClosed(m)).toBe(false);
    m.socket.message({ type: 'game-state', game: pvpGame('white') });
    expect(modalClosed(m)).toBe(true);
  });

  it('signál nabídky po konci partie se ignoruje (nabídkový modal se neotevře)', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'draw') });
    m.emitDrawOffered();
    // Po konci je otevřený VÝSLEDKOVÝ modal; nabídka ho nepřepíše na „Přijmout/Odmítnout".
    expect(modalText(m)).toBe('Remíza.');
    expect(m.commands()).toEqual([]);
  });

  it('ztráta spojení zamkne obě tlačítka a nahradí visící nabídku nouzovým modalem', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.emitDrawOffered(); // visící nabídka remízy
    m.socket.fireClose();
    expect(disabled(m, '.btn-offer-draw')).toBe(true);
    expect(disabled(m, '.btn-resign')).toBe(true);
    // Nabídka remízy je pryč, ale místo ní je NOUZOVÝ modal (cesta ven), ne prázdno.
    expect(modalText(m)).toContain('Spojení');
  });

  it('konec partie (přijatá remíza) ukáže výsledek a zamkne tlačítka', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') });
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'draw') });
    expect(m.element.querySelector('.status')!.textContent).toBe('Remíza.');
    expect(disabled(m, '.btn-resign')).toBe(true);
    expect(disabled(m, '.btn-offer-draw')).toBe(true);
  });
});

describe('createGameScreen – výsledkový modal Odveta/Konec (fáze 77)', () => {
  it('konec partie otevře VÝSLEDKOVÝ modal s textem výsledku a tlačítky Odveta/Konec', () => {
    const m = mount({ color: 'black' });
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'black-wins') });
    expect(modalClosed(m)).toBe(false);
    expect(modalText(m)).toBe('Vyhrál jsi!'); // černý vyhrál, hraju černé
    expect(m.element.querySelector('.modal-actions button:first-child')!.textContent).toBe('Odveta');
    expect(m.element.querySelector('.modal-actions button:last-child')!.textContent).toBe('Konec');
  });

  it('Odveta nabídne odvetu a ZŮSTANE na obrazovce (čekací modal, ne do místnosti)', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'draw') });
    clickModalPrimary(m); // Odveta
    expect(m.commands()).toEqual(['offerRematch']);
    expect(m.backCalls()).toBe(0); // nikam se nenaviguje
    expect(modalClosed(m)).toBe(false);
    expect(modalText(m)).toContain('Čekám'); // čekací modal
  });

  it('Konec odešle leaveGame a přejde do místnosti', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'draw') });
    clickModalSecondary(m); // Konec
    expect(m.commands()).toEqual(['leaveGame']);
    expect(m.backCalls()).toBe(1);
  });

  it('výsledkový modal je nedismissovatelný: Esc ani klik na pozadí ho nezavřou', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'draw') });
    pressKey('Escape');
    expect(modalClosed(m)).toBe(false);
    m.element.querySelector<HTMLElement>('.modal-overlay')!.click();
    expect(modalClosed(m)).toBe(false);
    expect(m.commands()).toEqual([]); // nic se neodeslalo
  });

  it('ztráta spojení PO konci partie nepřebije výsledkový modal', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'white-wins') });
    m.socket.fireClose(); // herní WS spadl až po konci
    expect(modalClosed(m)).toBe(false);
    expect(modalText(m)).toBe('Prohrál jsi.'); // pořád výsledek, ne „spojení přerušeno"
    // Stavový řádek nese výsledek, ne hlášku o spojení.
    expect(m.element.querySelector('.status')!.textContent).toBe('Prohrál jsi.');
  });
});

describe('createGameScreen – důvod konce v textu výsledku (fáze 78)', () => {
  /** Text v modalu i ve stavovém řádku (mají být shodné). */
  function endText(m: Mounted): { modal: string | null; status: string | null } {
    return {
      modal: modalText(m),
      status: m.element.querySelector('.status')!.textContent,
    };
  }

  it('soupeř se vzdal → výherce vidí důvod (ne holé „Vyhrál jsi!")', () => {
    const m = mount({ color: 'black' }); // hraju černé, černý vyhrál = soupeř (bílý) se vzdal
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'black-wins', 'resign') });
    expect(endText(m)).toEqual({ modal: 'Soupeř se vzdal – vyhrál jsi!', status: 'Soupeř se vzdal – vyhrál jsi!' });
  });

  it('vzdal jsem se sám → poražený vidí, že prohrál vzdáním', () => {
    const m = mount({ color: 'black' }); // hraju černé, bílý vyhrál = já (černý) jsem se vzdal
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'white-wins', 'resign') });
    expect(endText(m)).toEqual({ modal: 'Vzdal ses – prohrál jsi.', status: 'Vzdal ses – prohrál jsi.' });
  });

  it('remíza dohodou vs. remíza podle pravidel se v textu LIŠÍ', () => {
    const agreed = mount({ color: 'black' });
    agreed.socket.message({ type: 'game-state', game: pvpGame('black', 'draw', 'draw-agreement') });
    expect(modalText(agreed)).toBe('Remíza dohodou.');

    const byRules = mount({ color: 'black' });
    byRules.socket.message({ type: 'game-state', game: pvpGame('black', 'draw', 'rules') });
    expect(modalText(byRules)).toBe('Remíza podle pravidel.');
  });

  it('bez důvodu (reason null) spadne na dosavadní neutrální text – žádná regrese', () => {
    const m = mount({ color: 'black' });
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'black-wins', null) });
    expect(modalText(m)).toBe('Vyhrál jsi!');
  });

  it('starší server: klíč reason ve stavu úplně CHYBÍ → fallback, deska nezamrzne', () => {
    const m = mount({ color: 'black' });
    // Stav bez pole `reason` (undefined, ne null) – simuluje server před fází 78.
    const legacy = { mode: 'pvp', id: 'g1', position: { ...initialPosition(), turn: 'black' }, result: 'black-wins', legalMoves: [] };
    m.socket.message({ type: 'game-state', game: legacy as unknown as PvpGameDto });
    // Guard stav NEzahodil (jinak by výsledkový modal vůbec nevznikl) a text je neutrální.
    expect(modalClosed(m)).toBe(false);
    expect(modalText(m)).toBe('Vyhrál jsi!');
  });

  it('důvod přežije znovuotevření výsledku (Odveta odmítnuta → reopenResult)', () => {
    const m = mount({ color: 'black' });
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'black-wins', 'resign') });
    clickModalPrimary(m); // Odveta → čekací modal
    expect(modalText(m)).toContain('Čekám');
    // Soupeř odvetu odmítl → zpět na výsledkový modal; důvod musí zůstat.
    m.emitRematchDeclined();
    expect(modalText(m)).toBe('Soupeř se vzdal – vyhrál jsi!');
  });
});

describe('createGameScreen – protokol odvety (fáze 77)', () => {
  /** Dostane obrazovku do stavu „konec partie" (výsledkový modal otevřený). */
  function ended(m: Mounted): void {
    m.socket.message({ type: 'game-state', game: pvpGame('black', 'draw') });
  }

  it('nabízející: Odveta → čekací modal jen s Koncem; Odveta odešla, nikam nenaviguje', () => {
    const m = mount();
    ended(m);
    clickModalPrimary(m); // Odveta
    expect(m.commands()).toEqual(['offerRematch']);
    expect(modalText(m)).toContain('Čekám');
    // Ve čekacím modalu je primární tlačítko skryté (jen „Konec").
    expect(m.element.querySelector('.modal-actions button:first-child')!.classList.contains('hidden')).toBe(true);
    expect(m.element.querySelector('.modal-actions button:last-child')!.textContent).toBe('Konec');
    expect(m.backCalls()).toBe(0);
  });

  it('nabízející: Konec v čekacím modalu odešle leaveGame a přejde do místnosti', () => {
    const m = mount();
    ended(m);
    clickModalPrimary(m); // Odveta → čekám
    clickModalSecondary(m); // Konec
    expect(m.commands()).toEqual(['offerRematch', 'leaveGame']);
    expect(m.backCalls()).toBe(1);
  });

  it('nabízející: odmítnutá/zrušená odveta → zpět na výsledek s hláškou v modalu', () => {
    const m = mount();
    ended(m);
    clickModalPrimary(m); // čekám
    m.emitRematchDeclined();
    expect(modalText(m)).toBe('Remíza.'); // zpět na výsledek
    expect(m.element.querySelector('.modal-notice')!.textContent).toContain('odmítl');
    // A zas můžu dát Odvetu nebo Konec.
    expect(m.element.querySelector('.modal-actions button:first-child')!.textContent).toBe('Odveta');
  });

  it('nabízející: Odveta při spadlém spojení → zůstane na výsledku s hláškou', () => {
    const m = mount();
    ended(m);
    m.setLinkOk(false);
    clickModalPrimary(m);
    expect(m.commands()).toEqual(['offerRematch']);
    expect(modalText(m)).toBe('Remíza.'); // zůstal výsledek (ne čekací modal)
    expect(m.element.querySelector('.pvp-notice')!.textContent).toContain('Spojení');
  });

  it('vyzvaný: příchozí odveta otevře dotaz Přijmout/Odmítnout', () => {
    const m = mount();
    ended(m);
    m.emitRematchOffered();
    expect(modalText(m)).toContain('odvetu');
    expect(m.element.querySelector('.modal-actions button:first-child')!.textContent).toBe('Přijmout odvetu');
    expect(m.element.querySelector('.modal-actions button:last-child')!.textContent).toBe('Odmítnout');
  });

  it('vyzvaný: Přijmout odešle acceptRematch (přechod do nové hry řeší challenge-accepted)', () => {
    const m = mount();
    ended(m);
    m.emitRematchOffered();
    clickModalPrimary(m);
    expect(m.commands()).toEqual(['acceptRematch']);
    expect(m.backCalls()).toBe(0); // nová hra přijde zvenčí, ne návratem do místnosti
  });

  it('vyzvaný: Odmítnout odešle declineRematch a vrátí se na výsledek', () => {
    const m = mount();
    ended(m);
    m.emitRematchOffered();
    clickModalSecondary(m);
    expect(m.commands()).toEqual(['declineRematch']);
    expect(modalText(m)).toBe('Remíza.'); // zpět na výsledek
  });

  it('příchozí odveta PŘED koncem partie se ignoruje', () => {
    const m = mount();
    m.socket.message({ type: 'game-state', game: pvpGame('black') }); // běží
    m.emitRematchOffered();
    expect(modalClosed(m)).toBe(true); // žádný dotaz na odvetu za běhu
  });

  it('rematch-declined když nečekám (jsem na výsledku) se ignoruje', () => {
    const m = mount();
    ended(m);
    m.emitRematchDeclined();
    expect(modalText(m)).toBe('Remíza.'); // beze změny, žádná hláška
    expect(m.element.querySelector('.modal-notice')!.classList.contains('hidden')).toBe(true);
  });

  it('vyzvaný: když nabízející dá Konec, příchozí dotaz nezůstane viset → přesun do místnosti', () => {
    const m = mount();
    ended(m);
    m.emitRematchOffered(); // soupeř nabídl → dotaz Přijmout/Odmítnout
    expect(modalText(m)).toContain('odvetu');
    m.emitGameClosed(); // ale soupeř dal Konec dřív, než jsem odpověděl
    // Dotaz „Přijmout" nesmí zůstat viset (jinak bych přijal mrtvou odvetu); přesun do místnosti.
    expect(m.backCalls()).toBe(1);
  });

  it('nabízející: chyba serveru během čekání na odvetu → zpět na výsledek s hláškou v modalu', () => {
    const m = mount();
    ended(m);
    clickModalPrimary(m); // Odveta → čekám
    expect(modalText(m)).toContain('Čekám');
    m.emitError('Odveta už není možná (soupeř odešel).'); // server odmítl nabídku
    // Nesmím uvíznout ve „Čekám…"; vrátím se na výsledek a důvod vidím v modalu.
    expect(modalText(m)).toBe('Remíza.');
    expect(m.element.querySelector('.modal-notice')!.textContent).toContain('už není možná');
  });
});

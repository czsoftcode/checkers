// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLocale, setLocale } from '../src/i18n.js';
import { createLobby } from '../src/lobby.js';
import type { GameLink } from '../src/lobby.js';
import type { ChallengeAcceptedInfo, RoomWebSocket } from '../src/room-client.js';

/** Ovladatelný fake socketu (viz room-client.test) – lobby jede přes REÁLNÝ room-client. */
class FakeSocket implements RoomWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  fireClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const NICK_STORAGE_KEY = 'checkers.roomNick';

/** Lobby k úklidu po testu – jinak po nich visí connect-timer (setTimeout) z room-clientu. */
const activeLobbies: { dispose(): void }[] = [];

/**
 * Namontuje lobby. `savedNick` (fáze 108) předvyplní LocalStorage PŘED mountem →
 * lobby se rovnou AUTO-connectne (socket vznikne hned, bez modalu). Bez něj se otevře
 * modal přezdívky (žádný socket, dokud nick nezadám).
 */
function mountLobby(savedNick?: string) {
  if (savedNick !== undefined) {
    localStorage.setItem(NICK_STORAGE_KEY, savedNick);
  }
  const sockets: FakeSocket[] = [];
  const onPlayVsComputer = vi.fn();
  const onGameStart = vi.fn<(info: ChallengeAcceptedInfo, link: GameLink) => void>();
  const onLocaleChange = vi.fn();
  const lobby = createLobby({
    onPlayVsComputer,
    onGameStart,
    onLocaleChange,
    roomUrl: 'ws://test/room/ws',
    socketFactory: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
  });
  activeLobbies.push(lobby);
  document.body.append(lobby.element);
  const el = lobby.element;
  const q = <T extends HTMLElement>(sel: string): T => {
    const found = el.querySelector<T>(sel);
    if (found === null) {
      throw new Error(`prvek ${sel} nenalezen`);
    }
    return found;
  };
  return {
    sockets,
    onPlayVsComputer,
    onGameStart,
    onLocaleChange,
    lobby,
    el,
    lang: q<HTMLSelectElement>('.lobby-lang'),
    room: q<HTMLElement>('.lobby-room'),
    // Dva overlaye: příchozí výzva (bez nick třídy) a MODAL přezdívky (fáze 108).
    challengeModal: q<HTMLElement>('.modal-overlay:not(.lobby-nick-modal)'),
    nickModal: q<HTMLElement>('.lobby-nick-modal'),
    nickInput: q<HTMLInputElement>('.lobby-nick'),
    nickSaveBtn: q<HTMLButtonElement>('.lobby-nick-save-btn'),
    nickCancelBtn: q<HTMLButtonElement>('.lobby-nick-cancel-btn'),
    nickModalLang: q<HTMLSelectElement>('.lobby-nick-lang'),
    outgoing: q<HTMLElement>('.lobby-outgoing'),
    notice: q<HTMLElement>('.lobby-notice'),
    accordion: q<HTMLElement>('.lobby-accordion'),
    nickLine: q<HTMLButtonElement>('.lobby-nick-line'),
    disconnected: q<HTMLElement>('.lobby-disconnected'),
    reconnectBtn: q<HTMLButtonElement>('.lobby-reconnect-btn'),
    soloBtn: q<HTMLButtonElement>('.lobby-solo-btn'),
    msg: q<HTMLElement>('.lobby-msg'),
  };
}

type Handle = ReturnType<typeof mountLobby>;

const hidden = (el: HTMLElement): boolean => el.classList.contains('hidden');

/** Zadá do modalu přezdívku a klikne Uložit (první připojení bez uloženého nicku). */
function saveNickInModal(h: Handle, nick: string): void {
  h.nickInput.value = nick;
  h.nickSaveBtn.click();
}

/** Položky rosteru PRÁVĚ ROZBALENÉ sekce (dynamické – v akordeonu). */
function rosterItems(h: Handle): HTMLElement[] {
  return Array.from(h.el.querySelectorAll<HTMLElement>('.lobby-roster-item'));
}
/** Tlačítka „Vyzvat" v rozbalené sekci mé lobby. */
function challengeBtns(h: Handle): HTMLButtonElement[] {
  return Array.from(h.el.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn'));
}
/** Sekce akordeonu (4, dle registru variant). */
function sections(h: Handle): HTMLElement[] {
  return Array.from(h.el.querySelectorAll<HTMLElement>('.lobby-section'));
}
/** Hlavička sekce dané varianty (podle názvu; shoda prefixem – názvy nesou dovětek
 *  „dáma" z fáze 109, prefixy variant jsou navzájem jednoznačné). */
function sectionByName(h: Handle, name: string): HTMLElement {
  const found = sections(h).find((s) =>
    (s.querySelector('.lobby-section-name')?.textContent ?? '').startsWith(name),
  );
  if (found === undefined) {
    throw new Error(`sekce „${name}" nenalezena`);
  }
  return found;
}

/** All-roster snímek 5 lobby: `players` mapuje variantu → seznam [id, nick]. */
function lobbiesMsg(players: Partial<Record<string, [string, string][]>>) {
  const all = ['american', 'pool', 'russian', 'czech', 'italian'] as const;
  return {
    type: 'lobbies',
    lobbies: all.map((variant) => ({
      variant,
      players: (players[variant] ?? []).map(([id, nick]) => ({ id, nick })),
    })),
  };
}

/**
 * Auto-connect (uložený nick 'Jan') do AMERICKÉ lobby + roster/snímek: Jan(=já),
 * Eva(2), Petr(3), ostatní prázdné. Moje lobby je rozbalená → roster se 3 hráči.
 */
function joinedLobby(): Handle {
  const h = mountLobby('Jan');
  h.sockets[0]!.open();
  h.sockets[0]!.message({
    type: 'roster',
    variant: 'american',
    players: [
      { id: '1', nick: 'Jan' },
      { id: '2', nick: 'Eva' },
      { id: '3', nick: 'Petr' },
    ],
  });
  h.sockets[0]!.message(
    lobbiesMsg({
      american: [
        ['1', 'Jan'],
        ['2', 'Eva'],
        ['3', 'Petr'],
      ],
    }),
  );
  h.sockets[0]!.sent.length = 0; // zahoď connect
  return h;
}

/**
 * Auto-connect (uložený nick 'Jan') do PŘEDSÍNĚ: connect + all-roster snímek, kde já
 * (Jan) NEJSEM v žádné lobby (myVariant=null). Akordeon ukazuje obsazenost, každá
 * sekce nabídne Vstoupit (→ `enter`). Sekce startují sbalené.
 */
function foyer(): Handle {
  const h = mountLobby('Jan');
  h.sockets[0]!.open();
  h.sockets[0]!.message(lobbiesMsg({ american: [['2', 'Eva']], russian: [['9', 'Olga']] }));
  h.sockets[0]!.sent.length = 0; // zahoď connect
  return h;
}

beforeEach(() => {
  localStorage.clear();
  // Tyto testy tvrdí na české texty; jazyk je modulový jedináček a jsdom hlásí en-US,
  // tak ho připni na cs (detekci ověřuje lobby-i18n.test.ts).
  setLocale('cs');
});
afterEach(() => {
  for (const l of activeLobbies) {
    l.dispose(); // zavře room WS a zruší visící connect-timer
  }
  activeLobbies.length = 0;
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('createLobby – pozadí a struktura', () => {
  it('má celostránkové pozadí: <img.page-bg> s nastaveným src (intro.webp)', () => {
    const h = mountLobby();
    const bg = h.el.querySelector<HTMLImageElement>('img.page-bg');
    expect(bg).not.toBeNull();
    const src = bg!.getAttribute('src') ?? '';
    expect(src.length).toBeGreaterThan(0);
    expect(src).toContain('intro');
    expect(src).not.toContain('mobile');
  });

  it('pozadí je <picture> a na výšku (portrait) vybírá intro_mobile.webp', () => {
    const h = mountLobby();
    const picture = h.el.querySelector('picture');
    expect(picture).not.toBeNull();
    const bg = picture!.querySelector<HTMLImageElement>('img.page-bg');
    const source = picture!.querySelector('source');
    expect(source!.getAttribute('media')).toBe('(orientation: portrait)');
    expect(source!.getAttribute('srcset') ?? '').toContain('intro_mobile');
    const kids = Array.from(picture!.children);
    expect(kids.indexOf(source!)).toBeLessThan(kids.indexOf(bg!));
  });
});

describe('createLobby – brána identity (modal přezdívky, fáze 108)', () => {
  it('první načtení (bez uloženého nicku): modal otevřený, ZAVÍRATELNÝ (kvůli sólu), žádný socket', () => {
    const h = mountLobby();
    expect(hidden(h.nickModal)).toBe(false); // modal je vidět
    expect(hidden(h.nickCancelBtn)).toBe(false); // „Zrušit" JE – solo-hráč modal zavře
    expect(h.sockets).toHaveLength(0); // nic se nepřipojuje, dokud nemám nick
  });

  it('modal jde zavřít (Zrušit) → stránka použitelná; „Přihlásit se" ho zas otevře', () => {
    const h = mountLobby();
    h.nickCancelBtn.click();
    expect(hidden(h.nickModal)).toBe(true);
    // Sólo funguje bez přihlášení (past neexistuje).
    h.soloBtn.click();
    expect(h.onPlayVsComputer).toHaveBeenCalledTimes(1);
    // A jediná cesta zpět k PvP: tlačítko nad akordeonem „Přihlásit se ke hře s lidmi".
    expect(h.nickLine.textContent).toContain('Přihlásit se');
    h.nickLine.click();
    expect(hidden(h.nickModal)).toBe(false);
  });

  it('nepřipojen: „Vstoupit" v místnosti neposílá enter, jen otevře modal přihlášení', () => {
    const h = mountLobby();
    h.nickCancelBtn.click(); // zavři modal, zůstaň nepřipojený
    // Rozbal libovolnou sekci a klikni Vstoupit.
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    expect(h.sockets).toHaveLength(0); // žádný connect/enter „naslepo"
    expect(hidden(h.nickModal)).toBe(false); // místo mrtvého tlačítka se nabídne přihlášení
  });

  it('uložení nicku v modalu pošle connect{nick} a modal se (optimisticky) zavře', () => {
    const h = mountLobby();
    saveNickInModal(h, 'Jan');
    expect(h.sockets).toHaveLength(1);
    expect(hidden(h.nickModal)).toBe(true);
    h.sockets[0]!.open();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'connect', nick: 'Jan' })]);
  });

  it('prázdná přezdívka se neodešle a modal zůstane s hláškou', () => {
    const h = mountLobby();
    h.nickInput.value = '   ';
    h.nickSaveBtn.click();
    expect(h.sockets).toHaveLength(0);
    expect(hidden(h.nickModal)).toBe(false);
    expect(h.nickModal.textContent).toContain('Zadej přezdívku');
  });

  it('vracející se uživatel (uložený nick) se AUTO-connectne bez modalu', () => {
    const h = mountLobby('Jan');
    expect(hidden(h.nickModal)).toBe(true); // žádný modal
    expect(h.sockets).toHaveLength(1); // socket vznikl hned
    h.sockets[0]!.open();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'connect', nick: 'Jan' })]);
    // Label „Jsi přihlášen jako Jan" už během připojování.
    expect(h.nickLine.textContent).toContain('Jan');
  });

  it('po připojení (snímek) se ukáže předsíň a modal je zavřený', () => {
    const h = mountLobby('Jan');
    h.sockets[0]!.open();
    h.sockets[0]!.message(lobbiesMsg({ american: [['2', 'Eva']] }));
    expect(hidden(h.nickModal)).toBe(true);
    expect(hidden(h.room)).toBe(false);
    expect(h.nickLine.textContent).toContain('Jsi přihlášen jako Jan');
  });

  it('obsazená přezdívka (nick-taken) reotevře modal s návrhem a hláškou', () => {
    const h = mountLobby('Jan');
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'nick-taken', suggestion: 'Jan2' });
    expect(hidden(h.nickModal)).toBe(false);
    expect(h.nickInput.value).toBe('Jan2');
    expect(h.nickModal.textContent).toContain('Jan2');
  });

  it('Esc/Zrušit na NEZDAŘENÉM connectu (nick-taken) nenechá lživé „Jsi přihlášen" ani „Připojuji…"', () => {
    const h = mountLobby('Jan');
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'nick-taken', suggestion: 'Jan2' }); // connect neuspěl
    // Uživatel místo volby zavře modal (Zrůšit).
    h.nickCancelBtn.click();
    expect(hidden(h.nickModal)).toBe(true);
    // Label NElže o připojení: „Přihlásit se…", ne „Jsi přihlášen jako Jan".
    expect(h.nickLine.textContent).toContain('Přihlásit se');
    expect(h.nickLine.textContent).not.toContain('Jsi přihlášen');
    // „Připojuji…" zmizelo a půlotevřený socket je zavřený.
    expect(hidden(h.msg)).toBe(true);
    expect(h.sockets[0]!.closed).toBe(true);
  });

  it('chyba přezdívky PŘED připojením (moc dlouhá) jde do modalu', () => {
    const h = mountLobby('Jan');
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'error', message: 'Přezdívka je moc dlouhá.' });
    expect(hidden(h.nickModal)).toBe(false);
    expect(h.nickModal.textContent).toContain('moc dlouhá');
  });

  it('přezdívka se uloží a příště (nový mount) se použije k auto-connectu', () => {
    const h = mountLobby();
    saveNickInModal(h, 'Jan');
    expect(localStorage.getItem(NICK_STORAGE_KEY)).toBe('Jan');
    h.lobby.dispose();
    document.body.replaceChildren();
    const h2 = mountLobby(); // bez explicitního savedNick – vezme se z LocalStorage
    expect(hidden(h2.nickModal)).toBe(true);
    expect(h2.sockets).toHaveLength(1);
  });

  it('dispose zavře socket místnosti', () => {
    const h = mountLobby('Jan');
    h.lobby.dispose();
    expect(h.sockets[0]!.closed).toBe(true);
  });
});

describe('createLobby – změna přezdívky (fáze 108)', () => {
  it('klik na „Jsi přihlášen jako X" reotevře modal, tentokrát ZAVÍRATELNÝ', () => {
    const h = foyer();
    h.nickLine.click();
    expect(hidden(h.nickModal)).toBe(false);
    expect(hidden(h.nickCancelBtn)).toBe(false); // mám identitu → jde zrušit
    expect(h.nickInput.value).toBe('Jan'); // předvyplněný aktuální nick
  });

  it('uložení NOVÉHO nicku odpojí starou identitu a připojí novou', () => {
    const h = foyer();
    h.nickLine.click();
    h.nickInput.value = 'Novy';
    h.nickSaveBtn.click();
    // Starý socket zavřen, nový otevřen s novým connectem.
    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.open();
    expect(h.sockets[1]!.sent).toEqual([JSON.stringify({ type: 'connect', nick: 'Novy' })]);
    expect(localStorage.getItem(NICK_STORAGE_KEY)).toBe('Novy');
  });

  it('Zrušit nechá starou identitu a nepřipojuje znovu', () => {
    const h = foyer();
    h.nickLine.click();
    h.nickInput.value = 'Novy';
    h.nickCancelBtn.click();
    expect(hidden(h.nickModal)).toBe(true);
    expect(h.sockets).toHaveLength(1); // žádný nový connect
    expect(localStorage.getItem(NICK_STORAGE_KEY)).toBe('Jan');
  });

  it('uložení TÉHOŽ nicku jen zavře modal (žádný zbytečný reconnect)', () => {
    const h = foyer();
    h.nickLine.click();
    h.nickSaveBtn.click(); // nick zůstal 'Jan'
    expect(hidden(h.nickModal)).toBe(true);
    expect(h.sockets).toHaveLength(1);
  });

  it('změna na OBSAZENÝ nick vrátí modal s návrhem (zavíratelný, sólo je pořád po ruce)', () => {
    const h = foyer();
    h.nickLine.click();
    h.nickInput.value = 'Novy';
    h.nickSaveBtn.click(); // odpojí Jana, connectne Novy
    h.sockets[1]!.open();
    h.sockets[1]!.message({ type: 'nick-taken', suggestion: 'Novy2' });
    expect(hidden(h.nickModal)).toBe(false);
    expect(h.nickInput.value).toBe('Novy2');
  });

  it('chyba serveru PŘI změně nicku (ne nick-taken) vrátí modal, ne zásek v „Připojuji…"', () => {
    const h = foyer();
    h.nickLine.click();
    h.nickInput.value = 'Novy';
    h.nickSaveBtn.click(); // odpojí Jana (connected=false), connectne Novy
    h.sockets[1]!.open();
    // Server nový nick odmítne obecnou chybou (ne nick-taken). Bez živého spojení to
    // MUSÍ do modalu (jinak uvázne „Připojuji…" bez cesty ven), ne do notice předsíně.
    h.sockets[1]!.message({ type: 'error', message: 'Přezdívka obsahuje nepovolené znaky.' });
    expect(hidden(h.nickModal)).toBe(false);
    expect(h.nickModal.textContent).toContain('nepovolené znaky');
  });

  it('otevřený modal změny nicku PŘEŽIJE příchozí snímek prezence (nezavře se uprostřed psaní)', () => {
    const h = foyer();
    h.nickLine.click(); // dobrovolně otevřu modal změny nicku (jsem připojen)
    h.nickInput.value = 'Rozepsany';
    // Kdokoli jiný se přidá → server broadcastne `lobbies` VŠEM. Modal NESMÍ zmizet.
    h.sockets[0]!.message(lobbiesMsg({ american: [['2', 'Eva'], ['5', 'Kdosi']] }));
    expect(hidden(h.nickModal)).toBe(false);
    expect(h.nickInput.value).toBe('Rozepsany');
  });
});

describe('createLobby – akordeon a předsíň', () => {
  it('auto-connect → připojuji (label + hláška), pak akordeon s mou rozbalenou lobby', () => {
    const h = mountLobby('Jan');
    expect(h.msg.textContent).toContain('Připojuji');
    h.sockets[0]!.open();
    h.sockets[0]!.message({
      type: 'roster',
      variant: 'american',
      players: [
        { id: '1', nick: 'Jan' },
        { id: '2', nick: 'Eva' },
      ],
    });
    h.sockets[0]!.message(
      lobbiesMsg({
        american: [
          ['1', 'Jan'],
          ['2', 'Eva'],
        ],
      }),
    );
    expect(hidden(h.room)).toBe(false);
    expect(h.nickLine.textContent).toContain('Jan');
    const items = rosterItems(h);
    expect(items).toHaveLength(2);
    expect(items[0]!.classList.contains('is-self')).toBe(true);
    expect(items[0]!.textContent).toContain('Jsi tady');
  });

  it('akordeon má 5 sekcí (registr variant), moje lobby je označená a rozbalená', () => {
    const h = joinedLobby();
    const secs = sections(h);
    expect(secs).toHaveLength(5);
    const names = secs.map((s) => s.querySelector('.lobby-section-name')?.textContent);
    expect(names).toEqual(['Americká dáma', 'Pool dáma', 'Ruská dáma', 'Česká dáma', 'Italská dáma']);
    const american = sectionByName(h, 'Americká');
    expect(american.classList.contains('is-mine')).toBe(true);
    expect(american.classList.contains('is-expanded')).toBe(true);
    expect(american.querySelector('.lobby-section-count')!.textContent).toBe('3');
  });

  it('all-roster snímek aktualizuje obsazení živě (bez re-joinu)', () => {
    const h = joinedLobby();
    expect(rosterItems(h)).toHaveLength(3);
    h.sockets[0]!.message(
      lobbiesMsg({
        american: [
          ['1', 'Jan'],
          ['2', 'Eva'],
        ],
      }),
    );
    expect(rosterItems(h)).toHaveLength(2);
    expect(sectionByName(h, 'Americká').querySelector('.lobby-section-count')!.textContent).toBe('2');
  });

  it('cizí lobby: rozbalím → roster jen ke čtení + Vstoupit, žádné Vyzvat', () => {
    const h = joinedLobby();
    h.sockets[0]!.message(
      lobbiesMsg({
        american: [['1', 'Jan']],
        russian: [['9', 'Olga']],
      }),
    );
    const russian = sectionByName(h, 'Ruská');
    expect(russian.classList.contains('is-expanded')).toBe(false);
    russian.querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    const russianOpen = sectionByName(h, 'Ruská');
    expect(russianOpen.classList.contains('is-expanded')).toBe(true);
    const items = Array.from(russianOpen.querySelectorAll('.lobby-roster-item'));
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('Olga');
    expect(russianOpen.querySelector('.lobby-challenge-btn')).toBeNull();
    expect(russianOpen.querySelector('.lobby-enter-btn')).not.toBeNull();
  });

  it('klik na Vstoupit v cizí lobby (jsem člen jiné) pošle switch-lobby{variant}', () => {
    const h = joinedLobby();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'switch-lobby', variant: 'russian' })]);
  });

  it('po switch (nový snímek s mnou v ruské) se moje lobby přesune a nabídne Vyzvat', () => {
    const h = joinedLobby();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    h.sockets[0]!.message(
      lobbiesMsg({
        russian: [
          ['1', 'Jan'],
          ['9', 'Olga'],
        ],
      }),
    );
    const russian = sectionByName(h, 'Ruská');
    expect(russian.classList.contains('is-mine')).toBe(true);
    expect(russian.classList.contains('is-expanded')).toBe(true);
    expect(sectionByName(h, 'Americká').classList.contains('is-mine')).toBe(false);
  });

  it('klik na hlavičku moje lobby ji sbalí (toggle)', () => {
    const h = joinedLobby();
    expect(sectionByName(h, 'Americká').classList.contains('is-expanded')).toBe(true);
    sectionByName(h, 'Americká').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    expect(sectionByName(h, 'Americká').classList.contains('is-expanded')).toBe(false);
    expect(rosterItems(h)).toHaveLength(0);
  });

  it('vědomé sbalení mé sekce přežije další snímek prezence (nerozbalí se zpět)', () => {
    const h = joinedLobby();
    sectionByName(h, 'Americká').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    expect(sectionByName(h, 'Americká').classList.contains('is-expanded')).toBe(false);
    h.sockets[0]!.message(
      lobbiesMsg({
        american: [
          ['1', 'Jan'],
          ['2', 'Eva'],
          ['3', 'Petr'],
        ],
        russian: [['9', 'Olga']],
      }),
    );
    expect(sectionByName(h, 'Americká').classList.contains('is-expanded')).toBe(false);
  });

  it('předsíň: nejsem člen žádné lobby, počty v hlavičkách ukazují obsazenost', () => {
    const h = foyer();
    expect(hidden(h.room)).toBe(false);
    expect(h.nickLine.textContent).toContain('Jan');
    expect(sections(h).some((s) => s.classList.contains('is-mine'))).toBe(false);
    expect(sectionByName(h, 'Americká').querySelector('.lobby-section-count')!.textContent).toBe('1');
    expect(sectionByName(h, 'Ruská').querySelector('.lobby-section-count')!.textContent).toBe('1');
    expect(sectionByName(h, 'Pool').querySelector('.lobby-section-count')!.textContent).toBe('0');
  });

  it('Vstoupit v předsíni pošle enter{variant} (ne switch-lobby)', () => {
    const h = foyer();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'enter', variant: 'russian' })]);
  });

  it('prázdná cizí lobby po rozbalení hlásí „zatím tu nikdo není"', () => {
    const h = joinedLobby();
    sectionByName(h, 'Pool').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    expect(sectionByName(h, 'Pool').querySelector('.lobby-empty')!.textContent).toContain('nikdo');
  });

  it('odmítnutí switch-lobby (závod s přijetím výzvy) NEpropadne na herní obrazovku', () => {
    const h = joinedLobby();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    expect(h.sockets[0]!.sent).toContain(JSON.stringify({ type: 'switch-lobby', variant: 'russian' }));
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    const link = h.onGameStart.mock.calls[0]![1];
    const gameErrors: string[] = [];
    link.onError((m) => gameErrors.push(m));
    h.sockets[0]!.message({ type: 'error', message: 'Nelze přejít do jiné lobby během partie.' });
    expect(gameErrors).toEqual([]);
  });

  it('odmítnutí switch-lobby mimo partii jde do notice, zůstávám v místnosti', () => {
    const h = joinedLobby();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    h.sockets[0]!.message({ type: 'error', message: 'Neznámá varianta lobby.' });
    expect(h.notice.textContent).toContain('Neznámá varianta');
    expect(hidden(h.room)).toBe(false);
    expect(hidden(h.nickModal)).toBe(true);
  });
});

describe('createLobby – odpojení a reconnect', () => {
  it('pád spojení PŘED úspěšným connectem hlásí „nepodařilo se připojit"', () => {
    const h = mountLobby('Jan');
    h.sockets[0]!.open();
    h.sockets[0]!.fireClose(); // spadlo dřív, než dorazil snímek
    expect(hidden(h.disconnected)).toBe(false);
    expect(h.disconnected.textContent).toContain('nepodařilo připojit');
  });

  it('pád spojení PO připojení hlásí „přerušilo" a schová místnost', () => {
    const h = joinedLobby();
    h.sockets[0]!.fireClose();
    expect(hidden(h.disconnected)).toBe(false);
    expect(hidden(h.room)).toBe(true);
    expect(h.disconnected.textContent).toContain('přerušilo');
  });

  it('„Připojit znovu" otevře nový socket a pošle connect uloženým nickem', () => {
    const h = joinedLobby();
    h.sockets[0]!.fireClose();
    h.reconnectBtn.click();
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.open();
    expect(h.sockets[1]!.sent).toEqual([JSON.stringify({ type: 'connect', nick: 'Jan' })]);
  });
});

describe('createLobby – přepínač jazyka (fáze 84/108)', () => {
  it('vykreslí <select> s možnostmi z LOCALES a předvybere aktivní jazyk', () => {
    const h = mountLobby();
    const options = Array.from(h.lang.options);
    expect(options.map((o) => o.value)).toEqual(['cs', 'en']);
    expect(options.map((o) => o.textContent)).toEqual(['Čeština', 'English']);
    expect(h.lang.value).toBe(getLocale());
    expect(h.lang.value).toBe('cs');
  });

  it('změna jazyka uloží volbu do LocalStorage a vyžádá překreslení', () => {
    const h = mountLobby();
    h.lang.value = 'en';
    h.lang.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('checkers.locale')).toBe('en');
    expect(h.onLocaleChange).toHaveBeenCalledTimes(1);
    expect(getLocale()).toBe('en');
  });

  it('výběr stejného jazyka nepřekresluje ani nezapisuje (žádná zbytečná práce)', () => {
    const h = mountLobby();
    h.lang.value = 'cs';
    h.lang.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.onLocaleChange).not.toHaveBeenCalled();
    expect(localStorage.getItem('checkers.locale')).toBeNull();
  });

  it('přepínač jazyka je vidět I po připojení (rebuild se pak sám auto-connectne)', () => {
    const h = foyer();
    expect(hidden(h.room)).toBe(false);
    expect(hidden(h.lang)).toBe(false); // fáze 108: už se neskrývá
  });

  it('modal přezdívky má vlastní přepínač jazyka (dosažitelný přes overlay)', () => {
    const h = mountLobby(); // první načtení → modal otevřený
    expect(h.nickModalLang).not.toBeNull();
    h.nickModalLang.value = 'en';
    h.nickModalLang.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.onLocaleChange).toHaveBeenCalledTimes(1);
    expect(getLocale()).toBe('en');
  });
});

describe('createLobby – sólo', () => {
  it('„Hrát proti počítači" zavolá callback', () => {
    const h = mountLobby();
    h.soloBtn.click();
    expect(h.onPlayVsComputer).toHaveBeenCalledTimes(1);
  });
});

describe('createLobby – výzvy', () => {
  it('roster mé lobby: vlastní záznam bez tlačítka, cizí s „Vyzvat"', () => {
    const h = joinedLobby();
    const items = rosterItems(h);
    expect(items).toHaveLength(3);
    expect(items[0]!.querySelector('.lobby-challenge-btn')).toBeNull(); // Jan = já
    expect(items[1]!.querySelector('.lobby-challenge-btn')).not.toBeNull(); // Eva
    expect(items[2]!.querySelector('.lobby-challenge-btn')).not.toBeNull(); // Petr
  });

  it('klik na Vyzvat pošle challenge, ukáže „čekám" a zamkne další tlačítka', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'challenge', targetId: '2' })]);
    expect(hidden(h.outgoing)).toBe(false);
    expect(h.outgoing.textContent).toContain('Eva');
    for (const b of challengeBtns(h)) {
      expect(b.disabled).toBe(true);
    }
  });

  it('příchozí výzva otevře MODAL; Přijmout pošle accept, challenge-accepted spustí přechod a zavře modal', () => {
    const h = joinedLobby();
    expect(hidden(h.challengeModal)).toBe(true);
    h.sockets[0]!.message({
      type: 'challenged',
      challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' },
    });
    expect(hidden(h.challengeModal)).toBe(false);
    expect(h.challengeModal.textContent).toContain('Eva');

    h.challengeModal.querySelector<HTMLButtonElement>('.lobby-accept-btn')!.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'accept', challengeId: 'c1' })]);

    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g1', color: 'white', opponentId: '2' });
    expect(hidden(h.challengeModal)).toBe(true);
    expect(h.onGameStart).toHaveBeenCalledTimes(1);
    expect(h.onGameStart.mock.calls[0]![0]).toEqual({
      gameId: 'g1',
      color: 'white',
      opponentId: '2',
      opponentNick: 'Eva',
    });
    const link = h.onGameStart.mock.calls[0]![1];
    expect(typeof link.move).toBe('function');
    expect(typeof link.onError).toBe('function');
  });

  it('herní most: link.move pošle {type:move, gameId, from, path} po room WS', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    h.sockets[0]!.sent.length = 0;
    const link = h.onGameStart.mock.calls[0]![1];
    const ok = link.move(9, [13, 22]);
    expect(ok).toBe(true);
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'move', gameId: 'g7', from: 9, path: [13, 22] })]);
  });

  it('herní most: resign/offerDraw/acceptDraw/rejectDraw pošlou {type, gameId} po room WS (fáze 77)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    h.sockets[0]!.sent.length = 0;
    const link = h.onGameStart.mock.calls[0]![1];
    expect(link.resign()).toBe(true);
    expect(link.offerDraw()).toBe(true);
    expect(link.acceptDraw()).toBe(true);
    expect(link.rejectDraw()).toBe(true);
    expect(h.sockets[0]!.sent).toEqual([
      JSON.stringify({ type: 'resign', gameId: 'g7' }),
      JSON.stringify({ type: 'draw-offer', gameId: 'g7' }),
      JSON.stringify({ type: 'draw-accept', gameId: 'g7' }),
      JSON.stringify({ type: 'draw-reject', gameId: 'g7' }),
    ]);
  });

  it('herní most: draw-offered/draw-rejected pro TUTO partii spustí registrované handlery (fáze 77)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    const link = h.onGameStart.mock.calls[0]![1];
    let offered = 0;
    let rejected = 0;
    link.onDrawOffered(() => (offered += 1));
    link.onDrawRejected(() => (rejected += 1));
    h.sockets[0]!.message({ type: 'draw-offered', gameId: 'g7' });
    h.sockets[0]!.message({ type: 'draw-rejected', gameId: 'g7' });
    expect(offered).toBe(1);
    expect(rejected).toBe(1);
  });

  it('herní most: signál remízy pro JINOU partii se ignoruje (filtr na gameId)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    const link = h.onGameStart.mock.calls[0]![1];
    let offered = 0;
    link.onDrawOffered(() => (offered += 1));
    h.sockets[0]!.message({ type: 'draw-offered', gameId: 'jina-partie' });
    expect(offered).toBe(0);
  });

  it('herní most: po odregistraci onDrawOffered už signál handler nespustí (fáze 77)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    const link = h.onGameStart.mock.calls[0]![1];
    let offered = 0;
    const unsub = link.onDrawOffered(() => (offered += 1));
    unsub();
    h.sockets[0]!.message({ type: 'draw-offered', gameId: 'g7' });
    expect(offered).toBe(0);
  });

  it('herní most: leaveGame (Konec) pošle {type:leave-game, gameId} (fáze 77)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    h.sockets[0]!.sent.length = 0;
    const link = h.onGameStart.mock.calls[0]![1];
    expect(link.leaveGame()).toBe(true);
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'leave-game', gameId: 'g7' })]);
  });

  it('herní most: offerRematch/acceptRematch/declineRematch pošlou {type, gameId} (fáze 77)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    h.sockets[0]!.sent.length = 0;
    const link = h.onGameStart.mock.calls[0]![1];
    expect(link.offerRematch()).toBe(true);
    expect(link.acceptRematch()).toBe(true);
    expect(link.declineRematch()).toBe(true);
    expect(h.sockets[0]!.sent).toEqual([
      JSON.stringify({ type: 'rematch-offer', gameId: 'g7' }),
      JSON.stringify({ type: 'rematch-accept', gameId: 'g7' }),
      JSON.stringify({ type: 'rematch-decline', gameId: 'g7' }),
    ]);
  });

  it('herní most: rematch-offered/rematch-declined/game-closed pro TUTO partii spustí handlery (fáze 77)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    const link = h.onGameStart.mock.calls[0]![1];
    let offered = 0;
    let declined = 0;
    let closed = 0;
    link.onRematchOffered(() => (offered += 1));
    link.onRematchDeclined(() => (declined += 1));
    link.onGameClosed(() => (closed += 1));
    h.sockets[0]!.message({ type: 'rematch-offered', gameId: 'g7' });
    h.sockets[0]!.message({ type: 'rematch-declined', gameId: 'g7' });
    h.sockets[0]!.message({ type: 'game-closed', gameId: 'g7' });
    expect(offered).toBe(1);
    expect(declined).toBe(1);
    expect(closed).toBe(1);
    h.sockets[0]!.message({ type: 'rematch-offered', gameId: 'jina' });
    h.sockets[0]!.message({ type: 'game-closed', gameId: 'jina' });
    expect(offered).toBe(1);
    expect(closed).toBe(1);
  });

  it('herní most: za běhu partie míří chyba z room WS do hry, ne do notice lobby', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    const link = h.onGameStart.mock.calls[0]![1];
    const gameErrors: string[] = [];
    const unsub = link.onError((m) => gameErrors.push(m));

    h.sockets[0]!.message({ type: 'error', message: 'Nelegální tah.' });
    expect(gameErrors).toEqual(['Nelegální tah.']);
    expect(hidden(h.notice)).toBe(true);

    unsub();
    h.sockets[0]!.message({ type: 'error', message: 'Výzva už neplatí.' });
    expect(gameErrors).toEqual(['Nelegální tah.']);
    expect(hidden(h.notice)).toBe(false);
    expect(h.notice.textContent).toBe('Výzva už neplatí.');
  });

  it('Odmítnout pošle reject a modal se zavře', () => {
    const h = joinedLobby();
    h.sockets[0]!.message({
      type: 'challenged',
      challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' },
    });
    h.challengeModal.querySelector<HTMLButtonElement>('.lobby-reject-btn')!.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'reject', challengeId: 'c1' })]);
    expect(hidden(h.challengeModal)).toBe(true);
  });

  it('challenge-rejected schová „čekám", odemkne tlačítka a ukáže notice', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-rejected', challengedId: '2' });
    expect(hidden(h.outgoing)).toBe(true);
    expect(hidden(h.notice)).toBe(false);
    expect(h.notice.textContent).toContain('Eva');
    for (const b of challengeBtns(h)) {
      expect(b.disabled).toBe(false);
    }
  });

  it('serverová chyba výzvy PO připojení zůstane v místnosti (notice), neotevře modal přezdívky', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    h.sockets[0]!.message({ type: 'error', message: 'Vyzvaný hráč už hraje.' });
    expect(hidden(h.room)).toBe(false);
    expect(hidden(h.nickModal)).toBe(true);
    expect(h.notice.textContent).toContain('už hraje');
    expect(hidden(h.outgoing)).toBe(true);
    for (const b of challengeBtns(h)) {
      expect(b.disabled).toBe(false);
    }
  });

  it('challenge-cancelled zavře modal příchozí výzvy (soupeř zrušil/odešel)', () => {
    const h = joinedLobby();
    h.sockets[0]!.message({
      type: 'challenged',
      challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' },
    });
    expect(hidden(h.challengeModal)).toBe(false);
    h.sockets[0]!.message({ type: 'challenge-cancelled', challengeId: 'c1' });
    expect(hidden(h.challengeModal)).toBe(true);
  });

  it('challenge-cancelled na mou odchozí ji zruší (soupeř odešel během čekání)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click();
    expect(hidden(h.outgoing)).toBe(false);
    h.sockets[0]!.message({ type: 'challenge-cancelled', challengeId: 'serverové-id' });
    expect(hidden(h.outgoing)).toBe(true);
    expect(h.notice.textContent).toContain('Eva');
  });
});

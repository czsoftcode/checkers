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

/** Lobby k úklidu po testu – jinak po nich visí connect-timer (setTimeout) z room-clientu. */
const activeLobbies: { dispose(): void }[] = [];

function mountLobby() {
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
  // Eager query jen na PERSISTENTNÍ prvky (vznikají v konstruktoru, vždy v DOM).
  // Dynamické prvky akordeonu (`.lobby-roster`, `.lobby-challenge-btn`, `.lobby-section`)
  // se dotazují líně přes `el.querySelector(All)` v jednotlivých testech (existují až
  // po vstupu / rozbalení sekce).
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
    form: q<HTMLFormElement>('.lobby-join'),
    nick: q<HTMLInputElement>('.lobby-nick'),
    room: q<HTMLElement>('.lobby-room'),
    challenges: q<HTMLUListElement>('.lobby-challenges'),
    outgoing: q<HTMLElement>('.lobby-outgoing'),
    notice: q<HTMLElement>('.lobby-notice'),
    accordion: q<HTMLElement>('.lobby-accordion'),
    nickLine: q<HTMLElement>('.lobby-nick-line'),
    disconnected: q<HTMLElement>('.lobby-disconnected'),
    reconnectBtn: q<HTMLButtonElement>('.lobby-reconnect-btn'),
    soloBtn: q<HTMLButtonElement>('.lobby-solo-btn'),
    msg: q<HTMLElement>('.lobby-msg'),
  };
}

type Handle = ReturnType<typeof mountLobby>;

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
/** Hlavička sekce dané varianty (podle názvu). */
function sectionByName(h: Handle, name: string): HTMLElement {
  const found = sections(h).find(
    (s) => s.querySelector('.lobby-section-name')?.textContent === name,
  );
  if (found === undefined) {
    throw new Error(`sekce „${name}" nenalezena`);
  }
  return found;
}

/** All-roster snímek 4 lobby: `players` mapuje variantu → seznam [id, nick]. */
function lobbiesMsg(players: Partial<Record<string, [string, string][]>>) {
  const all = ['american', 'pool', 'russian', 'czech'] as const;
  return {
    type: 'lobbies',
    lobbies: all.map((variant) => ({
      variant,
      players: (players[variant] ?? []).map(([id, nick]) => ({ id, nick })),
    })),
  };
}

/**
 * Připojí lobby do AMERICKÉ lobby a doručí roster + all-roster snímek: v americké
 * jsou Jan(=já), Eva(2), Petr(3), ostatní lobby prázdné. Moje lobby (american) je
 * po vstupu rozbalená → `.lobby-roster` ukazuje ty tři hráče s tlačítky Vyzvat.
 */
function joinedLobby(): Handle {
  const h = mountLobby();
  h.nick.value = 'Jan';
  submit(h.form);
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
  h.sockets[0]!.sent.length = 0; // zahoď join
  return h;
}

/** Odešle formulář přezdívky (submit event – handler volá preventDefault). */
function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  localStorage.clear();
  // Tyto testy ověřují CHOVÁNÍ místnosti a tvrdí na české texty. Jazyk je modulový
  // jedináček a jsdom hlásí `en-US`, takže bez připnutí by `t()` vracelo angličtinu
  // a asserty by spadly. Připni cs; jazykovou detekci ověřuje lobby-i18n.test.ts.
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

describe('createLobby', () => {
  it('má celostránkové pozadí: <img.page-bg> s nastaveným src (intro.webp)', () => {
    const h = mountLobby();
    const bg = h.el.querySelector<HTMLImageElement>('img.page-bg');
    expect(bg).not.toBeNull();
    const src = bg!.getAttribute('src') ?? '';
    expect(src.length).toBeGreaterThan(0); // ?url import → neprázdná URL
    expect(src).toContain('intro'); // je to opravdu intro.webp, ne jiný asset
    expect(src).not.toContain('mobile');
  });

  it('pozadí je <picture> a na výšku (portrait) vybírá intro_mobile.webp', () => {
    const h = mountLobby();
    const picture = h.el.querySelector('picture');
    expect(picture).not.toBeNull();
    const bg = picture!.querySelector<HTMLImageElement>('img.page-bg');
    expect(bg).not.toBeNull();

    const source = picture!.querySelector('source');
    expect(source).not.toBeNull();
    expect(source!.getAttribute('media')).toBe('(orientation: portrait)');
    const srcset = source!.getAttribute('srcset') ?? '';
    expect(srcset).toContain('intro_mobile');

    const kids = Array.from(picture!.children);
    expect(kids.indexOf(source!)).toBeLessThan(kids.indexOf(bg!));
  });

  it('start ukáže formulář a schová místnost', () => {
    const h = mountLobby();
    expect(h.form.classList.contains('hidden')).toBe(false);
    expect(h.room.classList.contains('hidden')).toBe(true);
    expect(h.disconnected.classList.contains('hidden')).toBe(true);
  });

  it('vstup → připojuji (zamčený formulář) → akordeon s mou rozbalenou lobby', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    expect(h.nick.disabled).toBe(true); // connecting
    expect(h.msg.textContent).toContain('Připojuji');
    expect(h.sockets).toHaveLength(1);

    h.sockets[0]!.open();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'join', nick: 'Jan' })]);

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
    expect(h.room.classList.contains('hidden')).toBe(false);
    expect(h.form.classList.contains('hidden')).toBe(true);
    // Nahoře přezdívka.
    expect(h.nickLine.textContent).toContain('Jan');
    // Moje lobby (american) je rozbalená → roster s 2 hráči; první = já (is-self, „Jsi tady").
    const items = rosterItems(h);
    expect(items).toHaveLength(2);
    expect(items[0]!.classList.contains('is-self')).toBe(true);
    expect(items[0]!.textContent).toContain('Jsi tady');
    expect(items[1]!.classList.contains('is-self')).toBe(false);
  });

  it('akordeon má 4 sekce (registr variant), moje lobby je označená a rozbalená', () => {
    const h = joinedLobby();
    const secs = sections(h);
    expect(secs).toHaveLength(4);
    const names = secs.map((s) => s.querySelector('.lobby-section-name')?.textContent);
    expect(names).toEqual(['Americká', 'Pool', 'Ruská', 'Česká']);
    const american = sectionByName(h, 'Americká');
    expect(american.classList.contains('is-mine')).toBe(true);
    expect(american.classList.contains('is-expanded')).toBe(true);
    expect(american.querySelector('.lobby-section-header')!.getAttribute('aria-expanded')).toBe('true');
    // Počet hráčů v hlavičce.
    expect(american.querySelector('.lobby-section-count')!.textContent).toBe('3');
  });

  it('all-roster snímek aktualizuje obsazení živě (bez re-joinu)', () => {
    const h = joinedLobby();
    expect(rosterItems(h)).toHaveLength(3);
    // Nový snímek: Petr odešel z americké.
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

  it('cizí lobby: rozbalím sekci → roster jen ke čtení + tlačítko Vstoupit, žádné Vyzvat', () => {
    const h = joinedLobby();
    // Do ruské lobby přidej hráče (přes snímek), ať je co zobrazit.
    h.sockets[0]!.message(
      lobbiesMsg({
        american: [['1', 'Jan']],
        russian: [['9', 'Olga']],
      }),
    );
    const russian = sectionByName(h, 'Ruská');
    // Zpočátku sbalená (moje lobby je american).
    expect(russian.classList.contains('is-expanded')).toBe(false);
    russian.querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    const russianOpen = sectionByName(h, 'Ruská');
    expect(russianOpen.classList.contains('is-expanded')).toBe(true);
    // Roster Olgy je vidět, ale bez tlačítka Vyzvat (cizí lobby = jen čtení).
    const items = Array.from(russianOpen.querySelectorAll('.lobby-roster-item'));
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('Olga');
    expect(russianOpen.querySelector('.lobby-challenge-btn')).toBeNull();
    // A je tam tlačítko Vstoupit.
    expect(russianOpen.querySelector('.lobby-enter-btn')).not.toBeNull();
  });

  it('klik na Vstoupit pošle switch-lobby{variant}', () => {
    const h = joinedLobby();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'switch-lobby', variant: 'russian' })]);
  });

  it('po switch (nový snímek s mnou v ruské) se moje lobby přesune a nabídne Vyzvat', () => {
    const h = joinedLobby();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    // Server přesune členství a pošle nový snímek: Jan je teď v ruské (s Olgou).
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
    // V mé (teď ruské) lobby má Olga tlačítko Vyzvat.
    const olga = Array.from(russian.querySelectorAll<HTMLElement>('.lobby-roster-item')).find((li) =>
      li.textContent?.includes('Olga'),
    )!;
    expect(olga.querySelector('.lobby-challenge-btn')).not.toBeNull();
    // Americká už není moje.
    expect(sectionByName(h, 'Americká').classList.contains('is-mine')).toBe(false);
  });

  it('klik na hlavičku moje lobby ji sbalí (toggle)', () => {
    const h = joinedLobby();
    expect(sectionByName(h, 'Americká').classList.contains('is-expanded')).toBe(true);
    sectionByName(h, 'Americká').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    expect(sectionByName(h, 'Americká').classList.contains('is-expanded')).toBe(false);
    expect(rosterItems(h)).toHaveLength(0); // sbaleno → žádné položky
  });

  it('prázdná cizí lobby po rozbalení hlásí „zatím tu nikdo není"', () => {
    const h = joinedLobby();
    const pool = sectionByName(h, 'Pool');
    pool.querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    expect(sectionByName(h, 'Pool').querySelector('.lobby-empty')!.textContent).toContain('nikdo');
  });

  it('vědomé sbalení mé sekce přežije další snímek prezence (nerozbalí se zpět)', () => {
    const h = joinedLobby();
    // Sbal moji (americkou) sekci klikem na hlavičku.
    sectionByName(h, 'Americká').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    expect(sectionByName(h, 'Americká').classList.contains('is-expanded')).toBe(false);
    // Přijde další snímek (Olga se přidala do ruské) – moje sekce ZŮSTANE sbalená.
    // Zub: bez `hasAutoExpanded` by ji auto-expand znovu otevřel při každém snímku.
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

  it('odmítnutí switch-lobby (závod s přijetím výzvy) NEpropadne na herní obrazovku', () => {
    const h = joinedLobby();
    // Rozbal ruskou a klikni Vstoupit → odejde switch-lobby (pendingSwitch=true).
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    expect(h.sockets[0]!.sent).toContain(JSON.stringify({ type: 'switch-lobby', variant: 'russian' }));
    // Souběžně soupeř přijal MOU výzvu → vznikla partie, přejdu do hry (registruje onError).
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    const link = h.onGameStart.mock.calls[0]![1];
    const gameErrors: string[] = [];
    link.onError((m) => gameErrors.push(m));
    // Teprve teď server odmítne switch-lobby (jsem busy). NESMÍ dorazit do hry.
    h.sockets[0]!.message({ type: 'error', message: 'Nelze přejít do jiné lobby během partie.' });
    expect(gameErrors).toEqual([]);
  });

  it('odmítnutí switch-lobby mimo partii jde do notice, zůstávám v místnosti', () => {
    const h = joinedLobby();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-section-header')!.click();
    sectionByName(h, 'Ruská').querySelector<HTMLButtonElement>('.lobby-enter-btn')!.click();
    h.sockets[0]!.message({ type: 'error', message: 'Neznámá varianta lobby.' });
    expect(h.notice.textContent).toContain('Neznámá varianta');
    expect(h.room.classList.contains('hidden')).toBe(false);
    expect(h.form.classList.contains('hidden')).toBe(true);
  });

  it('prázdná přezdívka se neodešle (klientská pojistka)', () => {
    const h = mountLobby();
    h.nick.value = '   ';
    submit(h.form);
    expect(h.sockets).toHaveLength(0);
    expect(h.msg.textContent).toContain('Zadej přezdívku');
  });

  it('join se posílá BEZ varianty (počáteční lobby = server default american)', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    h.sockets[0]!.open();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'join', nick: 'Jan' })]);
  });

  it('obsazená přezdívka vrátí formulář s návrhem předvyplněným v poli', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'nick-taken', suggestion: 'Jan2' });
    expect(h.form.classList.contains('hidden')).toBe(false);
    expect(h.nick.disabled).toBe(false);
    expect(h.nick.value).toBe('Jan2');
    expect(h.msg.textContent).toContain('Jan2');
  });

  it('odpojení ukáže „Připojit znovu"; klik znovu připojí novým socketem', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'roster', variant: 'american', players: [{ id: '1', nick: 'Jan' }] });
    h.sockets[0]!.fireClose();
    expect(h.disconnected.classList.contains('hidden')).toBe(false);
    expect(h.room.classList.contains('hidden')).toBe(true);

    h.reconnectBtn.click();
    expect(h.sockets).toHaveLength(2); // zavřený socket → nové spojení
    h.sockets[1]!.open();
    expect(h.sockets[1]!.sent).toEqual([JSON.stringify({ type: 'join', nick: 'Jan' })]);
  });

  it('pád spojení PŘED vstupem hlásí „nepodařilo se připojit" (ne „přerušilo")', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    h.sockets[0]!.open();
    h.sockets[0]!.fireClose(); // spadlo dřív, než dorazil roster
    expect(h.disconnected.classList.contains('hidden')).toBe(false);
    expect(h.disconnected.textContent).toContain('nepodařilo připojit');
  });

  it('pád spojení PO vstupu hlásí „přerušilo"', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'roster', variant: 'american', players: [{ id: '1', nick: 'Jan' }] });
    h.sockets[0]!.fireClose();
    expect(h.disconnected.textContent).toContain('přerušilo');
  });

  it('„Hrát proti počítači" zavolá callback', () => {
    const h = mountLobby();
    h.soloBtn.click();
    expect(h.onPlayVsComputer).toHaveBeenCalledTimes(1);
  });

  it('přezdívka se uloží a příště předvyplní', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    h.lobby.dispose();
    document.body.replaceChildren();
    const h2 = mountLobby();
    expect(h2.nick.value).toBe('Jan');
  });

  it('dispose zavře socket místnosti', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    h.lobby.dispose();
    expect(h.sockets[0]!.closed).toBe(true);
  });
});

describe('createLobby – přepínač jazyka (fáze 84)', () => {
  it('vykreslí <select> s možnostmi z LOCALES a předvybere aktivní jazyk', () => {
    const h = mountLobby();
    const options = Array.from(h.lang.options);
    expect(options.map((o) => o.value)).toEqual(['cs', 'en']);
    expect(options.map((o) => o.textContent)).toEqual(['Čeština', 'English']);
    expect(h.lang.value).toBe(getLocale());
    expect(h.lang.value).toBe('cs');
    expect(h.lang.classList.contains('hidden')).toBe(false);
  });

  it('změna jazyka uloží volbu do LocalStorage a vyžádá překreslení', () => {
    const h = mountLobby();
    h.lang.value = 'en';
    h.lang.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('checkers.locale')).toBe('en');
    expect(h.onLocaleChange).toHaveBeenCalledTimes(1);
    expect(getLocale()).toBe('en');
  });

  it('přepnutí jazyka uchová i rozepsanou (neodeslanou) přezdívku', () => {
    const h = mountLobby();
    h.nick.value = 'Rozepsany';
    h.lang.value = 'en';
    h.lang.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem('checkers.roomNick')).toBe('Rozepsany');
  });

  it('výběr stejného jazyka nepřekresluje ani nezapisuje (žádná zbytečná práce)', () => {
    const h = mountLobby();
    h.lang.value = 'cs';
    h.lang.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.onLocaleChange).not.toHaveBeenCalled();
    expect(localStorage.getItem('checkers.locale')).toBeNull();
  });

  it('mimo entry (po vstupu do místnosti) je přepínač skrytý – rebuild by zabil WS', () => {
    const h = joinedLobby();
    expect(h.room.classList.contains('hidden')).toBe(false);
    expect(h.lang.classList.contains('hidden')).toBe(true);
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
    const evaBtn = challengeBtns(h)[0]!;
    evaBtn.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'challenge', targetId: '2' })]);
    expect(h.outgoing.classList.contains('hidden')).toBe(false);
    expect(h.outgoing.textContent).toContain('Eva');
    for (const b of challengeBtns(h)) {
      expect(b.disabled).toBe(true);
    }
  });

  it('příchozí výzva ukáže banner; Přijmout pošle accept a challenge-accepted spustí přechod', () => {
    const h = joinedLobby();
    h.sockets[0]!.message({
      type: 'challenged',
      challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' },
    });
    const banner = h.challenges.querySelectorAll('.lobby-challenge-item');
    expect(banner).toHaveLength(1);
    expect(banner[0]!.textContent).toContain('Eva');

    banner[0]!.querySelector<HTMLButtonElement>('.lobby-accept-btn')!.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'accept', challengeId: 'c1' })]);

    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g1', color: 'white', opponentId: '2' });
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
    challengeBtns(h)[0]!.click(); // vyzvi Evu (odchozí)
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    h.sockets[0]!.sent.length = 0; // zahoď challenge
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

  it('herní most: rematch-offered/rematch-declined pro TUTO partii spustí handlery (fáze 77)', () => {
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
    expect(h.notice.classList.contains('hidden')).toBe(true);

    unsub();
    h.sockets[0]!.message({ type: 'error', message: 'Výzva už neplatí.' });
    expect(gameErrors).toEqual(['Nelegální tah.']);
    expect(h.notice.classList.contains('hidden')).toBe(false);
    expect(h.notice.textContent).toBe('Výzva už neplatí.');
  });

  it('Odmítnout pošle reject a banner zmizí', () => {
    const h = joinedLobby();
    h.sockets[0]!.message({
      type: 'challenged',
      challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' },
    });
    h.challenges.querySelector<HTMLButtonElement>('.lobby-reject-btn')!.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'reject', challengeId: 'c1' })]);
    expect(h.challenges.querySelectorAll('.lobby-challenge-item')).toHaveLength(0);
  });

  it('challenge-rejected schová „čekám", odemkne tlačítka a ukáže notice', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click(); // vyzvi Evu
    h.sockets[0]!.message({ type: 'challenge-rejected', challengedId: '2' });
    expect(h.outgoing.classList.contains('hidden')).toBe(true);
    expect(h.notice.classList.contains('hidden')).toBe(false);
    expect(h.notice.textContent).toContain('Eva');
    for (const b of challengeBtns(h)) {
      expect(b.disabled).toBe(false);
    }
  });

  it('serverová chyba výzvy PO vstupu zůstane v místnosti (notice), nevyhodí na formulář', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click(); // vyzvi Evu (busy)
    h.sockets[0]!.message({ type: 'error', message: 'Vyzvaný hráč už hraje.' });
    expect(h.room.classList.contains('hidden')).toBe(false);
    expect(h.form.classList.contains('hidden')).toBe(true);
    expect(h.notice.textContent).toContain('už hraje');
    expect(h.outgoing.classList.contains('hidden')).toBe(true);
    for (const b of challengeBtns(h)) {
      expect(b.disabled).toBe(false);
    }
  });

  it('serverová chyba PŘED vstupem pořád míří na formulář nicku', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form); // connecting
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'error', message: 'Přezdívka je moc dlouhá.' });
    expect(h.form.classList.contains('hidden')).toBe(false);
    expect(h.msg.textContent).toContain('moc dlouhá');
  });

  it('challenge-cancelled odebere příchozí banner (soupeř zrušil/odešel)', () => {
    const h = joinedLobby();
    h.sockets[0]!.message({
      type: 'challenged',
      challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' },
    });
    expect(h.challenges.querySelectorAll('.lobby-challenge-item')).toHaveLength(1);
    h.sockets[0]!.message({ type: 'challenge-cancelled', challengeId: 'c1' });
    expect(h.challenges.querySelectorAll('.lobby-challenge-item')).toHaveLength(0);
  });

  it('challenge-cancelled na mou odchozí ji zruší (soupeř odešel během čekání)', () => {
    const h = joinedLobby();
    challengeBtns(h)[0]!.click(); // vyzvi Evu
    expect(h.outgoing.classList.contains('hidden')).toBe(false);
    h.sockets[0]!.message({ type: 'challenge-cancelled', challengeId: 'serverové-id' });
    expect(h.outgoing.classList.contains('hidden')).toBe(true);
    expect(h.notice.textContent).toContain('Eva');
  });
});

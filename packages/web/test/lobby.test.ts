// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const lobby = createLobby({
    onPlayVsComputer,
    onGameStart,
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
    lobby,
    el,
    form: q<HTMLFormElement>('.lobby-join'),
    nick: q<HTMLInputElement>('.lobby-nick'),
    room: q<HTMLElement>('.lobby-room'),
    roster: q<HTMLUListElement>('.lobby-roster'),
    challenges: q<HTMLUListElement>('.lobby-challenges'),
    outgoing: q<HTMLElement>('.lobby-outgoing'),
    notice: q<HTMLElement>('.lobby-notice'),
    disconnected: q<HTMLElement>('.lobby-disconnected'),
    reconnectBtn: q<HTMLButtonElement>('.lobby-reconnect-btn'),
    soloBtn: q<HTMLButtonElement>('.lobby-solo-btn'),
    msg: q<HTMLElement>('.lobby-msg'),
  };
}

/** Připojí lobby a doručí roster (Jan=já, Eva=2, Petr=3). Vrátí handle + socket. */
function joinedLobby() {
  const h = mountLobby();
  h.nick.value = 'Jan';
  submit(h.form);
  h.sockets[0]!.open();
  h.sockets[0]!.message({
    type: 'roster',
    players: [
      { id: '1', nick: 'Jan' },
      { id: '2', nick: 'Eva' },
      { id: '3', nick: 'Petr' },
    ],
  });
  h.sockets[0]!.sent.length = 0; // zahoď join
  return h;
}

/** Odešle formulář přezdívky (submit event – handler volá preventDefault). */
function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  localStorage.clear();
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
  it('start ukáže formulář a schová místnost', () => {
    const h = mountLobby();
    expect(h.form.classList.contains('hidden')).toBe(false);
    expect(h.room.classList.contains('hidden')).toBe(true);
    expect(h.disconnected.classList.contains('hidden')).toBe(true);
  });

  it('vstup → připojuji (zamčený formulář) → roster se zvýrazněným „ty"', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    expect(h.nick.disabled).toBe(true); // connecting
    expect(h.msg.textContent).toContain('Připojuji');
    expect(h.sockets).toHaveLength(1);

    h.sockets[0]!.open();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'join', nick: 'Jan' })]);

    h.sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }, { id: '2', nick: 'Eva' }] });
    expect(h.room.classList.contains('hidden')).toBe(false);
    expect(h.form.classList.contains('hidden')).toBe(true);
    const items = h.roster.querySelectorAll('.lobby-roster-item');
    expect(items).toHaveLength(2);
    expect(items[0]!.classList.contains('is-self')).toBe(true);
    expect(items[0]!.textContent).toContain('(ty)');
    expect(items[1]!.classList.contains('is-self')).toBe(false);
  });

  it('joined/left aktualizují seznam živě', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form);
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
    h.sockets[0]!.message({ type: 'joined', player: { id: '2', nick: 'Eva' } });
    expect(h.roster.querySelectorAll('.lobby-roster-item')).toHaveLength(2);
    h.sockets[0]!.message({ type: 'left', player: { id: '2' } });
    expect(h.roster.querySelectorAll('.lobby-roster-item')).toHaveLength(1);
  });

  it('prázdná přezdívka se neodešle (klientská pojistka)', () => {
    const h = mountLobby();
    h.nick.value = '   ';
    submit(h.form);
    expect(h.sockets).toHaveLength(0);
    expect(h.msg.textContent).toContain('Zadej přezdívku');
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
    h.sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
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
    h.sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
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

describe('createLobby – výzvy', () => {
  it('roster: vlastní záznam bez tlačítka, cizí s „Vyzvat"', () => {
    const h = joinedLobby();
    const items = h.roster.querySelectorAll('.lobby-roster-item');
    expect(items).toHaveLength(3);
    expect(items[0]!.querySelector('.lobby-challenge-btn')).toBeNull(); // Jan = já
    expect(items[1]!.querySelector('.lobby-challenge-btn')).not.toBeNull(); // Eva
    expect(items[2]!.querySelector('.lobby-challenge-btn')).not.toBeNull(); // Petr
  });

  it('klik na Vyzvat pošle challenge, ukáže „čekám" a zamkne další tlačítka', () => {
    const h = joinedLobby();
    const evaBtn = h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn')[0]!;
    evaBtn.click();
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'challenge', targetId: '2' })]);
    expect(h.outgoing.classList.contains('hidden')).toBe(false);
    expect(h.outgoing.textContent).toContain('Eva');
    // ostatní „Vyzvat" zamčené (max-1 odchozí)
    const btns = h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn');
    for (const b of btns) {
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
    // Druhý argument je herní most (GameLink) – tvar ověřují testy mostu níž.
    expect(h.onGameStart.mock.calls[0]![0]).toEqual({ gameId: 'g1', color: 'white', opponentNick: 'Eva' });
    const link = h.onGameStart.mock.calls[0]![1];
    expect(typeof link.move).toBe('function');
    expect(typeof link.onError).toBe('function');
  });

  it('herní most: link.move pošle {type:move, gameId, from, path} po room WS', () => {
    const h = joinedLobby();
    h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn')[0]!.click(); // vyzvi Evu (odchozí)
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    h.sockets[0]!.sent.length = 0; // zahoď challenge
    const link = h.onGameStart.mock.calls[0]![1];
    const ok = link.move(9, [13, 22]);
    expect(ok).toBe(true);
    expect(h.sockets[0]!.sent).toEqual([JSON.stringify({ type: 'move', gameId: 'g7', from: 9, path: [13, 22] })]);
  });

  it('herní most: za běhu partie míří chyba z room WS do hry, ne do notice lobby', () => {
    const h = joinedLobby();
    h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn')[0]!.click();
    h.sockets[0]!.message({ type: 'challenge-accepted', gameId: 'g7', color: 'black', opponentId: '2' });
    const link = h.onGameStart.mock.calls[0]![1];
    const gameErrors: string[] = [];
    const unsub = link.onError((m) => gameErrors.push(m));

    h.sockets[0]!.message({ type: 'error', message: 'Nelegální tah.' });
    expect(gameErrors).toEqual(['Nelegální tah.']); // dorazilo do hry
    expect(h.notice.classList.contains('hidden')).toBe(true); // lobby notice se nedotklo

    // Po odregistraci (návrat do místnosti) se chyba zas chová jako lobby notice.
    unsub();
    h.sockets[0]!.message({ type: 'error', message: 'Výzva už neplatí.' });
    expect(gameErrors).toEqual(['Nelegální tah.']); // do hry už nic nepřišlo
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
    h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn')[0]!.click(); // vyzvi Evu
    h.sockets[0]!.message({ type: 'challenge-rejected', challengedId: '2' });
    expect(h.outgoing.classList.contains('hidden')).toBe(true);
    expect(h.notice.classList.contains('hidden')).toBe(false);
    expect(h.notice.textContent).toContain('Eva');
    const btns = h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn');
    for (const b of btns) {
      expect(b.disabled).toBe(false);
    }
  });

  it('serverová chyba výzvy PO vstupu zůstane v místnosti (notice), nevyhodí na formulář', () => {
    const h = joinedLobby();
    h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn')[0]!.click(); // vyzvi Evu (busy)
    h.sockets[0]!.message({ type: 'error', message: 'Vyzvaný hráč už hraje.' });
    // zůstávám v místnosti; formulář nicku se NEukáže
    expect(h.room.classList.contains('hidden')).toBe(false);
    expect(h.form.classList.contains('hidden')).toBe(true);
    expect(h.notice.textContent).toContain('už hraje');
    // odchozí uvolněná a tlačítka zas aktivní (nezaseklo se na max-1)
    expect(h.outgoing.classList.contains('hidden')).toBe(true);
    const btns = h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn');
    for (const b of btns) {
      expect(b.disabled).toBe(false);
    }
  });

  it('serverová chyba PŘED vstupem pořád míří na formulář nicku', () => {
    const h = mountLobby();
    h.nick.value = 'Jan';
    submit(h.form); // connecting
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'error', message: 'Přezdívka je moc dlouhá.' });
    expect(h.form.classList.contains('hidden')).toBe(false); // formulář zpět
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
    h.roster.querySelectorAll<HTMLButtonElement>('.lobby-challenge-btn')[0]!.click(); // vyzvi Evu
    expect(h.outgoing.classList.contains('hidden')).toBe(false);
    h.sockets[0]!.message({ type: 'challenge-cancelled', challengeId: 'serverové-id' });
    expect(h.outgoing.classList.contains('hidden')).toBe(true);
    expect(h.notice.textContent).toContain('Eva');
  });
});

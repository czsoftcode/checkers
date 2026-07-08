// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLobby } from '../src/lobby.js';
import type { RoomWebSocket } from '../src/room-client.js';

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
  const lobby = createLobby({
    onPlayVsComputer,
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
    lobby,
    el,
    form: q<HTMLFormElement>('.lobby-join'),
    nick: q<HTMLInputElement>('.lobby-nick'),
    room: q<HTMLElement>('.lobby-room'),
    roster: q<HTMLUListElement>('.lobby-roster'),
    disconnected: q<HTMLElement>('.lobby-disconnected'),
    reconnectBtn: q<HTMLButtonElement>('.lobby-reconnect-btn'),
    soloBtn: q<HTMLButtonElement>('.lobby-solo-btn'),
    msg: q<HTMLElement>('.lobby-msg'),
  };
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

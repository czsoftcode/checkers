import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRoomClient } from '../src/room-client.js';
import type { RoomClient, RoomWebSocket, RosterEntry } from '../src/room-client.js';

/**
 * Ovladatelný fake WebSocketu: testy ručně spouští `open`/`message`/`error`/`close`
 * a čtou, co klient poslal (`sent`). Nahrazuje reálné spojení – klient místnosti
 * jde tak ověřit bez sítě i bez jsdom (běží v node prostředí).
 */
class FakeSocket implements RoomWebSocket {
  readyState = 0; // CONNECTING
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
    this.readyState = 3; // CLOSED
  }

  // --- testovací spouštěče drátových událostí ---
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  message(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }
  fireError(): void {
    this.onerror?.();
  }
  fireClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

/** Klienti k úklidu po testu – jinak by po nich zůstal viset connect-timer (setTimeout). */
const activeClients: RoomClient[] = [];
afterEach(() => {
  for (const c of activeClients) {
    c.dispose();
  }
  activeClients.length = 0;
  vi.useRealTimers();
});

/** Postaví klienta s fake továrnou a posbírá všechny callbacky pro asserty. */
function harness(options: { connectTimeoutMs?: number } = {}) {
  const sockets: FakeSocket[] = [];
  const events = {
    joined: [] as RosterEntry[][],
    roster: [] as RosterEntry[][],
    nickTaken: [] as string[],
    error: [] as string[],
    disconnected: 0,
  };
  const client = createRoomClient(
    {
      onJoined: (r) => events.joined.push(r),
      onRoster: (r) => events.roster.push(r),
      onNickTaken: (s) => events.nickTaken.push(s),
      onError: (m) => events.error.push(m),
      onDisconnected: () => {
        events.disconnected += 1;
      },
    },
    {
      url: 'ws://test/room/ws',
      ...(options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }),
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    },
  );
  activeClients.push(client);
  return { sockets, events, client };
}

describe('createRoomClient', () => {
  it('join otevře socket a pošle join{nick} PRÁVĚ JEDNOU až na open', () => {
    const { sockets, client } = harness();
    client.join('Jan');
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent).toEqual([]); // před open se nic neposílá
    sockets[0]!.open();
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: 'join', nick: 'Jan' })]);
  });

  it('roster → onJoined s rosterem a označením sebe (podle přezdívky)', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }, { id: '2', nick: 'Eva' }] });
    expect(events.joined).toHaveLength(1);
    expect(events.joined[0]).toEqual([
      { id: '1', nick: 'Jan', isSelf: true },
      { id: '2', nick: 'Eva', isSelf: false },
    ]);
  });

  it('self se pozná i po trimnutí a nezávisle na velikosti písmen', () => {
    const { sockets, events, client } = harness();
    client.join('  Jan  ');
    sockets[0]!.open();
    // server drží trimnutou přezdívku; případný rozdíl velikosti písmen nesmí self rozhodit
    sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'jan' }] });
    expect(events.joined[0]![0]!.isSelf).toBe(true);
  });

  it('joined přidá a left odebere hráče podle id (onRoster)', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
    sockets[0]!.message({ type: 'joined', player: { id: '2', nick: 'Eva' } });
    expect(events.roster.at(-1)!.map((e) => e.nick)).toEqual(['Jan', 'Eva']);
    sockets[0]!.message({ type: 'left', player: { id: '1' } });
    expect(events.roster.at(-1)!.map((e) => e.nick)).toEqual(['Eva']);
  });

  it('nick-taken drží socket a opakovaný join jde po TÉMŽE socketu (žádný nový)', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'nick-taken', suggestion: 'Jan2' });
    expect(events.nickTaken).toEqual(['Jan2']);
    client.join('Jan2');
    expect(sockets).toHaveLength(1); // stejný socket, žádné nové spojení
    expect(sockets[0]!.sent).toEqual([
      JSON.stringify({ type: 'join', nick: 'Jan' }),
      JSON.stringify({ type: 'join', nick: 'Jan2' }),
    ]);
  });

  it('po úspěšném joinu se další join IGNORUJE (server by odmítl „Už jsi v místnosti")', () => {
    const { sockets, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
    const sentBefore = sockets[0]!.sent.length;
    client.join('Kdokoliv');
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent).toHaveLength(sentBefore); // nic dalšího neposláno
  });

  it('nevalidní JSON i neznámý typ se tiše ignorují (nespadne, žádný callback)', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message('tohle není JSON {{{');
    sockets[0]!.message({ type: 'challenged', challenge: { id: 'x' } }); // zpráva výzev (další fáze)
    sockets[0]!.message({ noType: true });
    expect(events.joined).toHaveLength(0);
    expect(events.roster).toHaveLength(0);
    expect(events.error).toHaveLength(0);
  });

  it('roster s pokaženým tvarem hráče se odmítne (žádný onJoined)', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'roster', players: [{ id: 1, nick: 'Jan' }] }); // id není string
    expect(events.joined).toHaveLength(0);
  });

  it('error zprávu předá do onError a socket drží (join lze zopakovat)', () => {
    const { sockets, events, client } = harness();
    client.join('');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'error', message: 'Přezdívka nesmí být prázdná.' });
    expect(events.error).toEqual(['Přezdívka nesmí být prázdná.']);
    client.join('Jan');
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent.at(-1)).toBe(JSON.stringify({ type: 'join', nick: 'Jan' }));
  });

  it('error i close spojení hlásí odpojení PRÁVĚ JEDNOU (dedup)', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.fireError();
    sockets[0]!.fireClose();
    expect(events.disconnected).toBe(1);
  });

  it('po odpojení otevře join čerstvý socket a zkusí znovu', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.fireClose();
    expect(events.disconnected).toBe(1);
    client.join('Jan');
    expect(sockets).toHaveLength(2); // zavřený socket → nové spojení
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([JSON.stringify({ type: 'join', nick: 'Jan' })]);
  });

  it('dispose zavře socket a umlčí onDisconnected i další join', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
    client.dispose();
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.fireClose(); // i kdyby socket dodatečně křikl, po dispose se nic nehlásí
    expect(events.disconnected).toBe(0);
    client.join('Jan'); // po dispose no-op
    expect(sockets).toHaveLength(1);
  });

  it('po dispose se pozdní zpráva nezpracuje (handlery vynulované, ne jen guard)', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open();
    client.dispose();
    // Kdyby teardown handlery nevynuloval, tahle zpráva by projela do onJoined.
    sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
    expect(events.joined).toHaveLength(0);
    expect(sockets[0]!.onmessage).toBeNull();
  });

  it('bez odpovědi serveru do limitu spojení shodí a ohlásí odpojení (timeout)', () => {
    vi.useFakeTimers();
    const { sockets, events, client } = harness({ connectTimeoutMs: 5000 });
    client.join('Jan');
    sockets[0]!.open(); // join odešlán, běží limit; server ale mlčí
    expect(events.disconnected).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(events.disconnected).toBe(1);
    expect(sockets[0]!.closed).toBe(true);
    // po timeoutu jde otevřít čerstvé spojení
    client.join('Jan');
    expect(sockets).toHaveLength(2);
  });

  it('tvarově vadný roster nechá limit vypršet (tichý drop nezasekne UI)', () => {
    vi.useFakeTimers();
    const { sockets, events, client } = harness({ connectTimeoutMs: 5000 });
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'roster', players: [{ id: 1, nick: 'Jan' }] }); // vadný → zahozen
    expect(events.joined).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(events.disconnected).toBe(1); // limit dojel → odpojení, ne věčné „Připojuji…"
  });

  it('platná odpověď serveru limit zruší (žádné falešné odpojení)', () => {
    vi.useFakeTimers();
    const { sockets, events, client } = harness({ connectTimeoutMs: 5000 });
    client.join('Jan');
    sockets[0]!.open();
    sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
    vi.advanceTimersByTime(20000);
    expect(events.disconnected).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRoomClient } from '../src/room-client.js';
import type {
  ChallengeAcceptedInfo,
  IncomingChallenge,
  OutgoingChallenge,
  RoomClient,
  RoomWebSocket,
  RosterEntry,
} from '../src/room-client.js';

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
    incoming: [] as IncomingChallenge[][],
    outgoing: [] as (OutgoingChallenge | null)[],
    accepted: [] as ChallengeAcceptedInfo[],
    notice: [] as string[],
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
      onIncomingChallenges: (c) => events.incoming.push(c),
      onOutgoingChallenge: (p) => events.outgoing.push(p),
      onChallengeAccepted: (i) => events.accepted.push(i),
      onNotice: (m) => events.notice.push(m),
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

describe('createRoomClient – výzvy', () => {
  /** Připojený klient s rosterem (Jan=já, Eva=2, Petr=3) – výchozí stav pro testy výzev. */
  function joined() {
    const h = harness();
    h.client.join('Jan');
    h.sockets[0]!.open();
    h.sockets[0]!.message({
      type: 'roster',
      players: [
        { id: '1', nick: 'Jan' },
        { id: '2', nick: 'Eva' },
        { id: '3', nick: 'Petr' },
      ],
    });
    const sock = h.sockets[0]!;
    sock.sent.length = 0; // zahoď join, ať asserty vidí jen zprávy výzev
    return { ...h, sock };
  }

  it('challenge pošle {type:challenge, targetId} a ohlásí odchozí; druhá výzva je no-op (max-1)', () => {
    const { sock, events, client } = joined();
    client.challenge('2');
    expect(sock.sent).toEqual([JSON.stringify({ type: 'challenge', targetId: '2' })]);
    expect(events.outgoing.at(-1)).toEqual({ targetId: '2', targetNick: 'Eva' });
    // dokud čeká odchozí, další výzva se neodešle
    client.challenge('3');
    expect(sock.sent).toHaveLength(1);
  });

  it('challenge před vstupem do místnosti je no-op', () => {
    const { sockets, events, client } = harness();
    client.join('Jan');
    sockets[0]!.open(); // otevřeno, ale roster ještě nedorazil → nejsem „joined"
    client.challenge('2');
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: 'join', nick: 'Jan' })]);
    expect(events.outgoing).toHaveLength(0);
  });

  it('challenged naplní seznam příchozích (podle id)', () => {
    const { sock, events } = joined();
    sock.message({ type: 'challenged', challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' } });
    expect(events.incoming.at(-1)).toEqual([{ id: 'c1', challengerId: '2', challengerNick: 'Eva' }]);
    sock.message({ type: 'challenged', challenge: { id: 'c2', challengerId: '3', challengerNick: 'Petr' } });
    expect(events.incoming.at(-1)!.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('challenged s vadným tvarem se zahodí (žádný callback)', () => {
    const { sock, events } = joined();
    sock.message({ type: 'challenged', challenge: { id: 'c1' } }); // chybí challengerId/Nick
    sock.message({ type: 'challenged' }); // chybí challenge
    expect(events.incoming).toHaveLength(0);
  });

  it('accept pošle {type:accept, challengeId} jen pro známou příchozí', () => {
    const { sock, client } = joined();
    sock.message({ type: 'challenged', challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' } });
    client.accept('neznámá'); // není v příchozích → nic
    client.accept('c1');
    expect(sock.sent).toEqual([JSON.stringify({ type: 'accept', challengeId: 'c1' })]);
  });

  it('reject pošle {type:reject} a odebere příchozí lokálně (server vyzvanému nic neposílá)', () => {
    const { sock, events, client } = joined();
    sock.message({ type: 'challenged', challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' } });
    client.reject('c1');
    expect(sock.sent).toEqual([JSON.stringify({ type: 'reject', challengeId: 'c1' })]);
    expect(events.incoming.at(-1)).toEqual([]); // hned pryč
  });

  it('challenge-accepted spustí přechod se správnou barvou+gameId a nickem z rosteru; vyčistí stav', () => {
    const { sock, events, client } = joined();
    client.challenge('2'); // mám odchozí
    sock.message({ type: 'challenged', challenge: { id: 'c9', challengerId: '3', challengerNick: 'Petr' } });
    sock.message({ type: 'challenge-accepted', gameId: 'g1', color: 'black', opponentId: '2' });
    expect(events.accepted.at(-1)).toEqual({ gameId: 'g1', color: 'black', opponentNick: 'Eva' });
    // odchod do hry → odchozí i příchozí vyčištěny
    expect(events.outgoing.at(-1)).toBeNull();
    expect(events.incoming.at(-1)).toEqual([]);
  });

  it('challenge-accepted s neznámým opponentId dá nick fallback „soupeř"', () => {
    const { sock, events } = joined();
    sock.message({ type: 'challenge-accepted', gameId: 'g1', color: 'white', opponentId: 'x' });
    expect(events.accepted.at(-1)).toEqual({ gameId: 'g1', color: 'white', opponentNick: 'soupeř' });
  });

  it('challenge-accepted s vadným tvarem se zahodí (žádný přechod)', () => {
    const { sock, events } = joined();
    sock.message({ type: 'challenge-accepted', gameId: 'g1', color: 'zelená', opponentId: '2' }); // špatná barva
    sock.message({ type: 'challenge-accepted', color: 'black', opponentId: '2' }); // chybí gameId
    expect(events.accepted).toHaveLength(0);
  });

  it('challenge-rejected vyčistí odchozí a dá neutrální notice', () => {
    const { sock, events, client } = joined();
    client.challenge('2');
    sock.message({ type: 'challenge-rejected', challengedId: '2' });
    expect(events.outgoing.at(-1)).toBeNull();
    expect(events.notice.at(-1)).toContain('Eva');
    // odchozí je pryč → nová výzva zas projde
    client.challenge('3');
    expect(events.outgoing.at(-1)).toEqual({ targetId: '3', targetNick: 'Petr' });
  });

  it('challenge-cancelled na příchozí ji odebere; na odchozí (soupeř odešel) ji zruší', () => {
    const { sock, events, client } = joined();
    // příchozí varianta: znám id z `challenged`
    sock.message({ type: 'challenged', challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' } });
    sock.message({ type: 'challenge-cancelled', challengeId: 'c1' });
    expect(events.incoming.at(-1)).toEqual([]);
    // odchozí varianta: id výzvy neznám, ale max-1 → zruší se
    client.challenge('3');
    sock.message({ type: 'challenge-cancelled', challengeId: 'neznámé-serverové-id' });
    expect(events.outgoing.at(-1)).toBeNull();
    expect(events.notice.at(-1)).toContain('Petr');
  });

  it('víc příchozích: přijetí jedné vyčistí celý seznam (přechod do hry)', () => {
    const { sock, events, client } = joined();
    sock.message({ type: 'challenged', challenge: { id: 'c1', challengerId: '2', challengerNick: 'Eva' } });
    sock.message({ type: 'challenged', challenge: { id: 'c2', challengerId: '3', challengerNick: 'Petr' } });
    expect(events.incoming.at(-1)!.map((c) => c.id)).toEqual(['c1', 'c2']);
    client.accept('c1');
    // Server přijetí potvrdí `challenge-accepted` (mně, jsem vyzvaný c1). Vedlejší c2
    // server ruší, ale cancelled posílá Petrovi (protějšku), ne mně → MŮJ seznam čistí
    // až challenge-accepted (incoming.clear()). Ověř, že po přechodu nezbyla c2.
    sock.message({ type: 'challenge-accepted', gameId: 'g1', color: 'white', opponentId: '2' });
    expect(events.incoming.at(-1)).toEqual([]);
    expect(events.accepted.at(-1)!.opponentNick).toBe('Eva');
  });

  it('error po odeslané výzvě uvolní odchozí (jinak by max-1 zamkl další výzvy)', () => {
    const { sock, events, client } = joined();
    client.challenge('2');
    expect(events.outgoing.at(-1)).toEqual({ targetId: '2', targetNick: 'Eva' });
    // server odmítne výzvu přes `error` (busy) – NEposílá challenge-rejected
    sock.message({ type: 'error', message: 'Vyzvaný hráč už hraje.' });
    expect(events.outgoing.at(-1)).toBeNull(); // odchozí uvolněná
    expect(events.error.at(-1)).toBe('Vyzvaný hráč už hraje.');
    // po uvolnění jde vyzvat znovu (max-1 se neuzamkl)
    client.challenge('3');
    expect(events.outgoing.at(-1)).toEqual({ targetId: '3', targetNick: 'Petr' });
  });

  it('challenge-rejected cizí challengedId nerozhodí mou odchozí (ignoruje se)', () => {
    const { sock, events, client } = joined();
    client.challenge('2');
    const before = events.outgoing.length;
    sock.message({ type: 'challenge-rejected', challengedId: '999' }); // ne můj cíl
    expect(events.outgoing).toHaveLength(before); // žádná změna
  });
});

describe('createRoomClient – tah (move)', () => {
  /** Připojený klient (Jan=já) – tah smí odejít jen po úspěšném joinu. */
  function joined() {
    const h = harness();
    h.client.join('Jan');
    h.sockets[0]!.open();
    h.sockets[0]!.message({ type: 'roster', players: [{ id: '1', nick: 'Jan' }] });
    const sock = h.sockets[0]!;
    sock.sent.length = 0; // zahoď join, ať asserty vidí jen zprávy tahu
    return { ...h, sock };
  }

  it('move po joinu pošle {type:move, gameId, from, path} a vrátí true', () => {
    const { sock, client } = joined();
    const ok = client.move('g1', 9, [13]);
    expect(ok).toBe(true);
    expect(sock.sent).toEqual([JSON.stringify({ type: 'move', gameId: 'g1', from: 9, path: [13] })]);
  });

  it('move vícenásobného skoku pošle celou cestu (i s duplicitou u kruhového skoku)', () => {
    const { sock, client } = joined();
    // Cesta smí obsahovat opakované pole (kruhový skok dámy) – kopíruje se prvek po prvku.
    client.move('g1', 9, [18, 25, 18]);
    expect(sock.sent).toEqual([JSON.stringify({ type: 'move', gameId: 'g1', from: 9, path: [18, 25, 18] })]);
  });

  it('move serializuje kopii path – pozdější mutace vstupu odeslané pole nezmění', () => {
    const { sock, client } = joined();
    const path = [13, 22];
    client.move('g1', 9, path);
    path.push(31); // mutace po odeslání nesmí protéct do už poslané zprávy
    expect(sock.sent).toEqual([JSON.stringify({ type: 'move', gameId: 'g1', from: 9, path: [13, 22] })]);
  });

  it('move před vstupem do místnosti je no-op a vrátí false (otevřeno, roster nedorazil)', () => {
    const { sockets, client } = harness();
    client.join('Jan');
    sockets[0]!.open(); // otevřeno, ale nejsem „joined" (roster nedorazil)
    const ok = client.move('g1', 9, [13]);
    expect(ok).toBe(false);
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: 'join', nick: 'Jan' })]);
  });

  it('move po pádu spojení je no-op a vrátí false (zavřený socket)', () => {
    const { sock, client } = joined();
    sock.fireClose(); // spojení spadlo → socket CLOSED
    const ok = client.move('g1', 9, [13]);
    expect(ok).toBe(false);
    expect(sock.sent).toEqual([]); // nic se neposlalo
  });

  it('move po dispose je no-op a vrátí false', () => {
    const { sock, client } = joined();
    client.dispose();
    const ok = client.move('g1', 9, [13]);
    expect(ok).toBe(false);
    expect(sock.sent).toEqual([]);
  });
});

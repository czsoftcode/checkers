/**
 * Jednotky GameHubu (transport WS, fáze 66) BEZ skutečného spojení – fake
 * sockety s ovladatelným `readyState`. Zuby:
 *   - broadcast jde JEN do socketů dané partie (izolace dvojice),
 *   - přeskočí neotevřené sockety (readyState !== OPEN),
 *   - jeden vadný `send` neshodí ostatní ani volajícího,
 *   - unsubscribe socket odebere (broadcast už mu neposílá).
 * Kdyby hub izolaci nebo guard readyState nedělal, tyhle testy padnou.
 */

import { describe, expect, it, vi } from 'vitest';

import { GameHub, type HubSocket } from '../src/index.js';

const WS_OPEN = 1;
const WS_CLOSED = 3;

/** Fake socket: zaznamenává přijaté zprávy, `readyState` řídí test. */
function fakeSocket(readyState = WS_OPEN): HubSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    readyState,
    sent,
    send(data: string): void {
      sent.push(data);
    },
  };
}

describe('GameHub.broadcast', () => {
  it('pošle jen odběratelům DANÉ partie, ne cizím', () => {
    const hub = new GameHub();
    const a1 = fakeSocket();
    const a2 = fakeSocket();
    const b1 = fakeSocket();
    hub.subscribe('game-a', a1);
    hub.subscribe('game-a', a2);
    hub.subscribe('game-b', b1);

    hub.broadcast('game-a', 'zprava-a');

    expect(a1.sent).toEqual(['zprava-a']);
    expect(a2.sent).toEqual(['zprava-a']);
    expect(b1.sent).toEqual([]); // izolace: cizí partie nic nedostane
  });

  it('přeskočí neotevřené sockety (readyState !== OPEN)', () => {
    const hub = new GameHub();
    const open = fakeSocket(WS_OPEN);
    const closed = fakeSocket(WS_CLOSED);
    hub.subscribe('g', open);
    hub.subscribe('g', closed);

    hub.broadcast('g', 'x');

    expect(open.sent).toEqual(['x']);
    expect(closed.sent).toEqual([]); // zavřený se přeskočí, ne že spadne
  });

  it('vadný send jednoho socketu neshodí ostatní ani volajícího', () => {
    const hub = new GameHub();
    const boom: HubSocket = {
      readyState: WS_OPEN,
      send: () => {
        throw new Error('socket pukl');
      },
    };
    const ok = fakeSocket();
    hub.subscribe('g', boom);
    hub.subscribe('g', ok);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Nesmí vyhodit ven (fire-and-forget vedlejší efekt).
    expect(() => hub.broadcast('g', 'y')).not.toThrow();
    expect(ok.sent).toEqual(['y']); // druhý socket dostal zprávu i přes chybu prvního
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it('broadcast na neznámou partii je no-op', () => {
    const hub = new GameHub();
    expect(() => hub.broadcast('neexistuje', 'z')).not.toThrow();
  });
});

describe('GameHub subscribe/unsubscribe', () => {
  it('unsubscribe socket odebere – broadcast už mu neposílá', () => {
    const hub = new GameHub();
    const s = fakeSocket();
    hub.subscribe('g', s);
    expect(hub.subscriberCount('g')).toBe(1);

    hub.unsubscribe('g', s);
    expect(hub.subscriberCount('g')).toBe(0);

    hub.broadcast('g', 'nedorazi');
    expect(s.sent).toEqual([]);
  });

  it('unsubscribe posledního odběratele uklidí prázdnou místnost', () => {
    const hub = new GameHub();
    const s = fakeSocket();
    hub.subscribe('g', s);
    hub.unsubscribe('g', s);
    // Mapa nemá růst o prázdné místnosti; count 0 to potvrdí nepřímo.
    expect(hub.subscriberCount('g')).toBe(0);
  });

  it('unsubscribe neznámé partie/socketu je no-op', () => {
    const hub = new GameHub();
    expect(() => hub.unsubscribe('nic', fakeSocket())).not.toThrow();
  });
});

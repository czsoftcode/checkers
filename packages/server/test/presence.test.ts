/**
 * Jednotky RoomPresence (registr místnosti, fáze 67) BEZ skutečného spojení –
 * fake sockety s ovladatelným `readyState`. Zuby:
 *   - join přidělí id a zapíše hráče (roster ho obsahuje),
 *   - unikátnost je case-insensitive → `nick-taken` s návrhem volné varianty,
 *   - návrh eskaluje `_1 → _2`, když je i `_1` obsazený,
 *   - prázdná / jen-mezery / příliš dlouhá přezdívka → `invalid` (nezapíše se),
 *   - broadcast jde jen do OTEVŘENÝCH socketů a umí vynechat `exceptId`,
 *   - vadný `send` neshodí ostatní,
 *   - remove hráče odebere (roster i broadcast ho pak minou).
 * Kdyby modul unikátnost, validaci nebo guardy nedělal, tyhle testy padnou.
 */

import { describe, expect, it } from 'vitest';

import { NICK_MAX_LENGTH, RoomPresence, type RoomSocket } from '../src/index.js';

const WS_OPEN = 1;
const WS_CLOSED = 3;

/** Fake socket: zaznamenává přijaté zprávy, `readyState` řídí test. */
function fakeSocket(readyState = WS_OPEN): RoomSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    readyState,
    sent,
    send(data: string): void {
      sent.push(data);
    },
  };
}

describe('RoomPresence.join', () => {
  it('zapíše hráče, přidělí id a roster ho obsahuje', () => {
    const room = new RoomPresence();
    const result = room.join('Honza', fakeSocket());

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.player.nick).toBe('Honza');
    expect(result.player.id).toMatch(/./); // neprázdné id
    expect(room.roster()).toEqual([{ id: result.player.id, nick: 'Honza' }]);
    expect(room.count()).toBe(1);
  });

  it('přezdívku trimuje (roster nese ořezanou variantu)', () => {
    const room = new RoomPresence();
    const result = room.join('  Anna  ', fakeSocket());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.player.nick).toBe('Anna');
  });

  it('duplicitní přezdívka je case-insensitive → nick-taken s návrhem', () => {
    const room = new RoomPresence();
    room.join('Honza', fakeSocket());
    const result = room.join('honza', fakeSocket()); // jiná velikost písmen

    expect(result.status).toBe('nick-taken');
    if (result.status !== 'nick-taken') return;
    expect(result.suggestion).toBe('honza_1');
    expect(room.count()).toBe(1); // druhý se NEzapsal
  });

  it('návrh eskaluje na _2, když je i _1 obsazený', () => {
    const room = new RoomPresence();
    room.join('Honza', fakeSocket());
    room.join('Honza_1', fakeSocket());
    const result = room.join('Honza', fakeSocket());

    expect(result.status).toBe('nick-taken');
    if (result.status !== 'nick-taken') return;
    expect(result.suggestion).toBe('Honza_2');
  });

  it('prázdná a jen-mezery přezdívka → invalid, nezapíše se', () => {
    const room = new RoomPresence();
    expect(room.join('', fakeSocket()).status).toBe('invalid');
    expect(room.join('   ', fakeSocket()).status).toBe('invalid');
    expect(room.count()).toBe(0);
  });

  it('přezdívka delší než limit → invalid', () => {
    const room = new RoomPresence();
    const tooLong = 'x'.repeat(NICK_MAX_LENGTH + 1);
    expect(room.join(tooLong, fakeSocket()).status).toBe('invalid');
    // přesně na limit projde
    expect(room.join('y'.repeat(NICK_MAX_LENGTH), fakeSocket()).status).toBe('ok');
  });

  it('návrh nepřekročí limit délky (základ se zkrátí)', () => {
    const room = new RoomPresence();
    const maxNick = 'z'.repeat(NICK_MAX_LENGTH);
    room.join(maxNick, fakeSocket());
    const result = room.join(maxNick, fakeSocket());
    expect(result.status).toBe('nick-taken');
    if (result.status !== 'nick-taken') return;
    expect(result.suggestion.length).toBeLessThanOrEqual(NICK_MAX_LENGTH);
    expect(result.suggestion.endsWith('_1')).toBe(true);
  });
});

describe('RoomPresence.broadcast', () => {
  it('pošle všem otevřeným, umí vynechat exceptId', () => {
    const room = new RoomPresence();
    const sockA = fakeSocket();
    const sockB = fakeSocket();
    const a = room.join('A', sockA);
    room.join('B', sockB);
    if (a.status !== 'ok') throw new Error('setup');

    room.broadcast('zprava', a.player.id); // kromě A

    expect(sockA.sent).toEqual([]); // A vynechán
    expect(sockB.sent).toEqual(['zprava']);
  });

  it('přeskočí neotevřené sockety (readyState !== OPEN)', () => {
    const room = new RoomPresence();
    const open = fakeSocket(WS_OPEN);
    const closed = fakeSocket(WS_CLOSED);
    room.join('open', open);
    room.join('closed', closed);

    room.broadcast('x');

    expect(open.sent).toEqual(['x']);
    expect(closed.sent).toEqual([]); // zavřený se přeskočí, ne že spadne
  });

  it('vadný send jednoho socketu neshodí ostatní', () => {
    const room = new RoomPresence();
    const bad: RoomSocket = {
      readyState: WS_OPEN,
      send() {
        throw new Error('rozbitý socket');
      },
    };
    const good = fakeSocket();
    room.join('bad', bad);
    room.join('good', good);

    expect(() => room.broadcast('y')).not.toThrow();
    expect(good.sent).toEqual(['y']); // dobrý dostal i přes pád špatného
  });
});

describe('RoomPresence.remove', () => {
  it('odebere hráče z rosteru i z broadcastu', () => {
    const room = new RoomPresence();
    const sockA = fakeSocket();
    const a = room.join('A', sockA);
    if (a.status !== 'ok') throw new Error('setup');

    room.remove(a.player.id);
    expect(room.roster()).toEqual([]);
    expect(room.count()).toBe(0);

    room.broadcast('po odchodu');
    expect(sockA.sent).toEqual([]); // odebraný už nic nedostane
  });

  it('remove neznámého id je no-op', () => {
    const room = new RoomPresence();
    room.join('A', fakeSocket());
    expect(() => room.remove('neexistuje')).not.toThrow();
    expect(room.count()).toBe(1);
  });

  it('po odchodu se přezdívka uvolní (lze ji znovu obsadit)', () => {
    const room = new RoomPresence();
    const a = room.join('Honza', fakeSocket());
    if (a.status !== 'ok') throw new Error('setup');
    room.remove(a.player.id);
    expect(room.join('Honza', fakeSocket()).status).toBe('ok'); // volná
  });
});

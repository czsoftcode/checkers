/**
 * Jednotky prezence (fáze 103) BEZ skutečného spojení – fake sockety s
 * ovladatelným `readyState`. Dvě vrstvy:
 *
 * {@link RoomPresence} = transport JEDNÉ lobby. Zuby:
 *   - add zapíše hráče (roster ho obsahuje), count roste,
 *   - broadcast jde jen do OTEVŘENÝCH socketů a umí vynechat `exceptId`,
 *   - vadný `send` neshodí ostatní; sendTo směruje na jednoho,
 *   - remove hráče odebere (roster i broadcast ho pak minou).
 *
 * {@link Lobbies} = 4 lobby + GLOBÁLNÍ identita. Zuby (jádro fáze 103, protokol
 * connect+enter po fázi 106 – legacy `Lobbies.join` odstraněn):
 *   - connect+enter přidělí id a zapíše hráče do JEHO lobby,
 *   - přezdívka je unikátní GLOBÁLNĚ: „Karel" nejde dvakrát ani do JINÉ lobby,
 *   - unikátnost case-insensitive, návrh eskaluje `_1 → _2`,
 *   - prázdná / jen-mezery / příliš dlouhá → invalid (nezapíše se),
 *   - hráč je v PRÁVĚ JEDNÉ lobby (roster jiné lobby ho nemá),
 *   - switchLobby přesune členství BEZ ztráty identity (id/nick zůstává),
 *   - remove uvolní přezdívku globálně.
 * Kdyby modul unikátnost/validaci/scope nedělal, tyhle testy padnou.
 */

import { describe, expect, it } from 'vitest';

import type { VariantId } from '@checkers/rules';
import { Lobbies, NICK_MAX_LENGTH, RoomPresence, type RoomSocket } from '../src/index.js';

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

/**
 * Vstup do lobby přes REÁLNÝ protokol connect+enter (fáze 106, nahradil `Lobbies.join`):
 * `connect` (register identity + validace + globální unikátnost nicku) a při úspěchu
 * `enter` (členství v lobby). Vrací výsledek `connect` – stejný tvar `JoinResult`, na
 * který asserty už mířily (ok/nick-taken/invalid). Neúspěšný connect `enter` NEvolá.
 */
function joinLobby(
  lobbies: Lobbies,
  nick: string,
  variant: VariantId,
  socket: RoomSocket,
): ReturnType<Lobbies['connect']> {
  const result = lobbies.connect(nick, socket);
  if (result.status === 'ok') {
    lobbies.enter(result.player.id, variant);
  }
  return result;
}

describe('RoomPresence – transport jedné lobby', () => {
  it('add zapíše hráče, roster ho obsahuje, count roste', () => {
    const room = new RoomPresence();
    room.add({ id: 'a', nick: 'Honza' }, fakeSocket());
    expect(room.roster()).toEqual([{ id: 'a', nick: 'Honza' }]);
    expect(room.count()).toBe(1);
    expect(room.has('a')).toBe(true);
  });

  it('broadcast pošle všem otevřeným, umí vynechat exceptId', () => {
    const room = new RoomPresence();
    const sockA = fakeSocket();
    const sockB = fakeSocket();
    room.add({ id: 'a', nick: 'A' }, sockA);
    room.add({ id: 'b', nick: 'B' }, sockB);

    room.broadcast('zprava', 'a'); // kromě A

    expect(sockA.sent).toEqual([]); // A vynechán
    expect(sockB.sent).toEqual(['zprava']);
  });

  it('broadcast přeskočí neotevřené sockety (readyState !== OPEN)', () => {
    const room = new RoomPresence();
    const open = fakeSocket(WS_OPEN);
    const closed = fakeSocket(WS_CLOSED);
    room.add({ id: 'o', nick: 'open' }, open);
    room.add({ id: 'c', nick: 'closed' }, closed);

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
    room.add({ id: 'bad', nick: 'bad' }, bad);
    room.add({ id: 'good', nick: 'good' }, good);

    expect(() => room.broadcast('y')).not.toThrow();
    expect(good.sent).toEqual(['y']); // dobrý dostal i přes pád špatného
  });

  it('sendTo směruje na jednoho; zavřený/neznámý → false, žádné odeslání', () => {
    const room = new RoomPresence();
    const sock = fakeSocket();
    const closed = fakeSocket(WS_CLOSED);
    room.add({ id: 'a', nick: 'A' }, sock);
    room.add({ id: 'c', nick: 'C' }, closed);

    expect(room.sendTo('a', 'hej')).toBe(true);
    expect(sock.sent).toEqual(['hej']);
    expect(room.sendTo('c', 'nic')).toBe(false); // zavřený
    expect(closed.sent).toEqual([]);
    expect(room.sendTo('neznam', 'nic')).toBe(false); // neznámý
  });

  it('remove odebere hráče z rosteru i z broadcastu; neznámé id = no-op', () => {
    const room = new RoomPresence();
    const sockA = fakeSocket();
    room.add({ id: 'a', nick: 'A' }, sockA);

    room.remove('a');
    expect(room.roster()).toEqual([]);
    expect(room.count()).toBe(0);
    room.broadcast('po odchodu');
    expect(sockA.sent).toEqual([]); // odebraný už nic nedostane

    expect(() => room.remove('neexistuje')).not.toThrow();
  });
});

describe('Lobbies – vstup přes connect+enter + GLOBÁLNÍ identita', () => {
  it('zapíše hráče do jeho lobby, přidělí id, roster té lobby ho obsahuje', () => {
    const lobbies = new Lobbies();
    const result = joinLobby(lobbies, 'Honza', 'american', fakeSocket());

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.player.nick).toBe('Honza');
    expect(result.player.id).toMatch(/./); // neprázdné id
    expect(lobbies.room('american').roster()).toEqual([
      { id: result.player.id, nick: 'Honza' },
    ]);
    expect(lobbies.variantOf(result.player.id)).toBe('american');
    expect(lobbies.totalCount()).toBe(1);
  });

  it('přezdívku trimuje (roster nese ořezanou variantu)', () => {
    const lobbies = new Lobbies();
    const result = joinLobby(lobbies, '  Anna  ', 'russian', fakeSocket());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.player.nick).toBe('Anna');
  });

  it('přezdívka je unikátní GLOBÁLNĚ: „Karel" nejde dvakrát ani do JINÉ lobby', () => {
    const lobbies = new Lobbies();
    expect(joinLobby(lobbies, 'Karel', 'american', fakeSocket()).status).toBe('ok');
    // Stejná přezdívka do JINÉ lobby → odmítnutá (jedna přezdívka na program).
    const other = joinLobby(lobbies, 'Karel', 'russian', fakeSocket());
    expect(other.status).toBe('nick-taken');
    // A ani do stejné lobby.
    expect(joinLobby(lobbies, 'Karel', 'american', fakeSocket()).status).toBe('nick-taken');
    expect(lobbies.totalCount()).toBe(1); // jen první zápis
  });

  it('duplicitní přezdívka je case-insensitive → nick-taken s návrhem', () => {
    const lobbies = new Lobbies();
    joinLobby(lobbies, 'Honza', 'american', fakeSocket());
    const result = joinLobby(lobbies, 'honza', 'czech', fakeSocket()); // jiná velikost, jiná lobby

    expect(result.status).toBe('nick-taken');
    if (result.status !== 'nick-taken') return;
    expect(result.suggestion).toBe('honza_1');
    expect(lobbies.totalCount()).toBe(1);
  });

  it('návrh eskaluje na _2, když je i _1 obsazený (napříč lobby)', () => {
    const lobbies = new Lobbies();
    joinLobby(lobbies, 'Honza', 'american', fakeSocket());
    joinLobby(lobbies, 'Honza_1', 'russian', fakeSocket());
    const result = joinLobby(lobbies, 'Honza', 'pool', fakeSocket());

    expect(result.status).toBe('nick-taken');
    if (result.status !== 'nick-taken') return;
    expect(result.suggestion).toBe('Honza_2');
  });

  it('prázdná a jen-mezery přezdívka → invalid, nezapíše se', () => {
    const lobbies = new Lobbies();
    expect(joinLobby(lobbies, '', 'american', fakeSocket()).status).toBe('invalid');
    expect(joinLobby(lobbies, '   ', 'american', fakeSocket()).status).toBe('invalid');
    expect(lobbies.totalCount()).toBe(0);
  });

  it('přezdívka delší než limit → invalid; přesně na limit projde', () => {
    const lobbies = new Lobbies();
    const tooLong = 'x'.repeat(NICK_MAX_LENGTH + 1);
    expect(joinLobby(lobbies, tooLong, 'american', fakeSocket()).status).toBe('invalid');
    expect(joinLobby(lobbies, 'y'.repeat(NICK_MAX_LENGTH), 'american', fakeSocket()).status).toBe('ok');
  });

  it('návrh nepřekročí limit délky (základ se zkrátí)', () => {
    const lobbies = new Lobbies();
    const maxNick = 'z'.repeat(NICK_MAX_LENGTH);
    joinLobby(lobbies, maxNick, 'american', fakeSocket());
    const result = joinLobby(lobbies, maxNick, 'russian', fakeSocket());
    expect(result.status).toBe('nick-taken');
    if (result.status !== 'nick-taken') return;
    expect(result.suggestion.length).toBeLessThanOrEqual(NICK_MAX_LENGTH);
    expect(result.suggestion.endsWith('_1')).toBe(true);
  });

  it('hráč je v PRÁVĚ JEDNÉ lobby (roster jiné lobby ho nemá)', () => {
    const lobbies = new Lobbies();
    const r = joinLobby(lobbies, 'Eva', 'russian', fakeSocket());
    if (r.status !== 'ok') throw new Error('setup');
    expect(lobbies.room('russian').has(r.player.id)).toBe(true);
    expect(lobbies.room('american').has(r.player.id)).toBe(false);
    expect(lobbies.room('czech').has(r.player.id)).toBe(false);
  });

  it('sendTo najde lobby hráče a doručí (globální směrování)', () => {
    const lobbies = new Lobbies();
    const sock = fakeSocket();
    const r = joinLobby(lobbies, 'Eva', 'pool', sock);
    if (r.status !== 'ok') throw new Error('setup');
    expect(lobbies.sendTo(r.player.id, 'ping')).toBe(true);
    expect(sock.sent).toEqual(['ping']);
    expect(lobbies.sendTo('neznam', 'x')).toBe(false);
  });
});

describe('Lobbies.remove / switchLobby', () => {
  it('remove uvolní přezdívku globálně (lze ji znovu obsadit)', () => {
    const lobbies = new Lobbies();
    const a = joinLobby(lobbies, 'Honza', 'american', fakeSocket());
    if (a.status !== 'ok') throw new Error('setup');
    lobbies.remove(a.player.id);
    expect(lobbies.room('american').count()).toBe(0);
    // Volná i v jiné lobby.
    expect(joinLobby(lobbies, 'Honza', 'russian', fakeSocket()).status).toBe('ok');
  });

  it('remove neznámého id je no-op', () => {
    const lobbies = new Lobbies();
    joinLobby(lobbies, 'A', 'american', fakeSocket());
    expect(() => lobbies.remove('neexistuje')).not.toThrow();
    expect(lobbies.totalCount()).toBe(1);
  });

  it('switchLobby přesune členství BEZ ztráty identity (id/nick zůstává)', () => {
    const lobbies = new Lobbies();
    const sock = fakeSocket();
    const a = joinLobby(lobbies, 'Honza', 'american', sock);
    if (a.status !== 'ok') throw new Error('setup');

    const res = lobbies.switchLobby(a.player.id, 'russian');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.variant).toBe('russian');
    // Identita zůstala: stejné id, přezdívka pořád obsazená.
    expect(lobbies.variantOf(a.player.id)).toBe('russian');
    expect(lobbies.room('russian').has(a.player.id)).toBe(true);
    expect(lobbies.room('american').has(a.player.id)).toBe(false);
    // Socket cestuje s hráčem – broadcast v nové lobby ho zasáhne.
    lobbies.room('russian').broadcast('vitej');
    expect(sock.sent).toEqual(['vitej']);
    // Přezdívka je pořád rezervovaná (nelze ji znovu vzít).
    expect(joinLobby(lobbies, 'Honza', 'american', fakeSocket()).status).toBe('nick-taken');
  });

  it('switchLobby do stejné lobby → same (žádný přesun)', () => {
    const lobbies = new Lobbies();
    const a = joinLobby(lobbies, 'Honza', 'american', fakeSocket());
    if (a.status !== 'ok') throw new Error('setup');
    expect(lobbies.switchLobby(a.player.id, 'american').status).toBe('same');
    expect(lobbies.room('american').has(a.player.id)).toBe(true);
  });

  it('switchLobby neznámého hráče → not-joined', () => {
    const lobbies = new Lobbies();
    expect(lobbies.switchLobby('neznam', 'russian').status).toBe('not-joined');
  });
});

describe('Lobbies.connect / enter – předsíň (fáze 105)', () => {
  it('connect zaregistruje identitu BEZ členství (nejsem v žádném rosteru, totalCount roste)', () => {
    const lobbies = new Lobbies();
    const c = lobbies.connect('Honza', fakeSocket());
    expect(c.status).toBe('ok');
    if (c.status !== 'ok') return;
    // Připojen (identita existuje), ale ne-člen: variantOf je null, žádná lobby ho nemá.
    expect(lobbies.totalCount()).toBe(1);
    expect(lobbies.variantOf(c.player.id)).toBeNull();
    for (const v of ['american', 'pool', 'russian', 'czech', 'italian'] as const) {
      expect(lobbies.room(v).has(c.player.id)).toBe(false);
    }
  });

  it('globální unikátnost nicku platí i pro connect (přes lobby i předsíň)', () => {
    const lobbies = new Lobbies();
    lobbies.connect('Honza', fakeSocket());
    // Druhý connect téhož nicku (case-insensitive) → nick-taken.
    expect(lobbies.connect('honza', fakeSocket()).status).toBe('nick-taken');
    // A join téhož nicku taky (sdílený registr identit).
    expect(joinLobby(lobbies, 'HONZA', 'russian', fakeSocket()).status).toBe('nick-taken');
  });

  it('connect validuje nick stejně jako join (prázdný/dlouhý → invalid)', () => {
    const lobbies = new Lobbies();
    expect(lobbies.connect('   ', fakeSocket()).status).toBe('invalid');
    expect(lobbies.connect('x'.repeat(NICK_MAX_LENGTH + 1), fakeSocket()).status).toBe('invalid');
    expect(lobbies.totalCount()).toBe(0); // nic se nezapsalo
  });

  it('enter přidá ne-člena do rosteru zvolené lobby (null → člen)', () => {
    const lobbies = new Lobbies();
    const sock = fakeSocket();
    const c = lobbies.connect('Honza', sock);
    if (c.status !== 'ok') throw new Error('setup');

    const res = lobbies.enter(c.player.id, 'russian');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.variant).toBe('russian');
    expect(lobbies.variantOf(c.player.id)).toBe('russian');
    expect(lobbies.room('russian').has(c.player.id)).toBe(true);
    // Socket cestuje s identitou → broadcast v lobby ho zasáhne.
    lobbies.room('russian').broadcast('ahoj');
    expect(sock.sent).toEqual(['ahoj']);
  });

  it('enter neznámé identity → not-joined', () => {
    const lobbies = new Lobbies();
    expect(lobbies.enter('neznam', 'russian').status).toBe('not-joined');
  });

  it('remove ne-člena (předsíň) jen zahodí identitu, žádná room ho neřeší', () => {
    const lobbies = new Lobbies();
    const c = lobbies.connect('Honza', fakeSocket());
    if (c.status !== 'ok') throw new Error('setup');
    expect(() => lobbies.remove(c.player.id)).not.toThrow();
    expect(lobbies.totalCount()).toBe(0);
    // Přezdívka se uvolní globálně.
    expect(lobbies.connect('Honza', fakeSocket()).status).toBe('ok');
  });

  it('sendTo ne-členu doručí přímo na jeho socket (není v žádné room)', () => {
    const lobbies = new Lobbies();
    const sock = fakeSocket();
    const c = lobbies.connect('Honza', sock);
    if (c.status !== 'ok') throw new Error('setup');
    expect(lobbies.sendTo(c.player.id, 'primo')).toBe(true);
    expect(sock.sent).toEqual(['primo']);
  });

  it('broadcastAll zasáhne i ne-člena předsíně (dostane all-roster snímek)', () => {
    const lobbies = new Lobbies();
    const sock = fakeSocket();
    const c = lobbies.connect('Host', sock);
    if (c.status !== 'ok') throw new Error('setup');
    lobbies.broadcastAll('snimek');
    expect(sock.sent).toEqual(['snimek']);
  });
});

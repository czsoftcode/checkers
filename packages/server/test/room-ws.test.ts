/**
 * Integrační test místnosti přítomnosti (fáze 67) přes SKUTEČNÉ spojení:
 * server `listen({ port: 0 })` + reálný `ws` klient (`app.inject` WS neumí).
 * Vstup je ZPRÁVOU `{ type:'join', nick }`, ne připojením.
 *
 * Zuby:
 *   - B po join vidí A v rosteru; A dostane `joined(B)`; po zavření A dostane
 *     B `left(A)` (kdyby broadcast/close chyběl, padne),
 *   - duplicitní přezdívka → `nick-taken` s návrhem, druhý se NEzapíše, první
 *     NEdostane nic (izolace: obsazenost nevpustí dvojníka),
 *   - prázdná / příliš dlouhá přezdívka → `error`, žádný zápis,
 *   - dvojí join na tomtéž socketu → `error`,
 *   - izolace od herní WS (fáze 66): odběratel `/games/:id/ws` nedostane nic
 *     z místnosti.
 *
 * Zápis hráče se čeká deterministicky přes `roomPresence.count()` (dekorace app),
 * ne arbitrárním sleepem – jinak by test byl flaky.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import type { GameDto, OpeningBook, RoomPresence, RoomServerMessage } from '../src/index.js';

const NO_BOOK: OpeningBook = new Map();

let app: FastifyInstance;
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of openSockets) {
    ws.close();
  }
  openSockets.length = 0;
  await app.close();
});

async function start(): Promise<number> {
  app = buildApp({ openingBook: NO_BOOK });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

function presence(): RoomPresence {
  return (app as unknown as { roomPresence: RoomPresence }).roomPresence;
}

function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (pred()) {
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('waitFor: podmínka nenastala do timeoutu'));
      } else {
        setTimeout(tick, 10);
      }
    };
    tick();
  });
}

/** Otevře WS spojení k místnosti a počká na `open`. NEposílá join. */
async function openRoom(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/room/ws`);
  openSockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

/** Vrátí příští zprávu socketu jako parsovanou obálku (nebo padne timeoutem). */
function nextMessage(ws: WebSocket, timeoutMs = 1000): Promise<RoomServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS: žádná zpráva do timeoutu')), timeoutMs);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as RoomServerMessage);
    });
  });
}

/** Sbírá VŠECHNY zprávy socketu (pro ověření „nic nedorazilo"). */
function collectMessages(ws: WebSocket): RoomServerMessage[] {
  const received: RoomServerMessage[] = [];
  ws.on('message', (data: Buffer) => received.push(JSON.parse(data.toString()) as RoomServerMessage));
  return received;
}

/** Připojí hráče: otevře, pošle join a počká na jeho `roster`. Vrátí socket + roster. */
async function joinRoom(
  port: number,
  nick: string,
): Promise<{ ws: WebSocket; roster: RoomServerMessage }> {
  const ws = await openRoom(port);
  const rosterMsg = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'join', nick }));
  const roster = await rosterMsg;
  return { ws, roster };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Místnost – přítomnost přes WS', () => {
  it('B po join vidí A v rosteru; A dostane joined(B); po zavření A dostane B left(A)', async () => {
    const port = await start();

    const a = await joinRoom(port, 'Alice');
    expect(a.roster.type).toBe('roster');
    if (a.roster.type !== 'roster') return;
    expect(a.roster.players.map((p) => p.nick)).toEqual(['Alice']);
    const aliceId = a.roster.players[0]?.id;

    // A poslouchá příchod B PŘED tím, než B vstoupí.
    const aliceSeesJoin = nextMessage(a.ws);

    const b = await joinRoom(port, 'Bob');
    expect(b.roster.type).toBe('roster');
    if (b.roster.type !== 'roster') return;
    // B vidí OBA (A i sebe).
    expect(b.roster.players.map((p) => p.nick).sort()).toEqual(['Alice', 'Bob']);
    const bobId = b.roster.players.find((p) => p.nick === 'Bob')?.id;

    const joined = await aliceSeesJoin;
    expect(joined.type).toBe('joined');
    if (joined.type !== 'joined') return;
    expect(joined.player.nick).toBe('Bob');
    expect(joined.player.id).toBe(bobId);

    // A odejde → B dostane left(A).
    const bobSeesLeft = nextMessage(b.ws);
    a.ws.close();
    const left = await bobSeesLeft;
    expect(left.type).toBe('left');
    if (left.type !== 'left') return;
    expect(left.player.id).toBe(aliceId);

    await waitFor(() => presence().count() === 1); // zbyl jen Bob
  });

  it('duplicitní přezdívka → nick-taken s návrhem; druhý se nezapíše, první nedostane nic', async () => {
    const port = await start();
    const a = await joinRoom(port, 'Honza');
    const firstReceived = collectMessages(a.ws); // A nesmí dostat nic

    const ws = await openRoom(port);
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'join', nick: 'honza' })); // jiná velikost
    const msg = await reply;

    expect(msg.type).toBe('nick-taken');
    if (msg.type !== 'nick-taken') return;
    expect(msg.suggestion).toBe('honza_1');

    await delay(50);
    expect(presence().count()).toBe(1); // dvojník se NEzapsal
    expect(firstReceived).toEqual([]); // A o pokusu nic neví
  });

  it('prázdná i příliš dlouhá přezdívka → error, žádný zápis', async () => {
    const port = await start();

    const ws1 = await openRoom(port);
    const r1 = nextMessage(ws1);
    ws1.send(JSON.stringify({ type: 'join', nick: '   ' }));
    expect((await r1).type).toBe('error');

    const ws2 = await openRoom(port);
    const r2 = nextMessage(ws2);
    ws2.send(JSON.stringify({ type: 'join', nick: 'x'.repeat(100) }));
    expect((await r2).type).toBe('error');

    await delay(50);
    expect(presence().count()).toBe(0);
  });

  it('dvojí join na tomtéž socketu → error', async () => {
    const port = await start();
    const { ws } = await joinRoom(port, 'Karel');

    const second = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'join', nick: 'Karel2' }));
    const msg = await second;
    expect(msg.type).toBe('error');

    await delay(50);
    expect(presence().count()).toBe(1); // pořád jen jeden zápis
  });

  it('nevalidní JSON / neznámý typ → error, socket žije dál', async () => {
    const port = await start();
    const ws = await openRoom(port);

    const r1 = nextMessage(ws);
    ws.send('tohle není JSON');
    expect((await r1).type).toBe('error');

    // `null` a primitiva jsou PLATNÝ JSON – bez tvarové kontroly by čtení `.type`
    // na `null` hodilo TypeError a shodilo handler (regresní past).
    const rNull = nextMessage(ws);
    ws.send('null');
    expect((await rNull).type).toBe('error');

    const rNum = nextMessage(ws);
    ws.send('42');
    expect((await rNum).type).toBe('error');

    const r2 = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'neznamy' }));
    expect((await r2).type).toBe('error');

    // Socket žije: platný join po chybách projde.
    const r3 = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'join', nick: 'Eva' }));
    expect((await r3).type).toBe('roster');
  });

  it('izolace od herní WS (fáze 66): odběratel partie nedostane nic z místnosti', async () => {
    const port = await start();
    const game = await app
      .inject({ method: 'POST', url: '/games' })
      .then((r) => r.json<GameDto>());

    const gameWs = new WebSocket(`ws://127.0.0.1:${port}/games/${game.id}/ws`);
    openSockets.push(gameWs);
    await new Promise<void>((resolve, reject) => {
      gameWs.once('open', () => resolve());
      gameWs.once('error', reject);
    });
    const gameReceived = collectMessages(gameWs);

    // Dění v místnosti nesmí zasáhnout odběratele partie.
    await joinRoom(port, 'Alice');
    await joinRoom(port, 'Bob');

    await delay(50);
    expect(gameReceived).toEqual([]); // herní socket z místnosti nic nedostal
  });
});

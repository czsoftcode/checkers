/**
 * Integrační testy PŘEDSÍNĚ a pravidla výzev (fáze 105) přes SKUTEČNÁ WS spojení:
 * server `listen({ port: 0 })` + reální `ws` klienti (app.inject WS neumí).
 *
 * Brána fáze 105 (server-only, UI je až 106):
 *   - PŘEDSÍŇ: `connect{nick}` zaregistruje bez členství → dostanu all-roster snímek a
 *     NEJSEM v žádném rosteru; `enter{variant}` mě přidá do lobby a jde mě vyzvat.
 *   - PRVNÍ VÝZVA VYHRÁVÁ: vyzvu hráče s čekající příchozí výzvou → „obsazen", první
 *     výzva pořád platí (max jedna příchozí na hráče).
 *   - NE-ČLEN: připojený bez `enter` sám nevyzývá a není v žádném rosteru (netargetovatelný).
 *
 * Stávající join/switch-lobby/challenge (fáze 103/104) tenhle řez NEmění – jejich testy
 * (challenge-ws / room-ws / variant-lobby-ws / pvp-*-ws) zůstávají zelené beze změny.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

import type { VariantId } from '@checkers/rules';
import { buildApp } from '../src/index.js';
import type { ChallengeRegistry, RoomServerMessage } from '../src/index.js';

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
  app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

function challengeRegistry(): ChallengeRegistry {
  return (app as unknown as { challengeRegistry: ChallengeRegistry }).challengeRegistry;
}

function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (pred()) {
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('waitFor: podmínka nenastala do timeoutu'));
      } else {
        setTimeout(tick, 5);
      }
    };
    tick();
  });
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function openRoom(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/room/ws`);
  openSockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

function collectRoom(ws: WebSocket): RoomServerMessage[] {
  const received: RoomServerMessage[] = [];
  ws.on('message', (data: Buffer) => received.push(JSON.parse(data.toString()) as RoomServerMessage));
  return received;
}

async function takeMessage<T extends RoomServerMessage['type']>(
  received: RoomServerMessage[],
  type: T,
  timeoutMs = 2000,
): Promise<Extract<RoomServerMessage, { type: T }>> {
  await waitFor(() => received.some((m) => m.type === type), timeoutMs);
  const idx = received.findIndex((m) => m.type === type);
  const [msg] = received.splice(idx, 1);
  return msg as Extract<RoomServerMessage, { type: T }>;
}

/** Připojí se do PŘEDSÍNĚ (`connect{nick}`) a počká na all-roster snímek. */
async function connect(
  port: number,
  nick: string,
): Promise<{
  ws: WebSocket;
  received: RoomServerMessage[];
  snapshot: Extract<RoomServerMessage, { type: 'lobbies' }>;
}> {
  const ws = await openRoom(port);
  const received = collectRoom(ws);
  ws.send(JSON.stringify({ type: 'connect', nick }));
  const snapshot = await takeMessage(received, 'lobbies');
  return { ws, received, snapshot };
}

/** Vstoupí z předsíně do lobby (`enter{variant}`) a počká na echo `roster` + vrátí mé id. */
async function enter(
  ws: WebSocket,
  received: RoomServerMessage[],
  variant: VariantId,
  nick: string,
): Promise<string> {
  ws.send(JSON.stringify({ type: 'enter', variant }));
  const roster = await takeMessage(received, 'roster');
  const mine = roster.players.find((p) => p.nick === nick);
  if (mine === undefined) {
    throw new Error(`vlastní id (${nick}) nebylo v rosteru po enter`);
  }
  return mine.id;
}

/** Najde id hráče `nick` v lobby `variant` v posledním all-roster snímku pole `received`. */
function idInSnapshot(
  snapshot: Extract<RoomServerMessage, { type: 'lobbies' }>,
  variant: VariantId,
  nick: string,
): string | undefined {
  return snapshot.lobbies.find((l) => l.variant === variant)?.players.find((p) => p.nick === nick)?.id;
}

describe('Předsíň – connect / enter (fáze 105)', () => {
  it('connect → all-roster snímek a NEJSEM v žádném rosteru; enter → objevím se a jde mě vyzvat', async () => {
    const port = await start();
    const alice = await connect(port, 'Alice');

    // Snímek nese všech 5 lobby, VŠECHNY prázdné (Alice je ne-člen, nikde není).
    expect(alice.snapshot.lobbies.map((l) => l.variant).sort()).toEqual([
      'american',
      'czech',
      'italian',
      'pool',
      'russian',
    ]);
    expect(alice.snapshot.lobbies.every((l) => l.players.length === 0)).toBe(true);

    // Vstup do ruské → objevím se v jejím rosteru.
    const aliceId = await enter(alice.ws, alice.received, 'russian', 'Alice');
    expect(typeof aliceId).toBe('string');

    // Bob vstoupí do téže lobby a Alici vyzve → Alice dostane `challenged`.
    const bob = await connect(port, 'Bob');
    const bobId = await enter(bob.ws, bob.received, 'russian', 'Bob');
    bob.ws.send(JSON.stringify({ type: 'challenge', targetId: aliceId }));
    const challenged = await takeMessage(alice.received, 'challenged');
    expect(challenged.challenge.challengerId).toBe(bobId);
    expect(challenged.challenge.challengerNick).toBe('Bob');
  });

  it('enter aktualizuje all-roster snímek pozorovateli v předsíni', async () => {
    const port = await start();
    const watcher = await connect(port, 'Watcher'); // zůstane v předsíni
    watcher.received.length = 0;

    const mover = await connect(port, 'Mover');
    await enter(mover.ws, mover.received, 'pool', 'Mover');

    // Pozorovatel (ne-člen) dostane snímek, kde Mover je v pool.
    await waitFor(() =>
      watcher.received.some(
        (m) =>
          m.type === 'lobbies' &&
          m.lobbies.find((l) => l.variant === 'pool')?.players.some((p) => p.nick === 'Mover') === true,
      ),
    );
  });
});

describe('Předsíň – pravidlo „první výzva vyhrává" (fáze 105)', () => {
  it('vyzvu hráče s čekající příchozí výzvou → obsazen; první výzva platí dál', async () => {
    const port = await start();
    const alice = await connect(port, 'Alice');
    const aliceId = await enter(alice.ws, alice.received, 'russian', 'Alice');
    const bob = await connect(port, 'Bob');
    await enter(bob.ws, bob.received, 'russian', 'Bob');
    const carol = await connect(port, 'Carol');
    await enter(carol.ws, carol.received, 'russian', 'Carol');

    // Bob vyzve Alici (první výzva).
    bob.ws.send(JSON.stringify({ type: 'challenge', targetId: aliceId }));
    await takeMessage(alice.received, 'challenged');

    // Carol vyzve tutéž Alici → obsazen (jiný důvod než „už hraje").
    carol.ws.send(JSON.stringify({ type: 'challenge', targetId: aliceId }));
    const err = await takeMessage(carol.received, 'error');
    expect(err.message).not.toMatch(/hraje/i);
    expect(err.message).toMatch(/zvažuje|jinou/i);

    // První výzva pořád platí; Alice nedostala druhé `challenged`.
    await delay(50);
    expect(challengeRegistry().pendingCount()).toBe(1);
    expect(alice.received.some((m) => m.type === 'challenged')).toBe(false);
  });
});

describe('Předsíň – ne-člen nevyzývá a není targetovatelný (fáze 105)', () => {
  it('ne-člen (connect bez enter) sám nevyzývá → error, protějšek nedostane výzvu', async () => {
    const port = await start();
    // Alice zůstane v předsíni (ne-člen).
    const alice = await connect(port, 'Alice');
    // Bob je člen ruské lobby.
    const bob = await connect(port, 'Bob');
    const bobId = await enter(bob.ws, bob.received, 'russian', 'Bob');

    // Alice dostane snímek s Bobem (broadcastAll jde i ne-členům) → zná Bobovo id.
    const snap = await takeMessage(alice.received, 'lobbies');
    expect(idInSnapshot(snap, 'russian', 'Bob')).toBe(bobId);

    // Alice (ne-člen) zkusí Boba vyzvat → odmítnuto (nejdřív vstup do lobby).
    alice.ws.send(JSON.stringify({ type: 'challenge', targetId: bobId }));
    const err = await takeMessage(alice.received, 'error');
    expect(err.message).toMatch(/vstup do lobby/i);
    // Bob žádnou výzvu nedostal a nikdo není busy.
    await delay(50);
    expect(bob.received.some((m) => m.type === 'challenged')).toBe(false);
    expect(challengeRegistry().pendingCount()).toBe(0);
  });

  it('ne-člen není v žádném rosteru → člen ho nevidí (netargetovatelný)', async () => {
    const port = await start();
    const bob = await connect(port, 'Bob');
    await enter(bob.ws, bob.received, 'russian', 'Bob');

    // Alice se připojí do předsíně (bez enter). Samotný connect ne-člena rostery NEmění,
    // takže Bobovi se nic neposílá (a Alice není v žádném rosteru). Fresh snímek Bobovi
    // vyvolá až vstup Carol → ověříme, že Alice v něm CHYBÍ, Bob a Carol jsou.
    await connect(port, 'Alice');
    bob.received.length = 0;
    const carol = await connect(port, 'Carol');
    await enter(carol.ws, carol.received, 'pool', 'Carol');

    const snap = await takeMessage(bob.received, 'lobbies');
    const everyone = snap.lobbies.flatMap((l) => l.players.map((p) => p.nick));
    expect(everyone).not.toContain('Alice'); // ne-člen je neviditelný
    expect(everyone).toEqual(expect.arrayContaining(['Bob', 'Carol']));
  });
});

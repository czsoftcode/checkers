/**
 * Integrační test párování výzvou (fáze 68) přes SKUTEČNÁ WS spojení: server
 * `listen({ port: 0 })` + reální `ws` klienti (app.inject WS neumí). Výzvy tečou
 * po TÉMŽE room WS jako presence.
 *
 * Zuby:
 *   - happy: A vyzve B → B přijme → OBA dostanou stejné gameId a svou barvu
 *     (vyzyvatel černá, vyzvaný bílá); store má PvP partii s oběma session id,
 *   - odmítnutí: vyzyvatel dostane challenge-rejected, žádná partie,
 *   - přijetí zaniklé výzvy (vyzyvatel odešel) → vyzvaný dostane challenge-cancelled
 *     a případný pozdní accept → error, NE partie,
 *   - dvojitá i křížová výzva → vyzyvatel dostane error, jen jedna výzva čeká,
 *   - „vyzvaný už hraje" (busy) → nová výzva na něj → error,
 *   - izolace od herní WS: odběratel /games/:id/ws nedostane nic z párování.
 *
 * Čeká se deterministicky přes dekorované registry (pendingCount/isBusy) a přes
 * sběr zpráv na socketu – ne arbitrárním sleepem (jinak flaky). `takeMessage`
 * je odolné vůči proplétání presence-broadcastů (joined/left) mezi zprávy výzev.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/index.js';
import type {
  ChallengeRegistry,
  GameStore,
  RoomServerMessage,
} from '../src/index.js';

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

function gameStore(): GameStore {
  return (app as unknown as { gameStore: GameStore }).gameStore;
}
function registry(): ChallengeRegistry {
  return (app as unknown as { challengeRegistry: ChallengeRegistry }).challengeRegistry;
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
        setTimeout(tick, 5);
      }
    };
    tick();
  });
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Otevře room WS a počká na `open` (neposílá join). */
async function openRoom(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/room/ws`);
  openSockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

/** Sběrač VŠECH zpráv socketu (živé pole). */
function collect(ws: WebSocket): RoomServerMessage[] {
  const received: RoomServerMessage[] = [];
  ws.on('message', (data: Buffer) => received.push(JSON.parse(data.toString()) as RoomServerMessage));
  return received;
}

/** Počká na první zprávu daného typu, VYJME ji ze sběrače a vrátí. Odolné vůči
 *  proplétání jiných zpráv (joined/left). */
async function takeMessage<T extends RoomServerMessage['type']>(
  received: RoomServerMessage[],
  type: T,
  timeoutMs = 1000,
): Promise<Extract<RoomServerMessage, { type: T }>> {
  await waitFor(() => received.some((m) => m.type === type), timeoutMs);
  const idx = received.findIndex((m) => m.type === type);
  const [msg] = received.splice(idx, 1);
  return msg as Extract<RoomServerMessage, { type: T }>;
}

/** Připojí hráče: otevře, sbírá zprávy, pošle join, vrátí socket + jeho session id. */
async function join(
  port: number,
  nick: string,
): Promise<{ ws: WebSocket; id: string; received: RoomServerMessage[] }> {
  const ws = await openRoom(port);
  const received = collect(ws);
  // Fáze 106: připoj do předsíně (connect → lobbies), pak vstup do americké lobby
  // (enter → roster). Party/výzvy dál probíhají v jedné (americké) lobby.
  ws.send(JSON.stringify({ type: 'connect', nick }));
  await takeMessage(received, 'lobbies');
  ws.send(JSON.stringify({ type: 'enter', variant: 'american' }));
  const roster = await takeMessage(received, 'roster');
  const mine = roster.players.find((p) => p.nick === nick);
  if (mine === undefined) {
    throw new Error(`vlastní id (${nick}) nebylo v rosteru`);
  }
  return { ws, id: mine.id, received };
}

function challenge(ws: WebSocket, targetId: string): void {
  ws.send(JSON.stringify({ type: 'challenge', targetId }));
}
function accept(ws: WebSocket, challengeId: string): void {
  ws.send(JSON.stringify({ type: 'accept', challengeId }));
}
function reject(ws: WebSocket, challengeId: string): void {
  ws.send(JSON.stringify({ type: 'reject', challengeId }));
}

describe('Párování výzvou přes WS (fáze 68)', () => {
  it('happy: A vyzve B → B přijme → oba dostanou gameId a barvu; store má PvP partii', async () => {
    const port = await start();
    const a = await join(port, 'Alice');
    const b = await join(port, 'Bob');

    challenge(a.ws, b.id);
    const challenged = await takeMessage(b.received, 'challenged');
    expect(challenged.challenge.challengerId).toBe(a.id);
    expect(challenged.challenge.challengerNick).toBe('Alice');

    accept(b.ws, challenged.challenge.id);
    const accA = await takeMessage(a.received, 'challenge-accepted');
    const accB = await takeMessage(b.received, 'challenge-accepted');

    // Stejná partie oběma; vyzyvatel černá, vyzvaný bílá.
    expect(accA.gameId).toBe(accB.gameId);
    expect(accA.color).toBe('black');
    expect(accA.opponentId).toBe(b.id);
    expect(accB.color).toBe('white');
    expect(accB.opponentId).toBe(a.id);

    // Server je autorita: PvP partie navázaná na oba session id, vyzyvatel černý.
    const game = gameStore().get(accA.gameId);
    if (game?.mode !== 'pvp') {
      throw new Error('očekával jsem PvP partii ve store');
    }
    expect(game.players).toEqual({ black: a.id, white: b.id });
    expect(registry().isBusy(a.id)).toBe(true);
    expect(registry().isBusy(b.id)).toBe(true);
  });

  it('odmítnutí: vyzyvatel dostane challenge-rejected, žádná partie', async () => {
    const port = await start();
    const a = await join(port, 'Alice');
    const b = await join(port, 'Bob');

    challenge(a.ws, b.id);
    const challenged = await takeMessage(b.received, 'challenged');
    reject(b.ws, challenged.challenge.id);

    const rej = await takeMessage(a.received, 'challenge-rejected');
    expect(rej.challengedId).toBe(b.id);
    await waitFor(() => registry().pendingCount() === 0);
    expect(registry().isBusy(a.id)).toBe(false);
    expect(registry().isBusy(b.id)).toBe(false);
  });

  it('vyzyvatel odejde během výzvy → vyzvaný dostane challenge-cancelled a pozdní accept → error', async () => {
    const port = await start();
    const a = await join(port, 'Alice');
    const b = await join(port, 'Bob');

    challenge(a.ws, b.id);
    const challenged = await takeMessage(b.received, 'challenged');

    // A odejde → jeho výzva zaniká, B se to dozví.
    a.ws.close();
    const cancelled = await takeMessage(b.received, 'challenge-cancelled');
    expect(cancelled.challengeId).toBe(challenged.challenge.id);
    await waitFor(() => registry().pendingCount() === 0);

    // Pozdní accept už neplatné výzvy → error, ŽÁDNÁ partie nevznikne.
    const gamesBefore = gameStore();
    accept(b.ws, challenged.challenge.id);
    const err = await takeMessage(b.received, 'error');
    expect(err.message).toMatch(/neplat/i);
    expect(registry().isBusy(b.id)).toBe(false);
    void gamesBefore;
  });

  it('dvojitá i křížová výzva → vyzyvatel dostane error, čeká jen jedna výzva', async () => {
    const port = await start();
    const a = await join(port, 'Alice');
    const b = await join(port, 'Bob');

    challenge(a.ws, b.id);
    await takeMessage(b.received, 'challenged');
    await waitFor(() => registry().pendingCount() === 1);

    // Dvojitá: A→B znovu → error.
    challenge(a.ws, b.id);
    expect((await takeMessage(a.received, 'error')).message).toMatch(/už čeká/i);

    // Křížová: B→A → error (mezi dvojicí smí čekat jen jedna výzva).
    challenge(b.ws, a.id);
    expect((await takeMessage(b.received, 'error')).message).toMatch(/už čeká/i);

    expect(registry().pendingCount()).toBe(1);
  });

  it('vyzvaný už hraje (busy) → nová výzva na něj → error', async () => {
    const port = await start();
    const a = await join(port, 'Alice');
    const b = await join(port, 'Bob');
    const c = await join(port, 'Cyril');

    // A a B se spárují → B busy.
    challenge(a.ws, b.id);
    const challenged = await takeMessage(b.received, 'challenged');
    accept(b.ws, challenged.challenge.id);
    await takeMessage(a.received, 'challenge-accepted');
    await waitFor(() => registry().isBusy(b.id));

    // C vyzve B (busy) → error, žádná výzva.
    challenge(c.ws, b.id);
    const err = await takeMessage(c.received, 'error');
    expect(err.message).toMatch(/hraje/i);
    expect(registry().pendingCount()).toBe(0);
  });

  it('izolace od herní WS: odběratel partie nedostane nic z párování', async () => {
    const port = await start();
    // Partie k odběru přes `/games/:id/ws`: stačí jakákoli partie ve store
    // (po fázi 90/91 je každá partie PvP).
    const game = gameStore().createPvp('A', 'B');

    const gameWs = new WebSocket(`ws://127.0.0.1:${port}/games/${game.id}/ws`);
    openSockets.push(gameWs);
    await new Promise<void>((resolve, rej) => {
      gameWs.once('open', () => resolve());
      gameWs.once('error', rej);
    });
    const gameReceived: unknown[] = [];
    gameWs.on('message', (d: Buffer) => gameReceived.push(JSON.parse(d.toString())));

    // Kompletní párování v místnosti.
    const a = await join(port, 'Alice');
    const b = await join(port, 'Bob');
    challenge(a.ws, b.id);
    const challenged = await takeMessage(b.received, 'challenged');
    accept(b.ws, challenged.challenge.id);
    await takeMessage(a.received, 'challenge-accepted');

    await delay(50);
    expect(gameReceived).toEqual([]); // herní socket z párování nic nedostal
  });
});

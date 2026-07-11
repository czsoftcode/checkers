/**
 * Integrační test PvP hraní (fáze 70) přes SKUTEČNÁ WS spojení: server
 * `listen({ port: 0 })` + reální `ws` klienti (app.inject WS neumí).
 *
 * Autorita serveru: PvP tah přijde po room WS (`{type:'move',gameId,from,path}`),
 * identitu hráče bere server z `me.id` (přiřazené socketu při joinu, NEČTE se z
 * klienta). Server přijme tah JEN od účastníka partie, který je NA TAHU, a jen
 * legální; po platném tahu rozešle nový stav OBĚMA přes game hub `/games/:id/ws`.
 *
 * Zuby:
 *   - happy: černý (vyzyvatel) zahraje legální tah → OBA game WS dostanou
 *     game-state s přehozeným `turn`,
 *   - mimo pořadí: bílý táhne první → `error` „nejsi na tahu", žádný push, stav beze změny,
 *   - nelegální tah hráče na tahu → `error`, stav beze změny,
 *   - neúčastník / cizí gameId → `error`, žádná aplikace,
 *   - čtení: GET /games/:id na PvP vrátí 200 PvP DTO,
 *   - izolace kanálů: platný tah nepošle nic po room WS (stav teče jen po game hub).
 *
 * Čeká se deterministicky (sběr zpráv + waitFor), ne arbitrárním sleepem.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/index.js';
import type { GameStateMessage, GameStore, RoomServerMessage } from '../src/index.js';

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
  timeoutMs = 1000,
): Promise<Extract<RoomServerMessage, { type: T }>> {
  await waitFor(() => received.some((m) => m.type === type), timeoutMs);
  const idx = received.findIndex((m) => m.type === type);
  const [msg] = received.splice(idx, 1);
  return msg as Extract<RoomServerMessage, { type: T }>;
}

async function join(
  port: number,
  nick: string,
): Promise<{ ws: WebSocket; id: string; received: RoomServerMessage[] }> {
  const ws = await openRoom(port);
  const received = collectRoom(ws);
  ws.send(JSON.stringify({ type: 'join', nick }));
  const roster = await takeMessage(received, 'roster');
  const mine = roster.players.find((p) => p.nick === nick);
  if (mine === undefined) {
    throw new Error(`vlastní id (${nick}) nebylo v rosteru`);
  }
  return { ws, id: mine.id, received };
}

/** Odběratel herní WS: sbírá game-state pushe (živé pole). */
async function subscribeGame(
  port: number,
  gameId: string,
): Promise<{ ws: WebSocket; received: GameStateMessage[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/ws`);
  openSockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const received: GameStateMessage[] = [];
  ws.on('message', (data: Buffer) => received.push(JSON.parse(data.toString()) as GameStateMessage));
  return { ws, received };
}

function sendMove(ws: WebSocket, gameId: string, from: number, path: number[]): void {
  ws.send(JSON.stringify({ type: 'move', gameId, from, path }));
}

/**
 * Spáruje dva hráče do PvP partie a vrátí je i s otevřenými herními odběry.
 * `black` = vyzyvatel (Alice), `white` = vyzvaný (Bob); černý je na tahu první.
 */
async function pairGame(port: number): Promise<{
  black: { ws: WebSocket; id: string; received: RoomServerMessage[] };
  white: { ws: WebSocket; id: string; received: RoomServerMessage[] };
  gameId: string;
  gameBlack: { ws: WebSocket; received: GameStateMessage[] };
  gameWhite: { ws: WebSocket; received: GameStateMessage[] };
}> {
  const black = await join(port, 'Alice');
  const white = await join(port, 'Bob');
  black.ws.send(JSON.stringify({ type: 'challenge', targetId: white.id }));
  const challenged = await takeMessage(white.received, 'challenged');
  white.ws.send(JSON.stringify({ type: 'accept', challengeId: challenged.challenge.id }));
  const accBlack = await takeMessage(black.received, 'challenge-accepted');
  await takeMessage(white.received, 'challenge-accepted');
  const gameId = accBlack.gameId;
  const gameBlack = await subscribeGame(port, gameId);
  const gameWhite = await subscribeGame(port, gameId);
  return { black, white, gameId, gameBlack, gameWhite };
}

describe('PvP hraní přes room WS – serverová autorita (fáze 70)', () => {
  it('happy: černý na tahu zahraje legální tah → OBA game WS dostanou nový stav, turn přehozen', async () => {
    const port = await start();
    const { black, gameId, gameBlack, gameWhite } = await pairGame(port);

    // 9→13 je legální otevírací tah černého (viz dto.test / reálné legalMoves).
    sendMove(black.ws, gameId, 9, [13]);

    await waitFor(() => gameBlack.received.length >= 1 && gameWhite.received.length >= 1, 2000);
    const forBlack = gameBlack.received[0];
    const forWhite = gameWhite.received[0];
    if (forBlack === undefined || forWhite === undefined) {
      throw new Error('očekávám game-state na obou herních socketech');
    }
    expect(forBlack.type).toBe('game-state');
    expect(forWhite.type).toBe('game-state');
    expect(forBlack.game.mode).toBe('pvp');
    // Po tahu černého je na tahu bílý; kámen se posunul z 9 na 13.
    expect(forBlack.game.position.turn).toBe('white');
    expect(forWhite.game.position.turn).toBe('white');
    expect(forBlack.game.position.board[13 - 1]).toEqual({ color: 'black', kind: 'man' });
    expect(forBlack.game.position.board[9 - 1]).toBeNull();

    // Store je autorita: pozice se opravdu posunula, na tahu bílý.
    const game = gameStore().get(gameId);
    expect(game?.state.position.turn).toBe('white');
  });

  it('mimo pořadí: bílý táhne první → error „nejsi na tahu", žádný push, stav beze změny', async () => {
    const port = await start();
    const { white, gameId, gameBlack, gameWhite } = await pairGame(port);

    // Bílý (21→17 by byl legální tvar), ale na tahu je černý → odmítnout PŘED legalitou.
    sendMove(white.ws, gameId, 21, [17]);

    const err = await takeMessage(white.received, 'error');
    expect(err.message).toMatch(/na tahu/i);

    // Žádný stav se nerozeslal a pozice zůstala výchozí (černý na tahu).
    await delay(50);
    expect(gameBlack.received).toEqual([]);
    expect(gameWhite.received).toEqual([]);
    expect(gameStore().get(gameId)?.state.position.turn).toBe('black');
  });

  it('nelegální tah hráče na tahu → error, stav beze změny', async () => {
    const port = await start();
    const { black, gameId, gameBlack, gameWhite } = await pairGame(port);

    // 9→20 není legální tah (mimo dosah) – černý je na tahu, ale tah je nelegální.
    sendMove(black.ws, gameId, 9, [20]);

    const err = await takeMessage(black.received, 'error');
    expect(err.message).toMatch(/nelegáln/i);

    await delay(50);
    expect(gameBlack.received).toEqual([]);
    expect(gameWhite.received).toEqual([]);
    expect(gameStore().get(gameId)?.state.position.turn).toBe('black');
  });

  it('neúčastník: cizí hráč táhne v partii → error, žádná aplikace', async () => {
    const port = await start();
    const { gameId, gameBlack } = await pairGame(port);
    const cyril = await join(port, 'Cyril');

    // Cyril není hráčem partie (jeho session id není v players) → odmítnout.
    sendMove(cyril.ws, gameId, 9, [13]);

    const err = await takeMessage(cyril.received, 'error');
    expect(err.message).toMatch(/hráčem/i);

    await delay(50);
    expect(gameBlack.received).toEqual([]);
    expect(gameStore().get(gameId)?.state.position.turn).toBe('black');
  });

  it('cizí gameId: tah na neexistující partii → error „partie neexistuje"', async () => {
    const port = await start();
    const { black } = await pairGame(port);

    sendMove(black.ws, 'neexistuje', 9, [13]);
    const err = await takeMessage(black.received, 'error');
    expect(err.message).toMatch(/neexistuje/i);
  });

  it('tvarová chyba: neplatné from/path → error, socket žije', async () => {
    const port = await start();
    const { black, gameId } = await pairGame(port);

    // from mimo 1–32 → schema odmítne PŘED sáhnutím na partii/pozici.
    black.ws.send(JSON.stringify({ type: 'move', gameId, from: 99, path: [13] }));
    const err = await takeMessage(black.received, 'error');
    expect(err.message).toMatch(/neplatný tah/i);

    // Socket dál funguje: legální tah po chybě projde.
    sendMove(black.ws, gameId, 9, [13]);
    await waitFor(() => gameStore().get(gameId)?.state.position.turn === 'white', 2000);
  });

  it('tah před joinem → error „nejdřív vstup", žádná aplikace', async () => {
    const port = await start();
    const { gameId } = await pairGame(port);

    // Nezapsané spojení (žádný join) pošle move → odmítnout, ne aplikovat.
    const ws = await openRoom(port);
    const received = collectRoom(ws);
    sendMove(ws, gameId, 9, [13]);
    const err = await takeMessage(received, 'error');
    expect(err.message).toMatch(/vstup do místnosti/i);
    expect(gameStore().get(gameId)?.state.position.turn).toBe('black');
  });

  it('čtení: GET /games/:id na PvP vrátí 200 PvP DTO', async () => {
    const port = await start();
    const { gameId } = await pairGame(port);

    const res = await app.inject({ method: 'GET', url: `/games/${gameId}` });
    expect(res.statusCode).toBe(200);
    const dto = res.json<Record<string, unknown>>();
    expect(dto.mode).toBe('pvp');
    expect(dto.id).toBe(gameId);
  });

  it('izolace kanálů: platný tah nepošle nic po room WS (stav jen po game hub)', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack, gameWhite } = await pairGame(port);

    sendMove(black.ws, gameId, 9, [13]);
    await waitFor(() => gameBlack.received.length >= 1 && gameWhite.received.length >= 1, 2000);

    // Room sockety obou hráčů nesmí dostat herní stav (game-state teče jen po game hub).
    await delay(50);
    expect(black.received.some((m) => (m as { type: string }).type === 'game-state')).toBe(false);
    expect(white.received.some((m) => (m as { type: string }).type === 'game-state')).toBe(false);
    // A herní sockety nesou VÝHRADNĚ game-state (nic z místnosti/párování).
    for (const m of [...gameBlack.received, ...gameWhite.received]) {
      expect(m.type).toBe('game-state');
    }
  });
});

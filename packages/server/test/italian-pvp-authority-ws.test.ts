/**
 * Integrační ADVERSARIÁLNÍ testy PvP autority nad ITALSKÝMI pravidly přes
 * SKUTEČNÁ WS spojení (fáze 120, IT-10). Server `listen({ port: 0 })` + reální
 * `ws` klienti – stejný harness jako `variant-lobby-ws.test.ts`.
 *
 * Dva testy pokrývají bránu fáze:
 *
 *   1. JÁDRO – VÝBĚR RULESETU PODLE VARIANTY MÍSTNOSTI: v ITALSKÉ PvP partii
 *      pošle nedůvěryhodný klient tah, který by AMERICKÁ pravidla PUSTILA, ale
 *      italská ho odmítají (nemaximální braní). Server (autorita) ho odmítne
 *      (`error` „Nelegální tah") a GameState se NEZMĚNÍ (týž hráč na tahu, žádný
 *      push). Rozlišující tah je americky-legální 1-braní `23x14`; italsky je
 *      povinné 2-braní `22x15x6` (maximum). Kdyby server validoval americky, `23x14`
 *      by PŘIJAL – test tím dokazuje výběr italského rulesetu, ne obecnou nelegalitu
 *      (tu řeší fáze 70). Rozlišující pozice se sehraje LEGÁLNÍMI italskými tahy
 *      z výchozího rozestavění (žádný produkční test-seam do store).
 *
 *   2. E2E – dva klienti odehrají KOMPLETNÍ italskou partii od zahájení do výsledku.
 *      Tahy se generují z `@checkers/rules` (legalMoves ITALIAN, deterministický
 *      výběr) – test NEhardkóduje linii; jádro je „partie doběhne s výsledkem přes
 *      server a protne vynucené MAXIMÁLNÍ braní". Po každém tahu se pozice serveru
 *      porovná s klientovou (autorita = tatáž sdílená pravidla).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

import {
  ITALIAN_RULESET,
  advanceState,
  gameResultFromState,
  initialGameState,
  legalMoves,
  positionKey,
} from '@checkers/rules';
import type { GameState, VariantId } from '@checkers/rules';
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

/** Deterministický PRNG (mulberry32) – bez Math.random, ať je partie opakovatelná. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

async function join(
  port: number,
  nick: string,
  variant: VariantId,
): Promise<{ ws: WebSocket; id: string; received: RoomServerMessage[] }> {
  const ws = await openRoom(port);
  const received = collectRoom(ws);
  ws.send(JSON.stringify({ type: 'connect', nick }));
  await takeMessage(received, 'lobbies');
  ws.send(JSON.stringify({ type: 'enter', variant }));
  const roster = await takeMessage(received, 'roster');
  const mine = roster.players.find((p) => p.nick === nick);
  if (mine === undefined) {
    throw new Error(`vlastní id (${nick}) nebylo v rosteru`);
  }
  return { ws, id: mine.id, received };
}

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

/** Spáruje dvojici v dané lobby; black = vyzyvatel (Alice), white = vyzvaný (Bob). */
async function pair(
  port: number,
  variant: VariantId,
): Promise<{
  black: { ws: WebSocket; id: string; received: RoomServerMessage[] };
  white: { ws: WebSocket; id: string; received: RoomServerMessage[] };
  gameId: string;
  gameBlack: { ws: WebSocket; received: GameStateMessage[] };
  gameWhite: { ws: WebSocket; received: GameStateMessage[] };
}> {
  const black = await join(port, 'Alice', variant);
  const white = await join(port, 'Bob', variant);
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

/** Odehraje tah a počká, až ho store zapíše (deterministicky, ne sleepem). */
async function playAndWait(
  ws: WebSocket,
  gameId: string,
  from: number,
  path: number[],
  expectedMoveCount: number,
): Promise<void> {
  sendMove(ws, gameId, from, path);
  await waitFor(() => (gameStore().get(gameId)?.moves.length ?? 0) >= expectedMoveCount, 4000);
}

describe('Italská PvP autorita – server odmítne italsky-nelegální tah (fáze 120)', () => {
  it('nemaximální braní: americky legální 23x14 server v italské partii ODMÍTNE, vynutí maximum 22x15x6', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack, gameWhite } = await pair(port, 'italian');

    // Partie nese variantu lobby → server validuje ITALIAN_RULESET.
    expect(gameStore().get(gameId)?.state.variant).toBe('italian');

    // Dojezd do rozlišující pozice LEGÁLNÍMI italskými tahy (žádný store-seam).
    await playAndWait(black.ws, gameId, 9, [13], 1);
    await playAndWait(white.ws, gameId, 21, [17], 2);
    await playAndWait(black.ws, gameId, 6, [9], 3);
    await playAndWait(white.ws, gameId, 17, [14], 4);
    await playAndWait(black.ws, gameId, 9, [18], 5); // černý bere 14, dopad na 18
    expect(gameStore().get(gameId)?.state.position.turn).toBe('white');

    // Vyčisti dosavadní game-state pushe, ať měříme jen následující (odmítnutý) tah.
    gameBlack.received.length = 0;
    gameWhite.received.length = 0;

    // Americky legální 1-braní 23x14 je v ITALSKÉ partii NEMAXIMÁLNÍ (existuje
    // 2-braní 22x15x6). Server v italské partii MUSÍ odmítnout. Kdyby validoval
    // americky, přijal by ho → tah zůstane 5 a jsou zuby na wiring.
    sendMove(white.ws, gameId, 23, [14]);
    const err = await takeMessage(white.received, 'error');
    expect(err.message).toMatch(/nelegáln/i);
    await delay(50);
    // GameState se NEZMĚNIL: pořád 5 tahů, na tahu týž hráč, žádný push.
    expect(gameStore().get(gameId)?.moves.length).toBe(5);
    expect(gameStore().get(gameId)?.state.position.turn).toBe('white');
    expect(gameBlack.received).toEqual([]);
    expect(gameWhite.received).toEqual([]);

    // Italské maximum 22x15x6 (bere 18 i 10) server PŘIJME.
    await playAndWait(white.ws, gameId, 22, [15, 6], 6);
    const game = gameStore().get(gameId);
    expect(game?.state.position.turn).toBe('black');
    expect(game?.state.position.board[18 - 1]).toBeNull(); // 18 sebrán
    expect(game?.state.position.board[10 - 1]).toBeNull(); // 10 sebrán
    expect(game?.state.position.board[6 - 1]).toEqual({ color: 'white', kind: 'man' });
  });
});

describe('Italská PvP E2E – dva klienti odehrají kompletní partii (fáze 120)', () => {
  it('partie doběhne s výsledkem přes server a protne vynucené MAXIMÁLNÍ braní', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack, gameWhite } = await pair(port, 'italian');
    expect(gameStore().get(gameId)?.state.variant).toBe('italian');

    // Deterministický výběr tahu (fixní seed). Legalitu KAŽDÉHO tahu bere z
    // @checkers/rules, takže linie není hardkódovaná – při změně pravidel se
    // přepočítá; jádro (doběhne s výsledkem přes server) platí dál.
    const rand = mulberry32(1871);
    let local: GameState = initialGameState(undefined, 'italian');
    let moveCount = 0;
    let sawMandatoryCapture = false; // ply, kde jsou VŠECHNY tahy braním (povinné)
    let sawMaximumChain = false; // vybráno vícenásobné braní (maximum > 1)
    const CAP = 300;

    while (gameResultFromState(local) === 'ongoing' && moveCount < CAP) {
      const moves = legalMoves(local.position, ITALIAN_RULESET);
      expect(moves.length).toBeGreaterThan(0);
      if (moves.every((m) => m.captures.length > 0)) {
        sawMandatoryCapture = true;
      }
      const move = moves[Math.floor(rand() * moves.length)]!;
      if (move.captures.length >= 2) {
        sawMaximumChain = true;
      }
      const mover = local.position.turn === 'black' ? black.ws : white.ws;
      await playAndWait(mover, gameId, move.from, [...move.path], moveCount + 1);

      // Autorita = tatáž pravidla: server i klient mají po tahu shodnou pozici.
      local = advanceState(local, move);
      const serverPos = gameStore().get(gameId)!.state.position;
      expect(positionKey(serverPos)).toBe(positionKey(local.position));
      moveCount++;
    }

    // Partie doběhla VÝSLEDKEM (ne o strop) a protla vynucené maximum.
    expect(moveCount).toBeLessThan(CAP);
    const result = gameResultFromState(local);
    expect(result).not.toBe('ongoing');
    expect(sawMandatoryCapture).toBe(true);
    expect(sawMaximumChain).toBe(true);

    // Server rozeslal TERMINÁLNÍ výsledek OBĚMA klientům (poslední push nese výsledek).
    await waitFor(() => gameBlack.received.at(-1)?.game.result === result);
    await waitFor(() => gameWhite.received.at(-1)?.game.result === result);
  });
});

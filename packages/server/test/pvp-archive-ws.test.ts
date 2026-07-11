/**
 * Integrační test PDN archivace dokončených PvP partií (fáze 92) přes SKUTEČNÁ
 * WS spojení + reálný zápis na disk. Archivace visí na broadcast choke pointu,
 * takže tady jde o KONTRAKT nad reálným room WS tokem: každý ze tří terminálních
 * konců (vzdání / dohodnutá remíza / přirozený konec dle pravidel) zapíše právě
 * jeden anonymní PDN; rozehraná partie se NEarchivuje; bez `pdnDir` se nepíše nic.
 *
 * Determinismus: `now` i `pdnDir` se injektují do `buildApp`. Terminální herní
 * linie pro „přirozený konec" se NEhardkóduje – dopočítá se za běhu ze stejné
 * knihovny `rules`, kterou validuje server, takže test drží krok se změnami
 * pořadí tahů v enginu.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

import {
  advanceState,
  gameResultFromState,
  initialGameState,
  legalMoves,
} from '@checkers/rules';
import type { GameResult, Move } from '@checkers/rules';
import { buildApp } from '../src/index.js';
import type { GameStateMessage, GameStore, RoomServerMessage } from '../src/index.js';

let app: FastifyInstance;
let pdnDir: string;
const openSockets: WebSocket[] = [];

// Pevný okamžik pro tagy UTC v PDN (bez závislosti na dnešku i zóně serveru).
const FIXED_NOW = new Date(Date.UTC(2026, 6, 11, 8, 9, 10)); // 2026.07.11 / 08:09:10

afterEach(async () => {
  for (const ws of openSockets) {
    ws.close();
  }
  openSockets.length = 0;
  await app.close();
  await rm(pdnDir, { recursive: true, force: true });
});

/** Nastartuje server s injektovaným archivačním adresářem a pevným časem. */
async function start(opts: { archive: boolean } = { archive: true }): Promise<number> {
  pdnDir = await mkdtemp(joinPath(tmpdir(), 'checkers-pdn-'));
  app = buildApp(opts.archive ? { pdnDir, now: () => FIXED_NOW } : { now: () => FIXED_NOW });
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

/** Spáruje dva hráče do PvP partie (Alice = černá začíná, Bob = bílá). */
async function pairGame(port: number): Promise<{
  black: { ws: WebSocket; id: string; received: RoomServerMessage[] };
  white: { ws: WebSocket; id: string; received: RoomServerMessage[] };
  gameId: string;
  gameBlack: { ws: WebSocket; received: GameStateMessage[] };
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
  return { black, white, gameId, gameBlack };
}

const sendResign = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'resign', gameId }));
const sendDrawOffer = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'draw-offer', gameId }));
const sendDrawAccept = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'draw-accept', gameId }));
const sendMove = (ws: WebSocket, gameId: string, mv: Move): void =>
  ws.send(JSON.stringify({ type: 'move', gameId, from: mv.from, path: mv.path }));

/** PDN soubory v archivním adresáři. */
async function pdnFiles(): Promise<string[]> {
  const entries = await readdir(pdnDir);
  return entries.filter((f) => f.endsWith('.pdn'));
}

/**
 * Přečte PDN dané partie. Zápis je best-effort a asynchronní (fire-and-forget za
 * broadcastem), takže na existenci souboru se čeká pollingem – `readFile` hází,
 * dokud soubor není, pak vrátí obsah.
 */
async function readPdn(gameId: string): Promise<string> {
  const path = joinPath(pdnDir, `${gameId}.pdn`);
  for (let i = 0; i < 400; i++) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      await delay(5);
    }
  }
  throw new Error(`PDN partie ${gameId} nevznikl do timeoutu`);
}

/**
 * Dopočítá terminální linii tahů ze startu (politika „poslední legální tah"
 * dává v tomto enginu rozhodnutý konec ~44 půltahy). Vrací tahy i výsledek.
 */
function computeTerminalLine(): { moves: Move[]; result: GameResult } {
  let state = initialGameState();
  const moves: Move[] = [];
  for (let ply = 0; ply < 300; ply++) {
    const res = gameResultFromState(state);
    if (res !== 'ongoing') {
      return { moves, result: res };
    }
    const legal = legalMoves(state.position);
    const mv = legal[legal.length - 1];
    if (mv === undefined) {
      return { moves, result: gameResultFromState(state) };
    }
    moves.push(mv);
    state = advanceState(state, mv);
  }
  throw new Error('linie nedospěla do terminálu do 300 půltahů');
}

/** Odehraje danou linii přes WS; černý táhne na sudých plyech, bílý na lichých. */
async function playLine(
  blackWs: WebSocket,
  whiteWs: WebSocket,
  gameId: string,
  moves: Move[],
): Promise<void> {
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i]!;
    sendMove(i % 2 === 0 ? blackWs : whiteWs, gameId, mv);
    const expected = i + 1;
    await waitFor(() => (gameStore().get(gameId)?.moves.length ?? 0) >= expected, 4000);
  }
}

describe('PvP archivace do PDN – vzdání (fáze 92)', () => {
  it('černý se vzdá → právě jeden anonymní PDN se správným formátem a výsledkem', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack } = await pairGame(port);

    // Pár tahů, ať má movetext obsah (černý 11-15, bílý 22-18).
    sendMove(black.ws, gameId, { from: 11, path: [15], captures: [] });
    await waitFor(() => gameStore().get(gameId)?.state.position.turn === 'white');
    sendMove(white.ws, gameId, { from: 22, path: [18], captures: [] });
    await waitFor(() => gameStore().get(gameId)?.state.position.turn === 'black');

    sendResign(black.ws, gameId);
    await waitFor(() => gameBlack.received.some((m) => m.game.result === 'white-wins'));

    const pdn = await readPdn(gameId);
    expect(pdn).toContain('[Event "American Checkers"]');
    expect(pdn).toContain('[UTCDate "2026.07.11"]');
    expect(pdn).toContain('[UTCTime "08:09:10"]');
    expect(pdn).toContain('[White "?"]');
    expect(pdn).toContain('[Black "?"]');
    expect(pdn).not.toContain('Alice');
    expect(pdn).not.toContain('Bob');
    // Vzdal se černý → bílý vyhrál → token 1-0.
    expect(pdn).toContain('[Result "1-0"]');
    // Tahy pod sebou: první číslovaný tah na vlastním řádku.
    expect(pdn).toMatch(/\n1\. 11-15 22-18\n/);
    expect(pdn.trimEnd().endsWith('\n1-0')).toBe(true);

    expect(await pdnFiles()).toHaveLength(1);
    // Guard: partie je označená archivovanou → případný další broadcast už nepíše.
    expect(gameStore().get(gameId)?.archived).toBe(true);
    expect(gameStore().markArchived(gameId)).toBe(false);
  });
});

describe('PvP archivace do PDN – dohodnutá remíza (fáze 92)', () => {
  it('přijatá nabídka remízy → právě jeden PDN s tokenem 1/2-1/2', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack } = await pairGame(port);

    sendDrawOffer(black.ws, gameId);
    await takeMessage(white.received, 'draw-offered');
    sendDrawAccept(white.ws, gameId);
    await waitFor(() => gameBlack.received.some((m) => m.game.result === 'draw'));

    const pdn = await readPdn(gameId);
    expect(pdn).toContain('[Event "American Checkers"]');
    expect(pdn).toContain('[Result "1/2-1/2"]');
    expect(pdn.trimEnd().endsWith('1/2-1/2')).toBe(true);
    expect(await pdnFiles()).toHaveLength(1);
    expect(gameStore().markArchived(gameId)).toBe(false);
  });
});

describe('PvP archivace do PDN – přirozený konec dle pravidel (fáze 92)', () => {
  it('dohraná partie do terminálu → právě jeden PDN s výsledkem z pozice', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack } = await pairGame(port);

    const line = computeTerminalLine();
    expect(line.result).not.toBe('ongoing');
    await playLine(black.ws, white.ws, gameId, line.moves);

    await waitFor(() => gameBlack.received.some((m) => m.game.result === line.result), 4000);

    const pdn = await readPdn(gameId);
    expect(pdn).toContain('[Event "American Checkers"]');
    const expectedToken =
      line.result === 'white-wins' ? '1-0' : line.result === 'black-wins' ? '0-1' : '1/2-1/2';
    expect(pdn).toContain(`[Result "${expectedToken}"]`);
    // Movetext má víc řádků (víc než jeden číslovaný tah pod sebou).
    const movetext = pdn.split('\n\n')[1]?.trimEnd() ?? '';
    expect(movetext.split('\n').length).toBeGreaterThan(2);
    expect(await pdnFiles()).toHaveLength(1);

    // Idempotence proti dalšímu dění: tah po konci server odmítne a nic nepřepíše.
    sendMove(black.ws, gameId, { from: 11, path: [15], captures: [] });
    await delay(50);
    expect(await pdnFiles()).toHaveLength(1);
    expect(gameStore().markArchived(gameId)).toBe(false);
  });
});

describe('PvP archivace do PDN – co se NEarchivuje (fáze 92)', () => {
  it('rozehraná (ongoing) partie se NEarchivuje ani po tazích', async () => {
    const port = await start();
    const { black, white, gameId } = await pairGame(port);

    sendMove(black.ws, gameId, { from: 11, path: [15], captures: [] });
    await waitFor(() => gameStore().get(gameId)?.state.position.turn === 'white');
    sendMove(white.ws, gameId, { from: 22, path: [18], captures: [] });
    await waitFor(() => gameStore().get(gameId)?.state.position.turn === 'black');

    await delay(50);
    expect(gameStore().get(gameId)?.archived).toBe(false);
    expect(await pdnFiles()).toEqual([]);
  });

  it('bez pdnDir se nezapíše nic ani po terminálním konci', async () => {
    const port = await start({ archive: false });
    const { black, gameId, gameBlack } = await pairGame(port);

    sendResign(black.ws, gameId);
    await waitFor(() => gameBlack.received.some((m) => m.game.result === 'white-wins'));

    await delay(50);
    // pdnDir (dočasný adresář) zůstává prázdný – archiv je vypnutý.
    expect(await pdnFiles()).toEqual([]);
    // Partie se ani neoznačí archivovanou (maybeArchive se bez pdnDir hned vrátí).
    expect(gameStore().get(gameId)?.archived).toBe(false);
  });
});

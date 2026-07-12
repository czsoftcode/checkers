/**
 * Integrační testy ČTYŘ varianta-lobby (fáze 103) přes SKUTEČNÁ WS spojení:
 * server `listen({ port: 0 })` + reální `ws` klienti (app.inject WS neumí).
 *
 * Brána fáze 103:
 *   - PARTITION: hráči TÉŽE varianty se vidí, vyzvou a odehrají partii; partie
 *     nese variantu lobby (`state.variant`),
 *   - CROSS-VARIANT REJECT: hráč jedné lobby nevidí ani nevyzve hráče jiné lobby,
 *   - NELEGÁLNÍ TAH V DANÉ VARIANTĚ: server (autorita) ověřuje tah pravidly
 *     VARIANTY záznamu. Rozhodující fixtura – ruský muž bere i dozadu a braní se
 *     řetězí: v pozici po `9-14 / 22-17 / 10-15` má bílý JEDINÝ ruský legální tah
 *     `17x10x19` (dvojbraní), zatímco americké pravidlo dá jen `17x10`. Server
 *     v RUSKÉ partii tedy MUSÍ americký `17x10` odmítnout a ruský `17x10x19`
 *     přijmout – kdyby validoval americky, oba verdikty se obrátí (zuby na wiring),
 *   - ZPĚTNÁ KOMPATIBILITA: join BEZ varianty → americká lobby (echo v `roster`),
 *   - SWITCH-LOBBY: přechod bez ztráty identity; odmítnut během partie,
 *   - PDN varianty: dokončená ruská partie zapíše `[Variant "russian"]`.
 *
 * Čeká se deterministicky (sběr zpráv + waitFor na dekorovaný store/registr),
 * ne arbitrárním sleepem (jinak flaky).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

import type { VariantId } from '@checkers/rules';
import { buildApp } from '../src/index.js';
import type { GameStateMessage, GameStore, Lobbies, RoomServerMessage } from '../src/index.js';

let app: FastifyInstance;
let pdnDir: string | undefined;
const openSockets: WebSocket[] = [];

const FIXED_NOW = new Date(Date.UTC(2026, 6, 11, 8, 9, 10)); // 2026.07.11 / 08:09:10

afterEach(async () => {
  for (const ws of openSockets) {
    ws.close();
  }
  openSockets.length = 0;
  await app.close();
  if (pdnDir !== undefined) {
    await rm(pdnDir, { recursive: true, force: true });
    pdnDir = undefined;
  }
});

async function start(opts: { archive?: boolean } = {}): Promise<number> {
  if (opts.archive) {
    pdnDir = await mkdtemp(joinPath(tmpdir(), 'checkers-variant-pdn-'));
    app = buildApp({ pdnDir, now: () => FIXED_NOW });
  } else {
    app = buildApp();
  }
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

function gameStore(): GameStore {
  return (app as unknown as { gameStore: GameStore }).gameStore;
}
function lobbies(): Lobbies {
  return (app as unknown as { lobbies: Lobbies }).lobbies;
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

/** Připojí hráče do lobby `variant` (nebo BEZ varianty, když `variant===undefined`). */
async function join(
  port: number,
  nick: string,
  variant?: VariantId,
): Promise<{
  ws: WebSocket;
  id: string;
  received: RoomServerMessage[];
  roster: Extract<RoomServerMessage, { type: 'roster' }>;
}> {
  const ws = await openRoom(port);
  const received = collectRoom(ws);
  ws.send(JSON.stringify(variant === undefined ? { type: 'join', nick } : { type: 'join', nick, variant }));
  const roster = await takeMessage(received, 'roster');
  const mine = roster.players.find((p) => p.nick === nick);
  if (mine === undefined) {
    throw new Error(`vlastní id (${nick}) nebylo v rosteru`);
  }
  return { ws, id: mine.id, received, roster };
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

describe('Varianta-lobby – partition a partie v lobby (fáze 103)', () => {
  it('hráči téže varianty se vidí, vyzvou a odehrají partii; partie nese variantu', async () => {
    const port = await start();
    const { black, gameId } = await pair(port, 'russian');

    // Partie vznikla ve store s variantou lobby.
    const game = gameStore().get(gameId);
    expect(game?.mode).toBe('pvp');
    expect(game?.state.variant).toBe('russian');

    // Legální otevírací tah černého (9-14) projde a stav se posune (na tahu bílý).
    await playAndWait(black.ws, gameId, 9, [14], 1);
    expect(gameStore().get(gameId)?.state.position.turn).toBe('white');
  });

  it('roster nese echo varianty lobby', async () => {
    const port = await start();
    const a = await join(port, 'Alice', 'czech');
    expect(a.roster.variant).toBe('czech');
  });
});

describe('Varianta-lobby – cross-variant izolace (fáze 103)', () => {
  it('hráč jedné lobby nevidí ani nevyzve hráče jiné lobby', async () => {
    const port = await start();
    const alice = await join(port, 'Alice', 'russian');
    const bob = await join(port, 'Bob', 'american');

    // Roster každého obsahuje jen jeho lobby (druhý tam není).
    expect(alice.roster.players.map((p) => p.nick)).toEqual(['Alice']);
    expect(bob.roster.players.map((p) => p.nick)).toEqual(['Bob']);

    // Cross-variant výzva padne přirozeně: Bob není v Alicině (ruské) lobby.
    alice.ws.send(JSON.stringify({ type: 'challenge', targetId: bob.id }));
    const err = await takeMessage(alice.received, 'error');
    expect(err.message).toMatch(/není v místnosti/i);
    // Žádná výzva nevznikla, nikdo není busy.
    await delay(50);
    expect(bob.received.some((m) => m.type === 'challenged')).toBe(false);
  });
});

describe('Varianta-lobby – autorita: nelegální tah v dané variantě (fáze 103)', () => {
  it('ruská partie: americké dvoj­braní pravidlo neplatí – server vynutí ruský řetěz braní', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack, gameWhite } = await pair(port, 'russian');

    // Dojezd do pozice s ruským braním vzad: 9-14 (Č), 22-17 (B), 10-15 (Č).
    await playAndWait(black.ws, gameId, 9, [14], 1);
    await playAndWait(white.ws, gameId, 22, [17], 2);
    await playAndWait(black.ws, gameId, 10, [15], 3);
    expect(gameStore().get(gameId)?.state.position.turn).toBe('white');

    // Vyčisti dosavadní game-state pushe, ať měříme jen následující tah.
    gameBlack.received.length = 0;
    gameWhite.received.length = 0;

    // Americký (jednoduchý) sken `17x10` je v RUSKÉ partii NELEGÁLNÍ (braní se
    // řetězí na 19). Kdyby server validoval americky, přijal by ho → tah zůstane 3.
    sendMove(white.ws, gameId, 17, [10]);
    const err = await takeMessage(white.received, 'error');
    expect(err.message).toMatch(/nelegáln/i);
    await delay(50);
    expect(gameStore().get(gameId)?.moves.length).toBe(3);
    expect(gameBlack.received).toEqual([]); // stav se nezměnil, žádný push

    // Ruský plný řetěz `17x10x19` (bere 14 i 15) server PŘIJME.
    await playAndWait(white.ws, gameId, 17, [10, 19], 4);
    const game = gameStore().get(gameId);
    expect(game?.state.position.turn).toBe('black');
    // Obě brané pole jsou pryč, bílý muž dojel na 19.
    expect(game?.state.position.board[14 - 1]).toBeNull();
    expect(game?.state.position.board[15 - 1]).toBeNull();
    expect(game?.state.position.board[19 - 1]).toEqual({ color: 'white', kind: 'man' });
  });
});

describe('Varianta-lobby – zpětná kompatibilita joinu (fáze 103)', () => {
  it('join BEZ varianty → americká lobby (echo american v rosteru)', async () => {
    const port = await start();
    const a = await join(port, 'Alice'); // bez varianty (stávající klient)
    expect(a.roster.variant).toBe('american');
    expect(lobbies().variantOf(a.id)).toBe('american');
    // Dekorace `roomPresence` ukazuje na americkou lobby – hráč tam je.
    expect(lobbies().room('american').has(a.id)).toBe(true);
  });

  it('neznámá varianta v joinu → degraduje na american (žádný pád)', async () => {
    const port = await start();
    const ws = await openRoom(port);
    const received = collectRoom(ws);
    ws.send(JSON.stringify({ type: 'join', nick: 'Alice', variant: 'klingonská' }));
    const roster = await takeMessage(received, 'roster');
    expect(roster.type).toBe('roster');
    if (roster.type !== 'roster') return;
    expect(roster.variant).toBe('american');
  });
});

describe('Varianta-lobby – switch-lobby (fáze 103)', () => {
  it('přechod do jiné lobby bez ztráty identity; stará dostane left, nová roster', async () => {
    const port = await start();
    const bob = await join(port, 'Bob', 'american'); // zůstane v americké
    const alice = await join(port, 'Alice', 'american');
    // Bob poslouchá odchod Alice ze své lobby.
    bob.received.length = 0;

    alice.ws.send(JSON.stringify({ type: 'switch-lobby', variant: 'russian' }));
    const roster = await takeMessage(alice.received, 'roster');
    expect(roster.variant).toBe('russian');
    expect(roster.players.map((p) => p.nick)).toEqual(['Alice']);

    // Identita zůstala (stejné id), jen se přesunulo členství.
    expect(lobbies().variantOf(alice.id)).toBe('russian');
    expect(lobbies().room('american').has(alice.id)).toBe(false);
    expect(lobbies().room('russian').has(alice.id)).toBe(true);

    // Bob (v americké) dostal left(Alice).
    const left = await takeMessage(bob.received, 'left');
    expect(left.player.id).toBe(alice.id);
  });

  it('přechod ruší čekající výzvu → cross-variant partie NEvznikne, protějšek dostane cancel', async () => {
    const port = await start();
    const alice = await join(port, 'Alice', 'american');
    const bob = await join(port, 'Bob', 'american');

    // Alice vyzve Boba (oba american). Výzva čeká, nikdo není busy.
    alice.ws.send(JSON.stringify({ type: 'challenge', targetId: bob.id }));
    const challenged = await takeMessage(bob.received, 'challenged');

    // Bob přepne do ruské lobby DŘÍV, než přijme. Alicina výzva na Boba musí zaniknout.
    bob.ws.send(JSON.stringify({ type: 'switch-lobby', variant: 'russian' }));
    await takeMessage(bob.received, 'roster'); // Bob je v ruské
    const cancelled = await takeMessage(alice.received, 'challenge-cancelled');
    expect(cancelled.challengeId).toBe(challenged.challenge.id);

    // Pozdní přijetí staré výzvy → error, ŽÁDNÁ (cross-variant) partie nevznikne.
    bob.ws.send(JSON.stringify({ type: 'accept', challengeId: challenged.challenge.id }));
    const err = await takeMessage(bob.received, 'error');
    expect(err.message).toMatch(/neplat/i);
    await delay(50);
    expect(alice.received.some((m) => m.type === 'challenge-accepted')).toBe(false);
    expect(bob.received.some((m) => m.type === 'challenge-accepted')).toBe(false);
  });

  it('switch-lobby během partie je odmítnut (busy)', async () => {
    const port = await start();
    const { black } = await pair(port, 'american');
    // Alice (černá) právě hraje → přechod do jiné lobby zamítnut.
    black.ws.send(JSON.stringify({ type: 'switch-lobby', variant: 'russian' }));
    const err = await takeMessage(black.received, 'error');
    expect(err.message).toMatch(/během partie/i);
    // Zůstala v americké lobby.
    expect(lobbies().variantOf(black.id)).toBe('american');
  });
});

describe('Varianta-lobby – all-roster broadcast akordeonu (fáze 104)', () => {
  it('změna v lobby A dorazí socketu v lobby B (snímek nese všechny 4 lobby)', async () => {
    const port = await start();
    const alice = await join(port, 'Alice', 'american');
    const bob = await join(port, 'Bob', 'russian');
    // Bob (ruská lobby) sleduje změny prezence napříč lobby – vyčisti dosavadní zprávy.
    bob.received.length = 0;

    // Carol vstoupí do AMERICKÉ lobby (jiná než Bobova ruská).
    const carol = await join(port, 'Carol', 'american');

    // Bob dostane all-roster snímek, i když je v JINÉ lobby – to je jádro fáze 104
    // (bez broadcastu by Bob o Carol vůbec nevěděl).
    const snapshot = await takeMessage(bob.received, 'lobbies');
    expect(snapshot.lobbies.map((l) => l.variant).sort()).toEqual([
      'american',
      'czech',
      'pool',
      'russian',
    ]);
    const american = snapshot.lobbies.find((l) => l.variant === 'american');
    expect(american?.players.map((p) => p.nick).sort()).toEqual(['Alice', 'Carol']);
    const russian = snapshot.lobbies.find((l) => l.variant === 'russian');
    expect(russian?.players.map((p) => p.nick)).toEqual(['Bob']);
    void alice;
    void carol;
  });

  it('odchod z lobby A aktualizuje all-roster snímek v lobby B', async () => {
    const port = await start();
    const alice = await join(port, 'Alice', 'american');
    const bob = await join(port, 'Bob', 'russian');
    bob.received.length = 0;

    alice.ws.close();

    // Bob (ruská) dostane snímek s PRÁZDNOU americkou lobby (Alice odešla).
    await waitFor(() =>
      bob.received.some(
        (m) =>
          m.type === 'lobbies' &&
          (m.lobbies.find((l) => l.variant === 'american')?.players.length ?? -1) === 0,
      ),
    );
  });

  it('switch-lobby aktualizuje snímek u nezúčastněného pozorovatele', async () => {
    const port = await start();
    const observer = await join(port, 'Obs', 'czech'); // stojí v české, jen kouká
    const mover = await join(port, 'Mover', 'american');
    observer.received.length = 0;

    mover.ws.send(JSON.stringify({ type: 'switch-lobby', variant: 'pool' }));

    // Pozorovatel v české lobby uvidí snímek, kde Mover je v pool a v american není.
    await waitFor(() =>
      observer.received.some((m) => {
        if (m.type !== 'lobbies') return false;
        const pool = m.lobbies.find((l) => l.variant === 'pool');
        const american = m.lobbies.find((l) => l.variant === 'american');
        return (
          pool?.players.some((p) => p.nick === 'Mover') === true &&
          american?.players.some((p) => p.nick === 'Mover') !== true
        );
      }),
    );
  });
});

describe('Varianta-lobby – PDN nese variantu (fáze 103)', () => {
  it('dokončená ruská partie zapíše [Variant "russian"] a odpovídající Event', async () => {
    const port = await start({ archive: true });
    const { black, gameId, gameBlack } = await pair(port, 'russian');

    // Pár tahů pro obsah movetextu, pak se černý vzdá → terminální konec → archiv.
    await playAndWait(black.ws, gameId, 9, [14], 1);
    black.ws.send(JSON.stringify({ type: 'resign', gameId }));
    await waitFor(() => gameBlack.received.some((m) => m.game.result === 'white-wins'));

    const path = joinPath(pdnDir!, `${gameId}.pdn`);
    let pdn = '';
    for (let i = 0; i < 400; i++) {
      try {
        pdn = await readFile(path, 'utf8');
        break;
      } catch {
        await delay(5);
      }
    }
    expect(pdn).toContain('[Variant "russian"]');
    expect(pdn).toContain('[Event "Russian Draughts"]');
    expect(pdn).toContain('[Result "1-0"]'); // černý se vzdal → bílý vyhrál
    const files = (await readdir(pdnDir!)).filter((f) => f.endsWith('.pdn'));
    expect(files).toHaveLength(1);
  });
});

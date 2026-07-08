/**
 * Integrační test WS transportu (fáze 66) přes SKUTEČNÉ spojení: server
 * `listen({ port: 0 })` + reálný `ws` klient. `app.inject` WS neumí, proto se
 * mutace (tah / vzdání / remíza) posílají REST cestou přes inject a push se
 * čeká na reálném socketu – oboje běží nad TÝMŽ app/hubem v jednom procesu.
 *
 * Zuby:
 *   - dva odběratelé téže partie dostanou po tahu OBA game-state se stejným
 *     stavem, jaký vrátil REST (kdyby broadcast neposílal / posílal jinak, padne),
 *   - odběratel JINÉ partie nedostane NIC (izolace dvojice – kdyby hub izolaci
 *     nedělal, padne),
 *   - push i po vzdání, po přijaté remíze a po tahu enginu (ne jen po /moves),
 *   - `close` odhlásí socket (subscriberCount klesne – kdyby route close
 *     handler chyběl, mapa by o mrtvý socket rostla a tohle padne).
 *
 * Registrace odběru se čeká deterministicky přes `gameHub.subscriberCount`
 * (dekorace app), ne arbitrárním sleepem – jinak by test byl flaky.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

import { legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import type { EngineMover, GameDto, GameHub, GameStateMessage, OpeningBook } from '../src/index.js';

// Prázdná kniha: engine-move test nesmí zkratovat knižní tah (viz engine-move.test.ts).
const NO_BOOK: OpeningBook = new Map();

/** Stub enginu: bestmove = první legální tah, evaluate = skóre 0 (→ remíza přijata). */
const stubEngine: EngineMover = {
  bestmove: (position: Position): Promise<Move> => {
    const move = legalMoves(position)[0];
    return move === undefined
      ? Promise.reject(new Error('stub: pozice bez tahu'))
      : Promise.resolve(move);
  },
  evaluate: () => Promise.resolve({ score: 0 }),
};

/** Stub enginu, který při hledání tahu spadne – ověřuje push stavu `error`. */
const crashingEngine: EngineMover = {
  bestmove: () => Promise.reject(new Error('stub: engine spadl')),
  evaluate: () => Promise.resolve({ score: 0 }),
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let app: FastifyInstance;
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of openSockets) {
    ws.close();
  }
  openSockets.length = 0;
  await app.close();
});

/** Nastartuje app na náhodném portu; vrátí port. */
async function start(opts: Parameters<typeof buildApp>[0] = {}): Promise<number> {
  app = buildApp({ openingBook: NO_BOOK, ...opts });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

/** Přístup k dekorovanému hubu (diagnostika – počet odběratelů). */
function hub(): GameHub {
  return (app as unknown as { gameHub: GameHub }).gameHub;
}

async function createGame(): Promise<GameDto> {
  const res = await app.inject({ method: 'POST', url: '/games' });
  return res.json<GameDto>();
}

function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (pred()) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor: podmínka nenastala do timeoutu'));
      } else {
        setTimeout(tick, 10);
      }
    };
    tick();
  });
}

/**
 * Připojí WS klienta k partii a POČKÁ, až ho server zaregistruje (subscriberCount
 * dosáhne `expectedCount`). Deterministické – bez arbitrárního sleepu.
 */
async function subscribe(port: number, id: string, expectedCount: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/games/${id}/ws`);
  openSockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  await waitFor(() => hub().subscriberCount(id) >= expectedCount);
  return ws;
}

/** Vrátí příští zprávu socketu jako parsovanou obálku (nebo padne timeoutem). */
function nextMessage(ws: WebSocket, timeoutMs = 1000): Promise<GameStateMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS: žádná zpráva do timeoutu')), timeoutMs);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as GameStateMessage);
    });
  });
}

/** Sbírá VŠECHNY zprávy socketu do pole (pro ověření „nic nedorazilo"). */
function collectMessages(ws: WebSocket): string[] {
  const received: string[] = [];
  ws.on('message', (data: Buffer) => received.push(data.toString()));
  return received;
}

async function playFirstMove(id: string): Promise<GameDto> {
  const game = await app.inject({ method: 'GET', url: `/games/${id}` }).then((r) => r.json<GameDto>());
  const first = game.legalMoves[0];
  if (first === undefined) {
    throw new Error('výchozí partie musí mít legální tah');
  }
  const res = await app.inject({
    method: 'POST',
    url: `/games/${id}/moves`,
    payload: { from: first.from, path: first.path },
  });
  expect(res.statusCode).toBe(200);
  return res.json<GameDto>();
}

describe('WS push – manuální režim (bez enginu)', () => {
  it('po tahu dostanou OBA odběratelé téže partie stejný stav jako REST', async () => {
    const port = await start();
    const game = await createGame();
    const wsA = await subscribe(port, game.id, 1);
    const wsB = await subscribe(port, game.id, 2);

    const msgA = nextMessage(wsA);
    const msgB = nextMessage(wsB);
    const restState = await playFirstMove(game.id);

    const [a, b] = await Promise.all([msgA, msgB]);
    expect(a.type).toBe('game-state');
    expect(b.type).toBe('game-state');
    // Push nese PŘESNĚ stav z REST odpovědi – ne starý, ne jiný tvar.
    expect(a.game).toEqual(restState);
    expect(b.game).toEqual(restState);
  });

  it('odběratel JINÉ partie nedostane nic (izolace dvojice)', async () => {
    const port = await start();
    const game1 = await createGame();
    const game2 = await createGame();
    const ws1 = await subscribe(port, game1.id, 1);
    const wsOther = await subscribe(port, game2.id, 1);

    const otherReceived = collectMessages(wsOther);
    const msg1 = nextMessage(ws1);
    await playFirstMove(game1.id);
    await msg1; // tah v partii 1 dorazil jejímu odběrateli

    await delay(50); // dost času, aby případný errantní push do partie 2 dorazil
    expect(otherReceived).toEqual([]); // cizí partie nedostala NIC
  });

  it('push po vzdání partie', async () => {
    const port = await start();
    const game = await createGame();
    const ws = await subscribe(port, game.id, 1);

    const msg = nextMessage(ws);
    const res = await app.inject({ method: 'POST', url: `/games/${game.id}/resign` });
    expect(res.statusCode).toBe(200);

    const pushed = await msg;
    expect(pushed.type).toBe('game-state');
    expect(pushed.game.result).not.toBe('ongoing'); // odběratel vidí konec partie
  });

  it('close odhlásí socket (subscriberCount klesne)', async () => {
    const port = await start();
    const game = await createGame();
    const ws = await subscribe(port, game.id, 1);
    expect(hub().subscriberCount(game.id)).toBe(1);

    ws.close();
    await waitFor(() => hub().subscriberCount(game.id) === 0);
    expect(hub().subscriberCount(game.id)).toBe(0);
  });

  it('WS na neexistující partii server čistě zavře', async () => {
    const port = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/games/neexistuje/ws`);
    openSockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('close', () => resolve());
      ws.once('error', reject);
      setTimeout(() => reject(new Error('spojení se nezavřelo')), 1000);
    });
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(hub().subscriberCount('neexistuje')).toBe(0); // nezaregistroval se
  });
});

describe('WS push – s enginem', () => {
  it('push po přijaté remíze', async () => {
    const port = await start({ engine: stubEngine });
    const game = await createGame(); // černý (člověk) na tahu, engine idle
    const ws = await subscribe(port, game.id, 1);

    const msg = nextMessage(ws);
    const res = await app.inject({ method: 'POST', url: `/games/${game.id}/offer-draw` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ accepted: boolean }>().accepted).toBe(true);

    const pushed = await msg;
    expect(pushed.type).toBe('game-state');
    expect(pushed.game.result).toBe('draw'); // odběratel vidí remízu
  });

  it('push po tahu enginu (ne jen po tahu člověka)', async () => {
    const port = await start({ engine: stubEngine });
    const game = await createGame();
    const ws = await subscribe(port, game.id, 1);

    // Tah člověka → 1. push (engineStatus thinking), pak async tah enginu → 2. push.
    // Sbírat do fronty PŘED tahem: engine push (stub resolvne hned) může dorazit
    // dřív, než by se stihl zaregistrovat druhý `once` – jinak by test byl flaky.
    const received = collectMessages(ws);
    await playFirstMove(game.id);
    await waitFor(() => received.length >= 2, 2000);

    const [rawThinking, rawEngine] = received;
    if (rawThinking === undefined || rawEngine === undefined) {
      throw new Error('očekávám dva pushe (thinking + tah enginu)');
    }
    const first = JSON.parse(rawThinking) as GameStateMessage;
    const second = JSON.parse(rawEngine) as GameStateMessage;
    expect(first.type).toBe('game-state');
    expect(first.game.engineStatus).toBe('thinking');
    expect(second.game.engineStatus).toBe('idle');
    // Engine odehrál → je zase na tahu černý (člověk).
    expect(second.game.position.turn).toBe('black');
  });

  it('push stavu error, když engine selže (odběratel nevisí na thinking)', async () => {
    const port = await start({ engine: crashingEngine });
    const game = await createGame();
    const ws = await subscribe(port, game.id, 1);
    // runEngineMove selhání loguje přes console.error – ztlumit a ověřit, že zaznělo.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const received = collectMessages(ws);
    await playFirstMove(game.id); // spustí engine → thinking push, pak pád → error push
    await waitFor(() => received.length >= 2, 2000);

    const rawLast = received[received.length - 1];
    if (rawLast === undefined) {
      throw new Error('očekávám aspoň dva pushe (thinking + error)');
    }
    const last = JSON.parse(rawLast) as GameStateMessage;
    expect(last.type).toBe('game-state');
    expect(last.game.engineStatus).toBe('error'); // ne 'thinking' – odběratel se dozví selhání
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});

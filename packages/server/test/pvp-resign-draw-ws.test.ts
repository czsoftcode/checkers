/**
 * Integrační test PvP vzdání a nabídky remízy (fáze 77) přes SKUTEČNÁ WS spojení:
 * server `listen({ port: 0 })` + reální `ws` klienti.
 *
 * Autorita serveru: příkaz přijde po room WS (`{type:'resign'|'draw-offer'|
 * 'draw-accept'|'draw-reject', gameId}`), identitu hráče bere server z `me.id`
 * (přiřazené socketu při joinu, NEČTE se z klienta).
 *
 * Dva kanály:
 *   - KONEC partie (vzdání, přijatá remíza) → terminální `game-state` OBĚMA přes
 *     game hub `/games/:id/ws`,
 *   - SIGNÁL nabídky (nabídnuto / odmítnuto) → adresně soupeři/nabízejícímu přes
 *     room WS (`draw-offered` / `draw-rejected`); stav pravidel se nemění.
 *
 * Zuby: happy cesty obou kanálů + unhappy (neúčastník, dvojí nabídka, přijetí bez
 * nabídky, vlastní nabídka, po konci partie, engine partie, tah ruší nabídku).
 * Čeká se deterministicky (sběr zpráv + waitFor), ne arbitrárním sleepem.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';

import { buildApp, effectiveResult } from '../src/index.js';
import type {
  ChallengeRegistry,
  GameStateMessage,
  GameStore,
  OpeningBook,
  RoomServerMessage,
} from '../src/index.js';

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

function gameStore(): GameStore {
  return (app as unknown as { gameStore: GameStore }).gameStore;
}

function challengeRegistry(): ChallengeRegistry {
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

/** Spáruje dva hráče do PvP partie a vrátí je i s otevřenými herními odběry. */
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

const sendResign = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'resign', gameId }));
const sendDrawOffer = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'draw-offer', gameId }));
const sendDrawAccept = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'draw-accept', gameId }));
const sendDrawReject = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'draw-reject', gameId }));
const sendLeaveGame = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'leave-game', gameId }));
const sendRematchOffer = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'rematch-offer', gameId }));
const sendRematchAccept = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'rematch-accept', gameId }));
const sendRematchDecline = (ws: WebSocket, gameId: string): void =>
  ws.send(JSON.stringify({ type: 'rematch-decline', gameId }));
const sendMove = (ws: WebSocket, gameId: string, from: number, path: number[]): void =>
  ws.send(JSON.stringify({ type: 'move', gameId, from, path }));

describe('PvP vzdání přes room WS (fáze 77)', () => {
  it('happy: černý se vzdá → OBA game WS dostanou terminální stav (bílý vyhrál)', async () => {
    const port = await start();
    const { black, gameId, gameBlack, gameWhite } = await pairGame(port);

    sendResign(black.ws, gameId);

    await waitFor(() => gameBlack.received.length >= 1 && gameWhite.received.length >= 1, 2000);
    const forBlack = gameBlack.received[0];
    const forWhite = gameWhite.received[0];
    if (forBlack === undefined || forWhite === undefined) {
      throw new Error('očekávám game-state na obou herních socketech');
    }
    expect(forBlack.game.result).toBe('white-wins');
    expect(forWhite.game.result).toBe('white-wins');
    // Pozice se vzdáním NEMĚNÍ – výsledek je vynucený mimo pravidla.
    expect(forBlack.game.position.turn).toBe('black');
    expect(gameStore().get(gameId)?.forcedResult).toBe('white-wins');
  });

  it('vzdá se bílý → vyhrává černý (barva z players, ne natvrdo)', async () => {
    const port = await start();
    const { white, gameId, gameBlack } = await pairGame(port);

    sendResign(white.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);
    expect(gameBlack.received[0]?.game.result).toBe('black-wins');
  });

  it('vzdát už skončenou partii nejde → error „u konce", žádný druhý push', async () => {
    const port = await start();
    const { black, gameId, gameBlack } = await pairGame(port);

    sendResign(black.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);
    sendResign(black.ws, gameId); // podruhé
    const err = await takeMessage(black.received, 'error');
    expect(err.message).toMatch(/u konce/i);

    await delay(50);
    expect(gameBlack.received.length).toBe(1); // jen ten první terminální stav
  });

  it('neúčastník se pokusí vzdát cizí partii → error „hráčem", žádný push', async () => {
    const port = await start();
    const { gameId, gameBlack } = await pairGame(port);
    const cyril = await join(port, 'Cyril');

    sendResign(cyril.ws, gameId);
    const err = await takeMessage(cyril.received, 'error');
    expect(err.message).toMatch(/hráčem/i);

    await delay(50);
    expect(gameBlack.received).toEqual([]);
    expect(gameStore().get(gameId)?.forcedResult).toBeNull();
  });

  it('vzdání ENGINE partie přes místnost → error „nehraje se v místnosti"', async () => {
    const port = await start();
    const engineGame = await app
      .inject({ method: 'POST', url: '/games' })
      .then((r) => r.json<{ id: string }>());
    const player = await join(port, 'Dana');

    sendResign(player.ws, engineGame.id);
    const err = await takeMessage(player.received, 'error');
    expect(err.message).toMatch(/v místnosti nehraje/i);
  });

  it('vzdání před joinem → error „nejdřív vstup"', async () => {
    const port = await start();
    const { gameId } = await pairGame(port);
    const ws = await openRoom(port);
    const received = collectRoom(ws);
    sendResign(ws, gameId);
    const err = await takeMessage(received, 'error');
    expect(err.message).toMatch(/vstup do místnosti/i);
    expect(gameStore().get(gameId)?.forcedResult).toBeNull();
  });
});

describe('PvP nabídka remízy přes room WS (fáze 77)', () => {
  it('happy nabídka: soupeř dostane draw-offered po room WS, game hub mlčí', async () => {
    const port = await start();
    const { white, black, gameId, gameBlack, gameWhite } = await pairGame(port);

    sendDrawOffer(white.ws, gameId);

    // Soupeř nabízejícího (černý) dostane signál s gameId.
    const offered = await takeMessage(black.received, 'draw-offered');
    expect(offered.gameId).toBe(gameId);

    // Stav partie se NEMĚNÍ → game hub nedostane nic; nabízející nedostane vlastní signál.
    await delay(50);
    expect(gameBlack.received).toEqual([]);
    expect(gameWhite.received).toEqual([]);
    expect(white.received.some((m) => m.type === 'draw-offered')).toBe(false);
    expect(gameStore().get(gameId)?.forcedResult).toBeNull();
  });

  it('přijetí: soupeř přijme → OBA game WS dostanou terminální draw', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack, gameWhite } = await pairGame(port);

    sendDrawOffer(black.ws, gameId);
    await takeMessage(white.received, 'draw-offered');
    sendDrawAccept(white.ws, gameId);

    await waitFor(() => gameBlack.received.length >= 1 && gameWhite.received.length >= 1, 2000);
    expect(gameBlack.received[0]?.game.result).toBe('draw');
    expect(gameWhite.received[0]?.game.result).toBe('draw');
    expect(gameStore().get(gameId)?.forcedResult).toBe('draw');
  });

  it('odmítnutí: soupeř odmítne → nabízející dostane draw-rejected, partie běží dál', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack, gameWhite } = await pairGame(port);

    sendDrawOffer(black.ws, gameId);
    await takeMessage(white.received, 'draw-offered');
    sendDrawReject(white.ws, gameId);

    const rejected = await takeMessage(black.received, 'draw-rejected');
    expect(rejected.gameId).toBe(gameId);

    // Stav se nemění, game hub mlčí, nabídka je pryč (přijmout už nejde).
    await delay(50);
    expect(gameBlack.received).toEqual([]);
    expect(gameWhite.received).toEqual([]);
    expect(gameStore().get(gameId)?.forcedResult).toBeNull();
    sendDrawAccept(white.ws, gameId);
    const err = await takeMessage(white.received, 'error');
    expect(err.message).toMatch(/přijmout/i);
  });

  it('dvojí nabídka → error „už je nabídnutá"', async () => {
    const port = await start();
    const { black, white, gameId } = await pairGame(port);

    sendDrawOffer(black.ws, gameId);
    await takeMessage(white.received, 'draw-offered');
    sendDrawOffer(black.ws, gameId); // podruhé
    const err = await takeMessage(black.received, 'error');
    expect(err.message).toMatch(/nabídnutá/i);
  });

  it('přijetí bez visící nabídky → error', async () => {
    const port = await start();
    const { white, gameId } = await pairGame(port);

    sendDrawAccept(white.ws, gameId);
    const err = await takeMessage(white.received, 'error');
    expect(err.message).toMatch(/přijmout/i);
  });

  it('vlastní nabídku nelze přijmout → error', async () => {
    const port = await start();
    const { black, white, gameId } = await pairGame(port);

    sendDrawOffer(black.ws, gameId);
    await takeMessage(white.received, 'draw-offered');
    sendDrawAccept(black.ws, gameId); // nabízející přijímá SVOU nabídku
    const err = await takeMessage(black.received, 'error');
    expect(err.message).toMatch(/přijmout/i);
  });

  it('nabídka po konci partie (po vzdání) → error „u konce"', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack } = await pairGame(port);

    sendResign(black.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);
    sendDrawOffer(white.ws, gameId);
    const err = await takeMessage(white.received, 'error');
    expect(err.message).toMatch(/u konce/i);
  });

  it('tah zruší visící nabídku (soupeř ji pak nemůže přijmout)', async () => {
    const port = await start();
    const { black, white, gameId } = await pairGame(port);

    sendDrawOffer(black.ws, gameId);
    await takeMessage(white.received, 'draw-offered');
    // Černý (na tahu) zahraje legální tah → nabídka padá.
    sendMove(black.ws, gameId, 9, [13]);
    await waitFor(() => gameStore().get(gameId)?.state.position.turn === 'white', 2000);
    sendDrawAccept(white.ws, gameId);
    const err = await takeMessage(white.received, 'error');
    expect(err.message).toMatch(/přijmout/i);
  });

  it('nabídka remízy na ENGINE partii přes místnost → error „nehraje se v místnosti"', async () => {
    const port = await start();
    const engineGame = await app
      .inject({ method: 'POST', url: '/games' })
      .then((r) => r.json<{ id: string }>());
    const player = await join(port, 'Eva');

    sendDrawOffer(player.ws, engineGame.id);
    const err = await takeMessage(player.received, 'error');
    expect(err.message).toMatch(/v místnosti nehraje/i);
  });
});

describe('PvP opuštění dohrané partie – uvolnění busy (leave-game, fáze 77)', () => {
  it('po spárování jsou OBA busy; po vzdání jsou pořád busy, dokud nepřijde leave-game', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack } = await pairGame(port);
    // Spárování označilo oba za busy (nesmí je vyzvat nikdo jiný).
    expect(challengeRegistry().isBusy(black.id)).toBe(true);
    expect(challengeRegistry().isBusy(white.id)).toBe(true);

    // Vzdání partii ukončí, ale samo busy NEUVOLNÍ (to je až Konec/Odveta).
    sendResign(black.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);
    expect(challengeRegistry().isBusy(black.id)).toBe(true);
    expect(challengeRegistry().isBusy(white.id)).toBe(true);

    // Konec (leave-game) od JEDNOHO uvolní OBA a SOUPEŘ dostane `game-closed`
    // (ať se taky přesune do místnosti, nevisí na výsledku).
    sendLeaveGame(black.ws, gameId);
    const closed = await takeMessage(white.received, 'game-closed');
    expect(closed.gameId).toBe(gameId);
    await waitFor(
      () => !challengeRegistry().isBusy(black.id) && !challengeRegistry().isBusy(white.id),
      2000,
    );
  });

  it('leave-game na BĚŽÍCÍ partii → error „ještě běží", busy zůstává', async () => {
    const port = await start();
    const { black, white, gameId } = await pairGame(port);

    sendLeaveGame(black.ws, gameId);
    const err = await takeMessage(black.received, 'error');
    expect(err.message).toMatch(/ještě běží/i);
    // Autorita: busy se u rozehrané partie neuvolní (jinak dvojité spárování).
    expect(challengeRegistry().isBusy(black.id)).toBe(true);
    expect(challengeRegistry().isBusy(white.id)).toBe(true);
  });

  it('leave-game od NEúčastníka → error, busy dvojice zůstává', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack } = await pairGame(port);
    sendResign(black.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);
    const cyril = await join(port, 'Cyril');

    sendLeaveGame(cyril.ws, gameId);
    const err = await takeMessage(cyril.received, 'error');
    expect(err.message).toMatch(/hráčem/i);
    expect(challengeRegistry().isBusy(black.id)).toBe(true);
    expect(challengeRegistry().isBusy(white.id)).toBe(true);
  });

  it('teeth: po leave-game může uvolněného hráče vyzvat NĚKDO JINÝ (dřív „už hraje")', async () => {
    const port = await start();
    const { black, white, gameId, gameBlack } = await pairGame(port);
    sendResign(white.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);

    const cyril = await join(port, 'Cyril');
    // PŘED uvolněním: výzva na busy hráče (black) je odmítnutá.
    cyril.ws.send(JSON.stringify({ type: 'challenge', targetId: black.id }));
    const busyErr = await takeMessage(cyril.received, 'error');
    expect(busyErr.message).toMatch(/hraje/i);

    // Konec uvolní oba.
    sendLeaveGame(black.ws, gameId);
    await waitFor(() => !challengeRegistry().isBusy(black.id), 2000);

    // Teď už výzva projde: black dostane `challenged` (žádný busy error).
    cyril.ws.send(JSON.stringify({ type: 'challenge', targetId: black.id }));
    const challenged = await takeMessage(black.received, 'challenged');
    expect(challenged.challenge.challengerNick).toBe('Cyril');
  });

  it('leave-game na ENGINE partii přes místnost → error „nehraje se v místnosti"', async () => {
    const port = await start();
    const engineGame = await app
      .inject({ method: 'POST', url: '/games' })
      .then((r) => r.json<{ id: string }>());
    const player = await join(port, 'Filip');

    sendLeaveGame(player.ws, engineGame.id);
    const err = await takeMessage(player.received, 'error');
    expect(err.message).toMatch(/v místnosti nehraje/i);
  });

  it('autorita: DRUHÉ leave-game na tutéž partii NEuvolní hráče, co mezitím začal novou hru', async () => {
    const port = await start();
    // Partie G: Alice(black) vs Bob(white). Bob se vzdá → terminální.
    const { black: alice, white: bob, gameId: gameG, gameBlack } = await pairGame(port);
    sendResign(bob.ws, gameG);
    await waitFor(() => gameBlack.received.length >= 1, 2000);

    // Alice pošle „Konec" → uvolní oba (markPvpLeft poprvé).
    sendLeaveGame(alice.ws, gameG);
    await waitFor(() => !challengeRegistry().isBusy(bob.id), 2000);

    // Bob se mezitím spáruje do NOVÉ partie H s Cyrilem → Bob je zas busy.
    const cyril = await join(port, 'Cyril');
    cyril.ws.send(JSON.stringify({ type: 'challenge', targetId: bob.id }));
    const chal = await takeMessage(bob.received, 'challenged');
    bob.ws.send(JSON.stringify({ type: 'accept', challengeId: chal.challenge.id }));
    await waitFor(() => challengeRegistry().isBusy(bob.id), 2000);

    // Alice (nebo kdokoli) pošle leave-game na STAROU partii G ZNOVU. Nesmí uvolnit
    // Boba z běžící partie H (markPvpLeft podruhé → false → žádné uvolnění).
    sendLeaveGame(alice.ws, gameG);
    await delay(50);
    expect(challengeRegistry().isBusy(bob.id)).toBe(true); // pořád v partii H
  });
});

describe('PvP odveta (rematch, fáze 77)', () => {
  it('happy: A nabídne odvetu → B ji dostane; přijetí založí NOVOU partii s prohozenými barvami', async () => {
    const port = await start();
    // Alice = black (vyzyvatel), Bob = white. Bob se vzdá → terminální.
    const { black: alice, white: bob, gameId: gameG, gameBlack } = await pairGame(port);
    sendResign(bob.ws, gameG);
    await waitFor(() => gameBlack.received.length >= 1, 2000);

    // Alice nabídne odvetu → Bob dostane rematch-offered.
    sendRematchOffer(alice.ws, gameG);
    const offered = await takeMessage(bob.received, 'rematch-offered');
    expect(offered.gameId).toBe(gameG);

    // Bob přijme → OBA dostanou challenge-accepted s NOVÝM gameId a PROHOZENÝMI barvami.
    sendRematchAccept(bob.ws, gameG);
    const forAlice = await takeMessage(alice.received, 'challenge-accepted');
    const forBob = await takeMessage(bob.received, 'challenge-accepted');
    expect(forAlice.gameId).toBe(forBob.gameId);
    expect(forAlice.gameId).not.toBe(gameG); // nová partie
    // Alice byla černá → teď bílá; Bob byl bílý → teď černý.
    expect(forAlice.color).toBe('white');
    expect(forBob.color).toBe('black');

    // Store: nová partie má prohozené hráče (black = Bob, white = Alice), běží.
    const fresh = gameStore().get(forAlice.gameId);
    if (fresh?.mode !== 'pvp') {
      throw new Error('čekal jsem PvP partii');
    }
    expect(fresh.players).toEqual({ black: bob.id, white: alice.id });
    expect(effectiveResult(fresh)).toBe('ongoing');
    // Oba pořád busy (přešli z partie do partie, nikdo se neuvolnil).
    expect(challengeRegistry().isBusy(alice.id)).toBe(true);
    expect(challengeRegistry().isBusy(bob.id)).toBe(true);
  });

  it('odmítnutí odvety: nabízející dostane rematch-declined, žádná nová partie', async () => {
    const port = await start();
    const { black: alice, white: bob, gameId, gameBlack } = await pairGame(port);
    sendResign(alice.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);

    sendRematchOffer(alice.ws, gameId);
    await takeMessage(bob.received, 'rematch-offered');
    sendRematchDecline(bob.ws, gameId);
    const declined = await takeMessage(alice.received, 'rematch-declined');
    expect(declined.gameId).toBe(gameId);
  });

  it('nabídka odvety na BĚŽÍCÍ partii → error „ještě běží"', async () => {
    const port = await start();
    const { black: alice, gameId } = await pairGame(port);
    sendRematchOffer(alice.ws, gameId); // partie ještě běží
    const err = await takeMessage(alice.received, 'error');
    expect(err.message).toMatch(/ještě běží/i);
  });

  it('přijetí bez nabídky → error; vlastní nabídku nelze přijmout', async () => {
    const port = await start();
    const { black: alice, white: bob, gameId, gameBlack } = await pairGame(port);
    sendResign(bob.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);

    sendRematchAccept(bob.ws, gameId); // nic nevisí
    const err1 = await takeMessage(bob.received, 'error');
    expect(err1.message).toMatch(/přijmout/i);

    sendRematchOffer(alice.ws, gameId);
    await takeMessage(bob.received, 'rematch-offered');
    sendRematchAccept(alice.ws, gameId); // vlastní nabídka
    const err2 = await takeMessage(alice.received, 'error');
    expect(err2.message).toMatch(/přijmout/i);
  });

  it('Konec od soupeře, když nabízející čeká na odvetu → nabízející dostane game-closed', async () => {
    const port = await start();
    const { black: alice, white: bob, gameId, gameBlack } = await pairGame(port);
    sendResign(alice.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);

    // Alice čeká na odvetu; Bob místo odpovědi dá Konec → Alice se má přesunout do místnosti.
    sendRematchOffer(alice.ws, gameId);
    await takeMessage(bob.received, 'rematch-offered');
    sendLeaveGame(bob.ws, gameId);
    const closed = await takeMessage(alice.received, 'game-closed');
    expect(closed.gameId).toBe(gameId);
  });

  it('autorita: Konec nabízejícího PAK přijetí soupeřem → žádná nová partie, nikdo busy (K1)', async () => {
    const port = await start();
    const { black: alice, white: bob, gameId, gameBlack } = await pairGame(port);
    sendResign(bob.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);

    // Alice nabídne odvetu, Bob dostane dotaz…
    sendRematchOffer(alice.ws, gameId);
    await takeMessage(bob.received, 'rematch-offered');
    // …ale Alice si to rozmyslí a dá Konec (uvolní OBA busy a zapečetí partii).
    sendLeaveGame(alice.ws, gameId);
    await takeMessage(bob.received, 'game-closed');
    await waitFor(() => !challengeRegistry().isBusy(alice.id), 2000);

    // Bob teď (opožděně) klikne Přijmout na mrtvý dotaz. Server MUSÍ odmítnout –
    // jinak by vznikla nová partie, ve které NIKDO není busy (dvojité spárování).
    sendRematchAccept(bob.ws, gameId);
    const err = await takeMessage(bob.received, 'error');
    expect(err.message).toMatch(/už není možná/i);

    await delay(50);
    // Žádná nová partie: Bob nedostal challenge-accepted a oba jsou VOLNÍ.
    expect(bob.received.some((m) => m.type === 'challenge-accepted')).toBe(false);
    expect(challengeRegistry().isBusy(alice.id)).toBe(false);
    expect(challengeRegistry().isBusy(bob.id)).toBe(false);
  });

  it('autorita: nabídka odvety na už OPUŠTĚNÉ partii → error „už není možná"', async () => {
    const port = await start();
    const { black: alice, white: bob, gameId, gameBlack } = await pairGame(port);
    sendResign(bob.ws, gameId);
    await waitFor(() => gameBlack.received.length >= 1, 2000);
    sendLeaveGame(alice.ws, gameId); // partie zapečetěna
    await waitFor(() => !challengeRegistry().isBusy(bob.id), 2000);

    sendRematchOffer(bob.ws, gameId);
    const err = await takeMessage(bob.received, 'error');
    expect(err.message).toMatch(/už není možná/i);
  });

  it('autorita: leave-game na STAROU partii po odvetě NEuvolní hráče z nové partie', async () => {
    const port = await start();
    const { black: alice, white: bob, gameId: gameG, gameBlack } = await pairGame(port);
    sendResign(bob.ws, gameG);
    await waitFor(() => gameBlack.received.length >= 1, 2000);
    sendRematchOffer(alice.ws, gameG);
    await takeMessage(bob.received, 'rematch-offered');
    sendRematchAccept(bob.ws, gameG);
    await takeMessage(alice.received, 'challenge-accepted');
    await takeMessage(bob.received, 'challenge-accepted');

    // Stará partie G je zapečetěná: leave-game(G) nesmí uvolnit busy (jsou v nové partii).
    sendLeaveGame(alice.ws, gameG);
    await delay(50);
    expect(challengeRegistry().isBusy(alice.id)).toBe(true);
    expect(challengeRegistry().isBusy(bob.id)).toBe(true);
  });
});

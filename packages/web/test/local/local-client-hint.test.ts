import { describe, expect, it } from 'vitest';
import { OPENING_BOOK, lookupBookMove } from '@checkers/ai';
import { createInProcessEngineWorker } from '../../src/local/engine-worker.js';
import { createLocalClient } from '../../src/local-client.js';
import { createBlockingWorker, makeClock, pollUntilSettled } from './helpers.js';

function makeClient() {
  const worker = createInProcessEngineWorker({ now: makeClock() });
  return createLocalClient(worker, { seed: () => 0x1234_abcd, timeMs: 1, now: makeClock() });
}

describe('LocalClient getHint', () => {
  it('vrátí legální tah na tahu člověka a stav partie NEZMĚNÍ', async () => {
    const client = makeClient();
    const created = await client.createGame('education', 'black');
    const before = await client.getGame(created.id);

    const hint = client.getHint;
    if (hint === undefined) {
      throw new Error('LocalClient musí getHint implementovat vždy');
    }
    const move = await hint(created.id);

    // Tvar MoveDto + tah je skutečně mezi legálními tahy aktuální pozice.
    expect(typeof move.from).toBe('number');
    expect(Array.isArray(move.path)).toBe(true);
    const isLegal = before.legalMoves.some(
      (m) => m.from === move.from && m.path.length === move.path.length && m.path.every((p, i) => p === move.path[i]),
    );
    expect(isLegal).toBe(true);

    // Read-only: pozice ani stav enginu se nezměnily.
    const after = await client.getGame(created.id);
    expect(after.position).toEqual(before.position);
    expect(after.engineStatus).toBe(before.engineStatus);
    expect(after.result).toBe('ongoing');
  });

  it('po konci partie → game_over (strojový kód)', async () => {
    const client = makeClient();
    const created = await client.createGame('education', 'black');
    await client.resign(created.id);
    const hint = client.getHint;
    if (hint === undefined) {
      throw new Error('getHint chybí');
    }
    await expect(hint(created.id)).rejects.toMatchObject({ code: 'game_over' });
  });

  it('mimo tah člověka (na tahu engine) → not_your_turn', async () => {
    // Blokující worker drží engine v thinking → černý (engine) zůstane na tahu.
    const client = createLocalClient(createBlockingWorker(), { seed: () => 1, timeMs: 1 });
    const created = await client.createGame('education', 'white');
    expect(created.position.turn).toBe('black'); // engine na tahu
    const hint = client.getHint;
    if (hint === undefined) {
      throw new Error('getHint chybí');
    }
    await expect(hint(created.id)).rejects.toMatchObject({ code: 'not_your_turn' });
  });

  it('nápověda na neexistující partii → game_not_found', async () => {
    const client = makeClient();
    const hint = client.getHint;
    if (hint === undefined) {
      throw new Error('getHint chybí');
    }
    await expect(hint('neexistuje')).rejects.toMatchObject({ code: 'game_not_found' });
  });

  it('nápověda NEpoužívá knihu zahájení (věrně jako serverový bestmove bez knihy)', async () => {
    // Server hint = bestmove(position, undefined) BEZ knihy; LocalClient to drží
    // přes useBook:false. Ve výchozí pozici (JE v knize) se knižní tah (11→15) liší
    // od hledaného (9→13), takže test má zuby: kdyby getHint knihu použil, radil by
    // knižní tah a tohle by padlo.
    const client = makeClient();
    const created = await client.createGame('education', 'black');
    const bookMove = lookupBookMove(OPENING_BOOK, created.position);
    if (bookMove === undefined) {
      throw new Error('výchozí pozice musí být v knize, jinak test nic netvrdí');
    }

    const hint = client.getHint;
    if (hint === undefined) {
      throw new Error('getHint chybí');
    }
    const move = await hint(created.id);
    const isBookMove =
      move.from === bookMove.from &&
      move.path.length === bookMove.path.length &&
      move.path.every((p, i) => p === bookMove.path[i]);
    expect(isBookMove).toBe(false);
  });

  it('nápověda je nezávislá na úrovni partie – i ve slabé úrovni vrátí legální tah', async () => {
    // Server: hint jede vždy naplno. LocalClient to drží tím, že getHint počítá s úrovní
    // 'professional' bez ohledu na úroveň partie. Ověříme aspoň, že i u Začátečníka radí.
    const client = makeClient();
    const created = await client.createGame('beginner', 'black');
    await pollUntilSettled(client, created.id); // pro jistotu čekej na klidový stav
    const hint = client.getHint;
    if (hint === undefined) {
      throw new Error('getHint chybí');
    }
    const move = await hint(created.id);
    expect(typeof move.from).toBe('number');
  });
});

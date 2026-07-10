import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInProcessEngineWorker } from '../../src/local/engine-worker.js';
import { createLocalClient } from '../../src/local-client.js';
import { makeClock } from './helpers.js';

/**
 * Zuby pro `newGameId` (local-client.ts): oprava fáze 88 přidala fallback z
 * `crypto.randomUUID` (jen secure context) na `crypto.getRandomValues` a dál na
 * `Date.now`+`Math.random`. V Node (test runtime) je `randomUUID` VŽDY dostupné,
 * takže bez stubování by tyhle větve nikdy neběžely a rozbité enkódování / kolizní
 * ID by nic nechytilo. Test proto `globalThis.crypto` dočasně přepíše na varianty
 * bez `randomUUID` / úplně bez `crypto` a ověří, že `createGame` pořád vrátí
 * neprázdné, unikátní ID použitelné jako klíč do mapy partií (obě partie jdou
 * získat zpět, jedna nepřepsala druhou).
 */

const realCrypto = globalThis.crypto;

/** Klient s in-process workerem; člověk černý → engine se nespustí (klid pro test ID). */
function makeClient() {
  return createLocalClient(createInProcessEngineWorker({ now: makeClock() }), {
    seed: () => 0x1234_abcd,
    timeMs: 1,
    now: makeClock(),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newGameId (přes createGame) – fallback podle dostupnosti crypto', () => {
  it('secure context (randomUUID dostupné) → UUID v dashed tvaru', async () => {
    // realCrypto v Node randomUUID má; explicitně potvrdíme primární větev.
    const dto = await makeClient().createGame('beginner', 'black');
    expect(dto.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('insecure context (jen getRandomValues, bez randomUUID) → 32 hex znaků, unikátní klíč', async () => {
    // Crypto BEZ randomUUID, ale s reálným getRandomValues (skutečná náhoda →
    // unikátnost). `.bind` zachová generický podpis metody (arrow wrapper by ho
    // zúžil a shodil typecheck).
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });
    const client = makeClient();
    const a = await client.createGame('beginner', 'black');
    const b = await client.createGame('beginner', 'black');
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
    expect(b.id).toMatch(/^[0-9a-f]{32}$/);
    expect(a.id).not.toBe(b.id);
    // Klíč do mapy: obě partie musí jít získat zpět (žádná nepřepsala druhou).
    expect((await client.getGame(a.id)).id).toBe(a.id);
    expect((await client.getGame(b.id)).id).toBe(b.id);
  });

  it('crypto úplně chybí → poslední fallback (game-…) je neprázdné a unikátní', async () => {
    vi.stubGlobal('crypto', undefined);
    const client = makeClient();
    const a = await client.createGame('beginner', 'black');
    const b = await client.createGame('beginner', 'black');
    expect(a.id).toMatch(/^game-/);
    expect(a.id.length).toBeGreaterThan(5);
    expect(a.id).not.toBe(b.id);
    expect((await client.getGame(a.id)).id).toBe(a.id);
    expect((await client.getGame(b.id)).id).toBe(b.id);
  });
});

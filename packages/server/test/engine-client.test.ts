/**
 * Testy orchestrace enginu (EngineClient) na úrovni podprocesu.
 *
 * Dvě roviny:
 * - proti REÁLNÉMU enginu (tsx podproces): happy path handshake + tah,
 * - proti FALEŠNÉMU enginu (fixtures/fake-engine.mjs, plain node): řízené
 *   selhání (hang/crash/error) pro větve timeout → kill → restart → retry.
 *
 * Zuby: kdyby se retry/kill vypnul, `slow-then-ok` by po zaseknutí prvního
 * pokusu nikdy nevrátil tah a test by spadl; `hang` test hlídá, že retry
 * proběhl (log „zkouším znovu").
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { initialPosition, legalMoves } from '@checkers/rules';
import type { SpawnCommand } from '../src/index.js';
import {
  defaultEngineCommand,
  EngineClient,
  EngineCrashError,
  EngineProtocolError,
  EngineTimeoutError,
} from '../src/index.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url));

/** Spawn příkaz na falešný engine (plain node, žádné tsx → rychlý start). */
function fakeCmd(mode: string, extra: string[] = []): SpawnCommand {
  return { command: process.execPath, args: [FIXTURE, '--mode', mode, ...extra] };
}

/** Počká, dokud PID nepřestane existovat (ESRCH), nebo vyprší strop. */
async function waitUntilDead(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true; // ESRCH → proces je pryč
    }
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup) {
    await fn();
  }
  cleanup = [];
});

describe('EngineClient proti reálnému enginu', () => {
  it('warmup vrátí protokol 2 a bestmove vrátí LEGÁLNÍ tah', async () => {
    const client = new EngineClient({ spawn: defaultEngineCommand(), timeMs: 300, pidFile: null });
    cleanup.push(() => client.close());

    const hello = await client.warmup();
    expect(hello.protocol).toBe(2);

    const position = initialPosition();
    const move = await client.bestmove(position);
    // Engine je NEDŮVĚRYHODNÝ – tah ověříme přes rules (stejně jako to dělá server).
    const legal = legalMoves(position).some(
      (m) =>
        m.from === move.from &&
        m.path.length === move.path.length &&
        m.path.every((sq, i) => sq === move.path[i]),
    );
    expect(legal).toBe(true);
  }, 20_000);
});

describe('EngineClient – fronta, timeout, kill, retry', () => {
  it('slow-then-ok: první pokus se zasekne → kill + retry na timeMs/2 uspěje', async () => {
    const logs: string[] = [];
    const client = new EngineClient({
      spawn: fakeCmd('slow-then-ok', ['--threshold', '150']),
      timeMs: 200,
      pidFile: null,
      log: (m) => logs.push(m),
    });
    cleanup.push(() => client.close());

    const move = await client.bestmove(initialPosition());
    expect(move.from).toBe(23); // fake vrací 23→18 až na retry (timeMs/2 = 100 < 150)
    expect(logs.some((l) => l.includes('zkouším znovu'))).toBe(true);
  }, 15_000);

  it('hang: oba pokusy vyprší → EngineTimeoutError, ale retry proběhl', async () => {
    const logs: string[] = [];
    const client = new EngineClient({
      spawn: fakeCmd('hang'),
      timeMs: 100,
      pidFile: null,
      log: (m) => logs.push(m),
    });
    cleanup.push(() => client.close());

    await expect(client.bestmove(initialPosition())).rejects.toBeInstanceOf(EngineTimeoutError);
    expect(logs.some((l) => l.includes('zkouším znovu'))).toBe(true);
  }, 15_000);

  it('crash: pád procesu → retry → nakonec EngineCrashError (ne uncaught)', async () => {
    const client = new EngineClient({ spawn: fakeCmd('crash'), timeMs: 200, pidFile: null });
    cleanup.push(() => client.close());
    await expect(client.bestmove(initialPosition())).rejects.toBeInstanceOf(EngineCrashError);
  }, 15_000);

  it('pokřivený tah (move: null) → EngineProtocolError na hranici, ne TypeError', async () => {
    const logs: string[] = [];
    const client = new EngineClient({
      spawn: fakeCmd('malformed'),
      timeMs: 200,
      pidFile: null,
      log: (m) => logs.push(m),
    });
    cleanup.push(() => client.close());

    await expect(client.bestmove(initialPosition())).rejects.toBeInstanceOf(EngineProtocolError);
    // Neplatný tvar se neopakuje (retry by vrátil zas smetí).
    expect(logs.some((l) => l.includes('zkouším znovu'))).toBe(false);
  }, 15_000);

  it('error odpověď enginu → EngineProtocolError BEZ retry', async () => {
    const logs: string[] = [];
    const client = new EngineClient({
      spawn: fakeCmd('error'),
      timeMs: 200,
      pidFile: null,
      log: (m) => logs.push(m),
    });
    cleanup.push(() => client.close());

    await expect(client.bestmove(initialPosition())).rejects.toBeInstanceOf(EngineProtocolError);
    // Protokolová chyba se NEopakuje – žádné „zkouším znovu".
    expect(logs.some((l) => l.includes('zkouším znovu'))).toBe(false);
  }, 15_000);

  it('fronta se po selhání nezasekne: po chybném bestmove projde warmup', async () => {
    const client = new EngineClient({ spawn: fakeCmd('hang'), timeMs: 80, pidFile: null });
    cleanup.push(() => client.close());

    await expect(client.bestmove(initialPosition())).rejects.toBeTruthy();
    // Fake na hello vždy odpoví – když by fronta byla zaseklá, tohle by uvázlo.
    const hello = await client.warmup();
    expect(hello.protocol).toBe(2);
  }, 15_000);
});

describe('EngineClient – pidfile a úklid procesů', () => {
  it('spawn zapíše PID do pidfile; close() proces zabije a soubor smaže', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'checkers-pid-'));
    const pidFile = join(dir, 'engine.pid');
    const client = new EngineClient({ spawn: fakeCmd('ok'), timeMs: 200, pidFile });

    await client.warmup();
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    expect(pid).toBe(client.currentPid());

    await client.close();
    expect(existsSync(pidFile)).toBe(false);
    expect(await waitUntilDead(pid)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);

  it('při startu zabije osiřelý proces z pidfile a soubor smaže', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'checkers-pid-'));
    const pidFile = join(dir, 'engine.pid');

    // „Osiřelý engine" z minulého běhu: skutečný spící proces.
    const { spawn } = await import('node:child_process');
    const orphan = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)']);
    const orphanPid = orphan.pid;
    if (orphanPid === undefined) {
      throw new Error('nepodařilo se spustit testovací osiřelý proces');
    }
    writeFileSync(pidFile, `${String(orphanPid)}\n`, 'utf8');

    // Konstruktor klienta spustí úklid → osiřelý PID dostane SIGKILL.
    const client = new EngineClient({ spawn: fakeCmd('ok'), timeMs: 200, pidFile });
    cleanup.push(() => client.close());

    expect(await waitUntilDead(orphanPid)).toBe(true);
    expect(existsSync(pidFile)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);
});

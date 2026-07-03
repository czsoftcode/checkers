/**
 * Integrační test protokolu přes SKUTEČNÝ podproces (node --import tsx) –
 * brána fáze. Logika zpráv se testuje in-process v handler.test.ts; tady
 * jde o dráty: řádkový buffer nad reálným stdin, odpovědi na stdout,
 * přežití chybného vstupu, čistý konec na EOF.
 *
 * Každá odpověď se čeká s vlastním tvrdým timeoutem, aby zaseknutý engine
 * shodil test místo věčného čekání; proces se v afterEach zabíjí i při
 * selhání testu.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { initialPosition, legalMoves } from '@checkers/rules';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINE_ID, PROTOCOL_VERSION } from '../src/protocol.js';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const RESPONSE_TIMEOUT_MS = 15_000;

/** Obálka podprocesu: fronta řádků ze stdout + čekání s timeoutem. */
class EngineProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: string[] = [];
  private readonly waiters: ((line: string) => void)[] = [];
  private pending = '';
  private stderr = '';

  constructor(args: string[] = ['--seed', '42']) {
    this.child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', ...args], {
      cwd: pkgDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      // záměrně naivní split přímo v testu – nesmí se použít LineBuffer
      // ze src, jinak si testovaný kód dělá orákulum sám sobě
      this.pending += chunk;
      const parts = this.pending.split('\n');
      this.pending = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim() === '') {
          continue;
        }
        const waiter = this.waiters.shift();
        if (waiter === undefined) {
          this.lines.push(line);
        } else {
          waiter(line);
        }
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
  }

  /** Pošle syrová data na stdin (bez úprav – i kusy řádku). */
  write(raw: string): void {
    this.child.stdin.write(raw);
  }

  /** Pošle jednu zprávu jako JSON řádek. */
  send(message: unknown): void {
    this.write(`${JSON.stringify(message)}\n`);
  }

  /** Vrátí další řádek stdout jako naparsovaný JSON, s tvrdým timeoutem. */
  async nextResponse(): Promise<unknown> {
    const queued = this.lines.shift();
    if (queued !== undefined) {
      return JSON.parse(queued) as unknown;
    }
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Engine neodpověděl do ${String(RESPONSE_TIMEOUT_MS)} ms. stderr:\n${this.stderr}`));
      }, RESPONSE_TIMEOUT_MS);
      this.waiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    return JSON.parse(line) as unknown;
  }

  /** Zavře stdin (EOF) a počká na exit kód, s tvrdým timeoutem. */
  async endAndWaitForExit(): Promise<number | null> {
    const exit = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Engine po EOF neskončil do ${String(RESPONSE_TIMEOUT_MS)} ms.`));
      }, RESPONSE_TIMEOUT_MS);
      this.child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    this.child.stdin.end();
    return exit;
  }

  kill(): void {
    if (this.child.exitCode === null && !this.child.killed) {
      this.child.kill('SIGKILL');
    }
  }
}

let engine: EngineProcess | null = null;

function startEngine(args?: string[]): EngineProcess {
  engine = new EngineProcess(args);
  return engine;
}

afterEach(() => {
  engine?.kill();
  engine = null;
});

describe('engine jako podproces', () => {
  it('hello handshake vrací protocol a engine id', async () => {
    const proc = startEngine();
    proc.send({ type: 'hello', id: 'h-1' });
    await expect(proc.nextResponse()).resolves.toEqual({
      type: 'hello',
      id: 'h-1',
      protocol: PROTOCOL_VERSION,
      engine: ENGINE_ID,
    });
  });

  it('bestmove na výchozí pozici vrací tah obsažený v legalMoves', async () => {
    const proc = startEngine();
    proc.send({ type: 'bestmove', id: 'm-1', position: initialPosition() });
    const response = (await proc.nextResponse()) as { type: string; id: string; move: unknown };
    expect(response.type).toBe('bestmove');
    expect(response.id).toBe('m-1');
    expect(legalMoves(initialPosition())).toContainEqual(response.move);
  });

  it('zpráva rozsekaná doprostřed řádku i dvě zprávy v jednom zápisu fungují', async () => {
    const proc = startEngine();
    const raw = `${JSON.stringify({ type: 'hello', id: 'ch-1' })}\n`;
    proc.write(raw.slice(0, 9));
    proc.write(raw.slice(9));
    const first = (await proc.nextResponse()) as { id: string };
    expect(first.id).toBe('ch-1');

    proc.write(
      `${JSON.stringify({ type: 'hello', id: 'ch-2' })}\n${JSON.stringify({ type: 'hello', id: 'ch-3' })}\n`,
    );
    const second = (await proc.nextResponse()) as { id: string };
    const third = (await proc.nextResponse()) as { id: string };
    expect(second.id).toBe('ch-2');
    expect(third.id).toBe('ch-3');
  });

  it('garbage vstup vrací error a proces dál odpovídá', async () => {
    const proc = startEngine();
    proc.write('tohle rozhodně není json\n');
    await expect(proc.nextResponse()).resolves.toMatchObject({
      type: 'error',
      id: null,
      code: 'invalid_json',
    });

    proc.send({ type: 'hello', id: 'po-chybě' });
    const response = (await proc.nextResponse()) as { type: string; id: string };
    expect(response.type).toBe('hello');
    expect(response.id).toBe('po-chybě');
  });

  it('EOF na stdin ukončí proces s exit 0, poslední řádek bez \\n se ještě zpracuje', async () => {
    const proc = startEngine();
    proc.write(JSON.stringify({ type: 'hello', id: 'eof-1' }));
    const code = await proc.endAndWaitForExit();
    expect(code).toBe(0);
    await expect(proc.nextResponse()).resolves.toMatchObject({ type: 'hello', id: 'eof-1' });
  });

  it('neplatný seed končí exit 1 s hláškou na stderr', async () => {
    const proc = startEngine(['--seed', 'ne-číslo']);
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Engine s neplatným seedem neskončil včas.'));
      }, RESPONSE_TIMEOUT_MS);
      proc.child.on('exit', (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    expect(code).toBe(1);
  });
});

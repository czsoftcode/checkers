/**
 * Smoke testy spustitelného CLI přes skutečný podproces (node --import tsx):
 * exit kódy a základní výstup. Logika režimů se testuje in-process
 * v modes.test.ts – tady jde o dráty: argumenty, stdin/stdout, exit kód.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));

function runCli(
  args: string[],
  input = '',
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts', ...args], {
    cwd: pkgDir,
    input,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('CLI podproces', () => {
  it('random režim dohraje partii a končí exit 0', () => {
    const { status, stdout } = runCli(['--mode', 'random', '--seed', '7']);
    expect(status).toBe(0);
    expect(stdout).toContain('Random vs random, seed 7');
    expect(stdout).toContain('Výsledek: ');
  }, 60_000);

  it('random režim je deterministický podle seedu', () => {
    const first = runCli(['--mode', 'random', '--seed', '11']);
    const second = runCli(['--mode', 'random', '--seed', '11']);
    expect(first.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  }, 60_000);

  it('human režim: víceřádkový stdin se neztrácí, EOF = čisté přerušení s exit 2', () => {
    // Pipe doručí všechny řádky naráz – CLI nesmí zahodit řádky, které
    // přijdou mezi dvěma prompty (chyba původní implementace přes
    // rl.question). Chybný řádek dostane hlášku a hraje se dál. Přerušená
    // (nedohraná) partie končí exit 2, aby ji volající skript odlišil
    // od dohrané.
    const { status, stdout, stderr } = runCli(
      ['--mode', 'human', '--seed', '1'],
      '11-15\nblbost\n8-11\n',
    );
    expect(status).toBe(2);
    expect(stdout).toContain('1. černý: 11-15');
    expect(stdout).toContain('2. bílý: ');
    expect(stderr).toContain('blbost');
    expect(stdout).toContain('3. černý: 8-11');
    expect(stdout).toContain('4. bílý: ');
    expect(stdout).toContain('Partie přerušena');
  }, 60_000);

  it('neznámý režim končí exit 1 s nápovědou', () => {
    const { status, stderr } = runCli(['--mode', 'wtf']);
    expect(status).toBe(1);
    expect(stderr).toContain('Neznámý režim');
    expect(stderr).toContain('Použití:');
  }, 60_000);

  it('neplatný seed končí exit 1', () => {
    const { status, stderr } = runCli(['--mode', 'random', '--seed', 'abc']);
    expect(status).toBe(1);
    expect(stderr).toContain('Neplatný seed');
  }, 60_000);

  it('prázdný seed (--seed=) končí exit 1, nehraje tiše se seedem 0', () => {
    const { status, stderr } = runCli(['--mode', 'random', '--seed=']);
    expect(status).toBe(1);
    expect(stderr).toContain('Neplatný seed');
  }, 60_000);

  it('--color v random režimu končí exit 1, tiše se neignoruje', () => {
    const { status, stderr } = runCli(['--mode', 'random', '--seed', '1', '--color', 'white']);
    expect(status).toBe(1);
    expect(stderr).toContain('--color');
  }, 60_000);

  it('neznámý přepínač končí exit 1', () => {
    const { status, stderr } = runCli(['--bogus']);
    expect(status).toBe(1);
    expect(stderr).toContain('Použití:');
  }, 60_000);

  it('neplatná barva končí exit 1', () => {
    const { status, stderr } = runCli(['--mode', 'human', '--color', 'zeleny']);
    expect(status).toBe(1);
    expect(stderr).toContain('Neplatná barva');
  }, 60_000);
});

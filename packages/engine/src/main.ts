/**
 * Vstupní bod enginu: `pnpm --filter @checkers/engine start`.
 *
 * Dráty procesu: stdin → LineBuffer → respondToLine → stdout (jedna
 * odpověď = jeden řádek JSON). Engine je dlouhoběžící proces: chybný vstup
 * vrací odpověď `error` a proces žije dál; nečekaná výjimka handleru se
 * loguje se stackem na stderr a vrací `internal_error` (viz respond.ts).
 *
 * Exit kódy: 0 = konec spojení (EOF na stdin, nebo protistrana zavřela
 * stdout rouru – typicky spadlý server, není komu odpovídat), 1 = chybné
 * argumenty. Jiné cesty ukončení nejsou.
 */

import { parseArgs } from 'node:util';

import { LineBuffer } from './line-buffer.js';
import { mulberry32 } from './prng.js';
import { respondToLine } from './respond.js';

const USAGE = [
  'Použití: pnpm --filter @checkers/engine start -- [volby]',
  '',
  'Volby:',
  '  --seed <n>   seed PRNG pro výběr tahu, nezáporné celé číslo;',
  '               bere se dolních 32 bitů (výchozí: z hodin)',
  '',
  'Protokol: JSON Lines na stdin/stdout, exit 0 při EOF na stdin.',
].join('\n');

function parseSeed(raw: string | undefined): number | null {
  if (raw === undefined) {
    return Date.now() >>> 0;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  return Number.parseInt(raw, 10) >>> 0;
}

function main(): number {
  let seedRaw: string | undefined;
  try {
    const { values } = parseArgs({ options: { seed: { type: 'string' } } });
    seedRaw = values.seed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n\n${USAGE}\n`);
    return 1;
  }

  const seed = parseSeed(seedRaw);
  if (seed === null) {
    process.stderr.write(`Neplatný seed: ${String(seedRaw)}\n\n${USAGE}\n`);
    return 1;
  }

  const rng = mulberry32(seed);
  const buffer = new LineBuffer();
  const logError = (text: string): void => {
    process.stderr.write(`${text}\n`);
  };

  const respond = (line: string): void => {
    process.stdout.write(`${JSON.stringify(respondToLine(line, rng, logError))}\n`);
  };

  // protistrana zavřela rouru (EPIPE, spadlý server) – není komu odpovídat;
  // bez handleru by 'error' event shodil proces jako uncaught exception
  process.stdout.on('error', () => {
    process.exit(0);
  });
  process.stdin.on('error', () => {
    process.exit(0);
  });

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const line of buffer.push(chunk)) {
      respond(line);
    }
  });
  process.stdin.on('end', () => {
    const rest = buffer.flush();
    if (rest !== null) {
      respond(rest);
    }
    // žádní další posluchači → event loop se vyprázdní a proces končí 0
  });

  return 0;
}

const code = main();
if (code !== 0) {
  process.exitCode = code;
}

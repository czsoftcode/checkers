/**
 * Vstupní bod CLI: `pnpm --filter @checkers/cli start -- [volby]`.
 *
 * Exit kódy: 0 = dohraná partie s vypsaným výsledkem, 1 = chybné argumenty
 * nebo runtime chyba, 2 = partie přerušená člověkem (EOF/Ctrl+C, s hláškou).
 * Žádná cesta nekončí 0 bez vypsaného výsledku – skript volající CLI pozná
 * nedohranou partii z exit kódu, ne až parsováním výstupu.
 */

import * as readline from 'node:readline';
import { parseArgs } from 'node:util';

import type { CliIO } from './modes.js';
import { runHumanVsRandom, runRandomVsRandom } from './modes.js';

const USAGE = [
  'Použití: pnpm --filter @checkers/cli start -- [volby]',
  '',
  'Volby:',
  '  --mode random|human   režim hry (výchozí random)',
  '  --seed <n>            seed PRNG, nezáporné celé číslo (výchozí: z hodin)',
  '  --color black|white   barva člověka v režimu human (výchozí black; černý táhne první)',
  '  --help                vypíše tuto nápovědu',
  '',
  'Exit kódy: 0 dohraná partie, 1 chyba, 2 partie přerušená (EOF/Ctrl+C)',
].join('\n');

function usageError(message: string): number {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  return 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Terminálová implementace CliIO nad readline. Konec vstupu (EOF, Ctrl+D)
 * i Ctrl+C se hlásí jako `null` z readLine – režim je přeloží na čisté
 * přerušení partie.
 *
 * Řádky se sbírají do vlastní fronty přes událost 'line', NE přes
 * rl.question: question zachytí jen řádek, který přijde až po zavolání.
 * U pipe vstupu (echo tahů do CLI) dorazí všechny řádky naráz a ty mezi
 * dvěma otázkami by se tiše zahodily – tahy by mizely.
 */
function makeTerminalIo(): { io: CliIO; close: () => void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pending: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;
  rl.on('line', (line) => {
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
      return;
    }
    pending.push(line);
  });
  rl.on('close', () => {
    closed = true;
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });
  rl.on('SIGINT', () => {
    rl.close();
  });
  const io: CliIO = {
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    err: (line) => {
      process.stderr.write(`${line}\n`);
    },
    readLine: (prompt) =>
      new Promise((resolve) => {
        const buffered = pending.shift();
        if (buffered !== undefined) {
          resolve(buffered);
          return;
        }
        if (closed) {
          resolve(null);
          return;
        }
        if (waiting !== null) {
          // Herní smyčka je sekvenční – dvě souběžné otázky jsou programová
          // chyba, ne stav k tichému přežití.
          throw new Error('Souběžné čtení vstupu – readLine zavolán před vyřízením předchozího');
        }
        process.stdout.write(prompt);
        waiting = resolve;
      }),
  };
  return {
    io,
    close: () => {
      if (!closed) {
        rl.close();
      }
    },
  };
}

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        mode: { type: 'string', default: 'random' },
        seed: { type: 'string' },
        color: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    return usageError(errorMessage(error));
  }

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const mode = values.mode;
  if (mode !== 'random' && mode !== 'human') {
    return usageError(`Neznámý režim „${mode}" – povolené hodnoty: random, human.`);
  }

  let seed: number;
  if (values.seed === undefined) {
    // Bez --seed hraje pokaždé jiná partie; seed se vypisuje, takže je
    // každá partie zpětně reprodukovatelná.
    seed = Date.now() >>> 0;
  } else {
    // Jen číslice: Number() by tiše přijalo '' (=0), '0x10', '1e3' i mezery
    // – překlep v shell skriptu by zdegeneroval na deterministický seed 0.
    if (!/^\d+$/.test(values.seed)) {
      return usageError(`Neplatný seed „${values.seed}" – čekám nezáporné celé číslo.`);
    }
    seed = Number(values.seed);
    if (!Number.isSafeInteger(seed)) {
      return usageError(`Neplatný seed „${values.seed}" – hodnota je příliš velká.`);
    }
  }

  const color = values.color ?? 'black';
  if (color !== 'black' && color !== 'white') {
    return usageError(`Neplatná barva „${color}" – povolené hodnoty: black, white.`);
  }
  if (mode === 'random' && values.color !== undefined) {
    // Tiše ignorovaná volba by budila dojem, že něco dělá.
    return usageError('Volba --color platí jen pro režim human.');
  }

  if (mode === 'random') {
    await runRandomVsRandom(seed, {
      out: (line) => {
        process.stdout.write(`${line}\n`);
      },
    });
    return 0;
  }

  const { io, close } = makeTerminalIo();
  try {
    const outcome = await runHumanVsRandom(seed, color, io);
    return outcome === 'aborted' ? 2 : 0;
  } finally {
    close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Nečekaná chyba: stack se tiskne celý – zpráva bez stacku by
    // programovou chybu (TypeError apod.) maskovala jako běžné selhání.
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`Chyba: ${detail}\n`);
    process.exitCode = 1;
  },
);

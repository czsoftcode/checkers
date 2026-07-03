import { describe, expect, it } from 'vitest';

import type { CliIO } from '../src/modes.js';
import { runHumanVsRandom, runRandomVsRandom } from '../src/modes.js';

/** Sběrné IO: výstup do polí, vstup ze scénáře (fronta řádků, pak EOF). */
function scriptedIo(inputs: (string | null)[]): {
  io: CliIO;
  outLines: string[];
  errLines: string[];
} {
  const queue = [...inputs];
  const outLines: string[] = [];
  const errLines: string[] = [];
  const io: CliIO = {
    out: (line) => {
      outLines.push(line);
    },
    err: (line) => {
      errLines.push(line);
    },
    readLine: () => Promise.resolve(queue.length > 0 ? (queue.shift() ?? null) : null),
  };
  return { io, outLines, errLines };
}

describe('runRandomVsRandom', () => {
  it('odehraje partii, vypíše tahy a výsledek', async () => {
    const { io, outLines } = scriptedIo([]);
    const result = await runRandomVsRandom(42, io);
    expect(['black-wins', 'white-wins', 'draw']).toContain(result);
    expect(outLines.some((line) => line.startsWith('1. černý: '))).toBe(true);
    expect(outLines.some((line) => line.startsWith('Výsledek: '))).toBe(true);
  });

  it('je deterministický: stejný seed => stejný výstup', async () => {
    const first = scriptedIo([]);
    const second = scriptedIo([]);
    await runRandomVsRandom(42, first.io);
    await runRandomVsRandom(42, second.io);
    expect(second.outLines).toEqual(first.outLines);
  });
});

describe('runHumanVsRandom', () => {
  it('nesmyslný a nelegální vstup odmítne s hláškou a ptá se dál; EOF partii čistě přeruší', async () => {
    const { io, outLines, errLines } = scriptedIo([
      'nesmysl', // žádný oddělovač => RangeError z parseMove
      '99-100', // pole mimo 1–32 => RangeError z parseMove
      '', // prázdný řádek => jen nový prompt, bez hlášky
      '1-5', // strukturálně platné, ale nelegální (obě pole obsazená)
      '11-15', // legální otevření černého
      null, // EOF při druhém tahu člověka
    ]);
    const result = await runHumanVsRandom(3, 'black', io);
    expect(result).toBe('aborted');
    expect(errLines).toHaveLength(3);
    expect(errLines[2]).toMatch(/není legální/);
    expect(outLines.some((line) => line === '1. černý: 11-15')).toBe(true);
    expect(outLines.some((line) => line.startsWith('2. bílý: '))).toBe(true);
    expect(outLines.some((line) => line.includes('Partie přerušena'))).toBe(true);
  });

  it('okamžitý EOF partii přeruší bez jediného tahu', async () => {
    const { io, outLines } = scriptedIo([]);
    const result = await runHumanVsRandom(1, 'black', io);
    expect(result).toBe('aborted');
    expect(outLines.some((line) => line.includes('Partie přerušena'))).toBe(true);
    expect(outLines.some((line) => line.startsWith('1. '))).toBe(false);
  });

  it('člověk (bílý) dohraje celou partii – robot čte nabídku legálních tahů', async () => {
    // Vstupní robot hraje vždy první nabízený tah: čte poslední řádek
    // „Legální tahy: …" ze skutečného výstupu. Testuje se tak celá smyčka
    // včetně promptu, výpisu tahů a závěrečného výsledku.
    const outLines: string[] = [];
    const io: CliIO = {
      out: (line) => {
        outLines.push(line);
      },
      err: (line) => {
        throw new Error(`Nečekaná chybová hláška: ${line}`);
      },
      readLine: () => {
        const offer = [...outLines].reverse().find((line) => line.includes('Legální tahy: '));
        if (offer === undefined) {
          throw new Error('Nabídka legálních tahů se nevypsala před promptem');
        }
        const [, list] = offer.split('Legální tahy: ');
        const first = list?.split(', ')[0];
        if (first === undefined || first === '') {
          throw new Error(`Prázdná nabídka tahů: ${offer}`);
        }
        return Promise.resolve(first);
      },
    };
    const result = await runHumanVsRandom(5, 'white', io);
    expect(['black-wins', 'white-wins', 'draw']).toContain(result);
    expect(outLines.some((line) => line.startsWith('Výsledek: '))).toBe(true);
  });
});

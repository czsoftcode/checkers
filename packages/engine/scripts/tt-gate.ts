/**
 * Brána fáze 17: prokáže (nebo vyvrátí), že transpoziční tabulka na FIXNÍ
 * hloubce ubere prohledané uzly, ANIŽ by změnila výsledek.
 *
 * Metodika (viz .mini/discuss/phase-017.md):
 * 1. Na sadě rozehraných pozic se pro každou spustí `searchRoot` na téže
 *    fixní hloubce DVAKRÁT: bez TT a s čerstvou TT.
 * 2. KOREKTNOST (tvrdá): množina nejlepších tahů i skóre se musí shodovat.
 *    Rozejití = TT tiše mění výsledek → FAIL (kalibrace remíz stojí na tom,
 *    že kořen vrací všechny shodně nejlepší tahy).
 * 3. ÚBYTEK UZLŮ (tvrdá): součet uzlů s TT musí být měřitelně nižší než bez
 *    TT. Bez úbytku nemá TT smysl → FAIL.
 * 4. ČAS je jen ORIENTAČNÍ (měkký, NErozhoduje o verdiktu): hash se počítá
 *    přepočtem 32 polí na uzel, takže úbytek uzlů se na hodinách nemusí
 *    projevit 1:1. Číslo se vypíše jako varování, ne jako brána.
 *
 * Exit kódy (checklist projektu – crash ≠ výsledek):
 *   0 = úbytek uzlů prokázán a výsledky se shodují (PASS),
 *   1 = žádný úbytek NEBO výsledek se rozešel (legitimní FAIL),
 *   2 = špatný argument,
 *   3 = neočekávaná chyba (bug brány / rules / searche) – vypíše stack.
 * FAIL (1) je platný výsledek, ne chyba skriptu; crash (3) je chyba k opravě.
 *
 * Spuštění: pnpm --filter @checkers/engine tt-gate [hloubka] [pozice]
 */

import { searchRoot } from '../src/search.js';
import type { SearchResult } from '../src/search.js';
import { TranspositionTable } from '../src/transposition.js';

import { randomPlayedPosition } from '../test/support/position.js';

/** Rozsah náhodných úvodních půltahů fixtures (rozehrané, ne triviální). */
const MIN_PLIES = 6;
const MAX_PLIES = 20;

function parsePositiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) {
    return fallback;
  }
  // Striktní: jen prosté číslice. Number("1e3")/"0x10"/" 3 " by tiše prošly.
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    process.stderr.write(`Neplatný argument ${label}: "${raw}" (čekám kladné celé číslo)\n`);
    process.exit(2);
  }
  return Number(raw);
}

/** Výsledky se shodují, když sedí skóre i sekvence nejlepších tahů. */
function sameResult(a: SearchResult, b: SearchResult): boolean {
  return a.score === b.score && JSON.stringify(a.bestMoves) === JSON.stringify(b.bestMoves);
}

function main(): void {
  const depth = parsePositiveInt(process.argv[2], 6, 'hloubka');
  const count = parsePositiveInt(process.argv[3], 24, 'pozice');

  process.stdout.write(
    `Brána fáze 17 – TT úbytek uzlů: ${String(count)} pozic na fixní hloubce ${String(depth)}.\n`,
  );

  let nodesWith = 0;
  let nodesWithout = 0;
  let msWith = 0;
  let msWithout = 0;
  let mismatches = 0;

  for (let i = 0; i < count; i++) {
    // Různé (seed, plies) → různé rozehrané pozice; deterministické.
    const plies = MIN_PLIES + (i % (MAX_PLIES - MIN_PLIES + 1));
    const position = randomPlayedPosition(i + 1, plies);

    const t0 = performance.now();
    const without = searchRoot(position, depth);
    msWithout += performance.now() - t0;

    const t1 = performance.now();
    const withTt = searchRoot(position, depth, undefined, new TranspositionTable());
    msWith += performance.now() - t1;

    if (!sameResult(without, withTt)) {
      mismatches += 1;
      process.stderr.write(
        `ROZPOR na pozici #${String(i)}: bez TT score=${String(without.score)} ` +
          `vs s TT score=${String(withTt.score)} (tahy ${JSON.stringify(without.bestMoves)} ` +
          `vs ${JSON.stringify(withTt.bestMoves)})\n`,
      );
    }
    nodesWithout += without.nodes;
    nodesWith += withTt.nodes;
  }

  const reduction = nodesWithout === 0 ? 0 : 1 - nodesWith / nodesWithout;
  const timeRatio = msWith === 0 ? 0 : msWith / msWithout;

  process.stdout.write(
    `\nUzly:  bez TT ${String(nodesWithout)}, s TT ${String(nodesWith)} ` +
      `→ úbytek ${(reduction * 100).toFixed(1)} %.\n` +
      `Čas (ORIENTAČNĚ, nerozhoduje): bez TT ${msWithout.toFixed(0)} ms, s TT ${msWith.toFixed(0)} ms ` +
      `→ poměr ${timeRatio.toFixed(2)}× ${timeRatio > 1 ? '(TT na hodinách POMALEJŠÍ – režie hashe)' : '(TT rychlejší)'}.\n` +
      `Rozpory výsledku: ${String(mismatches)}.\n`,
  );

  const resultsMatch = mismatches === 0;
  const nodesReduced = nodesWith < nodesWithout;
  const pass = resultsMatch && nodesReduced;

  process.stdout.write(
    `\nKorektnost (shoda výsledků): ${resultsMatch ? 'ok' : 'ROZPOR'}. ` +
      `Úbytek uzlů: ${nodesReduced ? 'ano' : 'ne'}.\n` +
      `VERDIKT: ${pass ? 'PASS – TT ubírá uzly a nemění výsledek' : 'FAIL'}\n`,
  );

  process.exit(pass ? 0 : 1);
}

try {
  main();
} catch (error) {
  // Neočekávaná chyba NESMÍ vypadat jako legitimní FAIL (exit 1). Odlišný
  // kód 3 + stack; process.exit(0/1/2) uvnitř main() sem nepropadne.
  process.stderr.write(
    `Neočekávaná chyba brány:\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(3);
}

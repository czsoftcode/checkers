/**
 * Brána fáze 16: prokáže (nebo vyvrátí), že evaluace v2 je silnější než v1.
 *
 * Metodika (viz .mini/discuss/phase-016.md):
 * 1. KONTROLNÍ běh v1-vs-v1 na týchž zahájeních = SANITY CHECK harnessu:
 *    identické evaluace mají skončit ~50 %. Velká odchylka = podezřelý
 *    harness (label bias), ne vstup do prahu experimentu. Šum jednoho běhu
 *    NEohraničuje rozptyl experimentu (self-review fáze 16, nález 2) – proto
 *    se práh experimentu opírá o standardní chybu při daném N, ne o kontrolu.
 * 2. EXPERIMENT v2-vs-v1 na týchž zahájeních.
 * 3. PASS = (a) žádná regrese (nová neprohraje víc partií, než vyhraje)
 *    A ZÁROVEŇ (b) skóre experimentu překoná 50 % o statisticky významný
 *    odstup (2σ, kde σ ≈ 0,5/√N; min. o pevný polštář a nad podlahou 55 %)
 *    A ZÁROVEŇ (c) kontrola není podezřelá.
 *
 * Exit kódy (bod 1 projektového checklistu – crash ≠ výsledek):
 *   0 = převaha prokázána (PASS),
 *   1 = převaha NEprokázána / regrese / podezřelá kontrola (legitimní FAIL),
 *   2 = špatný argument,
 *   3 = neočekávaná chyba (bug harnessu / rules) – vypíše stack.
 * FAIL (1) je platný výsledek, ne chyba skriptu; crash (3) je chyba k opravě.
 *
 * Fixní hloubka (ne čas): brána měří kvalitu evaluace, ne její rychlost.
 * Spuštění: pnpm --filter @checkers/engine selfplay-gate [zahájení] [hloubka]
 */

import { evaluate, evaluateV2 } from '../src/evaluate.js';
import { generateOpenings, runMatch } from '../src/selfplay.js';
import type { MatchResult } from '../src/selfplay.js';

/** Orientační dolní práh skóre z diskuse; pod ním nemá smysl mluvit o převaze. */
const SCORE_FLOOR = 0.55;

/** Bezpečnostní polštář nad naměřeným šumem kontroly (skóre 0..1). */
const NOISE_CUSHION = 0.02;

/** Seed sady zahájení – stejná pro kontrolu i experiment (fér srovnání). */
const OPENINGS_SEED = 1;
/** Seed tie-breaku – oddělený pro kontrolu a experiment, ať nesdílí náhodu. */
const CONTROL_TIEBREAK_SEED = 10_000;
const EXPERIMENT_TIEBREAK_SEED = 20_000;

/** Počet náhodných úvodních půltahů zahájení (diverzita startovních pozic). */
const OPENING_PLIES = 6;

function parsePositiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) {
    return fallback;
  }
  // Striktní: jen prosté číslice. Number("1e3")/"0x10"/" 3 " by jinak tiše
  // prošly jako 1000/16/3 (self-review fáze 16, nález 6).
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    process.stderr.write(`Neplatný argument ${label}: "${raw}" (čekám kladné celé číslo)\n`);
    process.exit(2);
  }
  return Number(raw);
}

function avgMs(ms: number, moves: number): string {
  return moves === 0 ? 'n/a' : `${(ms / moves).toFixed(2)} ms/tah`;
}

function report(label: string, r: MatchResult): void {
  process.stdout.write(
    `${label}: skóre ${(r.scoreRate * 100).toFixed(1)} % ` +
      `(V ${String(r.wins)} / R ${String(r.draws)} / P ${String(r.losses)} z ${String(r.games)}); ` +
      `nová ${avgMs(r.newMs, r.newMoves)}, stará ${avgMs(r.oldMs, r.oldMoves)}\n`,
  );
}

function main(): void {
  const openingsCount = parsePositiveInt(process.argv[2], 100, 'zahájení');
  const depth = parsePositiveInt(process.argv[3], 6, 'hloubka');
  const games = openingsCount * 2;

  process.stdout.write(
    `Brána fáze 16 – self-play v2 vs v1: ${String(openingsCount)} zahájení × 2 = ` +
      `${String(games)} partií na hloubce ${String(depth)}, ${String(OPENING_PLIES)} úvodních půltahů.\n`,
  );

  const openings = generateOpenings(OPENINGS_SEED, openingsCount, OPENING_PLIES);

  // Kontrola: identická evaluace proti sobě → šum harnessu.
  const control = runMatch({
    newEval: evaluate,
    oldEval: evaluate,
    openings,
    depth,
    seed: CONTROL_TIEBREAK_SEED,
  });
  report('KONTROLA v1-vs-v1', control);

  // Experiment: nová evaluace proti staré.
  const experiment = runMatch({
    newEval: evaluateV2,
    oldEval: evaluate,
    openings,
    depth,
    seed: EXPERIMENT_TIEBREAK_SEED,
  });
  report('EXPERIMENT v2-vs-v1', experiment);

  // Práh experimentu: 50 % + 2σ (σ ≈ 0,5/√N, horní odhad – remízy ji jen
  // snižují), min. o pevný polštář a nad orientační podlahou 55 %. Nezávisí
  // na jednom šumovém běhu kontroly (self-review nález 2).
  const stdError = 0.5 / Math.sqrt(experiment.games);
  const margin = Math.max(NOISE_CUSHION, 2 * stdError);
  const requiredRate = Math.max(SCORE_FLOOR, 0.5 + margin);

  // Kontrola je sanity check harnessu, ne vstup do prahu: velká odchylka
  // identických evaluací od 50 % (> 3σ, min. 10 pb) = podezřelý harness.
  const controlDev = Math.abs(control.scoreRate - 0.5);
  const controlLimit = Math.max(0.1, 3 * (0.5 / Math.sqrt(control.games)));
  const controlSuspect = controlDev > controlLimit;

  const noRegression = experiment.losses <= experiment.wins;
  const beatsThreshold = experiment.scoreRate >= requiredRate;
  const pass = noRegression && beatsThreshold && !controlSuspect;

  process.stdout.write(
    `\nKontrola (sanity): odchylka ±${(controlDev * 100).toFixed(1)} pb od 50 %` +
      ` (limit ±${(controlLimit * 100).toFixed(1)} pb) → ${controlSuspect ? 'PODEZŘELÝ harness' : 'ok'}.\n` +
      `Požadované skóre experimentu ≥ ${(requiredRate * 100).toFixed(1)} % (50 % + ${(margin * 100).toFixed(1)} pb, N=${String(experiment.games)}).\n` +
      `Regrese (P > V)? ${noRegression ? 'ne' : 'ANO'}. ` +
      `Skóre nad prahem? ${beatsThreshold ? 'ano' : 'ne'}.\n` +
      `VERDIKT: ${pass ? 'PASS – v2 prokázala převahu' : 'FAIL – převaha neprokázána'}\n`,
  );

  process.exit(pass ? 0 : 1);
}

try {
  main();
} catch (error) {
  // Neočekávaná chyba (bug harnessu / rules) NESMÍ vypadat jako legitimní
  // FAIL (exit 1) – jinak se bug čte jako „v2 je slabší" (nález 1). Odlišný
  // kód 3 + stack; process.exit(0/1/2) uvnitř main() sem nepropadne.
  process.stderr.write(`Neočekávaná chyba brány:\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(3);
}

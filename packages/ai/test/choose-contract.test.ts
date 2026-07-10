/**
 * KONTRAKTNÍ TEST (fáze 86): orchestrátor `computeAiMove` == serverová cesta.
 *
 * Přibíjí, že offline výběr tahu (`computeAiMove`) dá pro tutáž pozici + seed +
 * úroveň TÝŽ tah jako server. „Serverová cesta" se rekonstruuje z REÁLNÉHO kódu
 * obou serverových větví, ne z kopie:
 *  - hledací větev = `@checkers/engine` `handleLine` (to, co v provozu běží v
 *    podprocesu enginu za stdiem) se seedovaným `rng` a pevnými hodinami,
 *  - knižní větev = `lookupBookMove` + re-validace legality, přesně jako app.ts
 *    (`runEngineMove`) hraje knižní tah BEZ volání enginu.
 *
 * PROČ NE proti živému podprocesu: produkční podproces je NESEEDOVANÝ
 * (`Date.now`, spawn bez seedu), deterministicky se s ním srovnávat nedá.
 * `handleLine` je ale doslova to, co podproces za stdiem spouští – bere `rng` i
 * `now` zvenčí, takže se dá přibít bit po bitu.
 *
 * DETERMINISMUS (jinak test bliká): obě strany dostanou STEJNÝ seed, pevné
 * konstantní hodiny (`() => 0`) A pevný `maxDepth` – bez toho by na zatíženém CI
 * každá strana došla do jiné hloubky a tah by se náhodně rozešel.
 *
 * ZUBY: kdyby se síla jedné strany změnila (jiný `rankRoot`, jiná `carelessness`,
 * jiný strop, vynechaná kniha), tahy se na některé pozici rozejdou → `toEqual`
 * padne. Ověřeno napříč reprezentativními pozicemi (knižní i mimoknižní), všemi
 * úrovněmi a víc seedy; `searchCases > 0` garantuje, že se hledací větev opravdu
 * projela (ne že vše spadlo do knihy).
 */

import { describe, expect, it } from 'vitest';

import { applyMove, initialPosition, legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import { handleLine } from '@checkers/engine';
import type { Strength } from '@checkers/engine';

import {
  LEVELS,
  OPENING_BOOK,
  STRENGTH_BY_LEVEL,
  computeAiMove,
  levelUsesBook,
  lookupBookMove,
} from '../src/index.js';
import { mulberry32 } from './support/prng.js';

/** Pevné konstantní hodiny → hloubka je řízena JEN `maxDepth`, čas nehraje roli. */
const fixedNow = (): number => 0;
/** Pevný strop hloubky pro OBĚ strany – bez něj by pro/champ/edu (bez stropu)
 *  hledaly do MAX_SEARCH_DEPTH a test by trval věčnost. Nízký = rychlý a stále reálný. */
const FIXED_DEPTH = 6;
const TIME_MS = 1000;
const SEEDS = [1, 20260710];

describe('kontrakt: computeAiMove == serverová cesta (handleLine + kniha)', () => {
  it('tatáž pozice + seed + úroveň → týž tah, přes reprezentativní pozice', () => {
    const positions = representativePositions();
    // Pojistka, že vzorek pozic vůbec obsahuje mimoknižní i knižní (jinak by test
    // nechtěně netestoval jednu z větví).
    expect(positions.some((p) => lookupBookMove(OPENING_BOOK, p) !== undefined)).toBe(true);
    expect(positions.some((p) => lookupBookMove(OPENING_BOOK, p) === undefined)).toBe(true);

    let searchCases = 0;

    for (const position of positions) {
      for (const level of LEVELS) {
        // Nepozornost i strop hloubky se berou z REÁLNÉ mapy úrovní. Úrovně se
        // stropem (beginner 1, intermediate 3) se tak testují na produkční hloubce;
        // úrovně BEZ stropu (pro/champ/edu) dostanou FIXED_DEPTH – jinak by hledaly
        // do MAX_SEARCH_DEPTH a test by běžel věčnost. FIXED_DEPTH i pevný `now`
        // zaručí determinismus (obě strany prohledají identicky).
        const base = STRENGTH_BY_LEVEL[level];
        const carelessness = base?.carelessness ?? 0;
        const strength: Strength = { maxDepth: base?.maxDepth ?? FIXED_DEPTH, carelessness };

        for (const seed of SEEDS) {
          const server = serverDecision(position, level, strength, seed);
          const ai = computeAiMove(
            position,
            {
              strength,
              timeMs: TIME_MS,
              now: fixedNow,
              ...(levelUsesBook(level) ? { book: OPENING_BOOK } : {}),
            },
            mulberry32(seed),
          );
          expect(ai).toEqual(server.move);
          if (server.viaSearch) {
            searchCases += 1;
          }
        }
      }
    }

    expect(searchCases).toBeGreaterThan(0);
  });
});

/**
 * Tah, který by zahrál server: knižní úroveň v knižní pozici → knižní tah (jako
 * app.ts, BEZ enginu); jinak → `handleLine` (to, co běží v podprocesu enginu).
 */
function serverDecision(
  position: Position,
  level: (typeof LEVELS)[number],
  strength: Strength,
  seed: number,
): { readonly move: Move; readonly viaSearch: boolean } {
  if (levelUsesBook(level)) {
    const bookMove = lookupBookMove(OPENING_BOOK, position);
    if (bookMove !== undefined) {
      // Server NEaplikuje syrový knižní objekt, ale výsledek `findLegalMove`
      // (app.ts:1419) – tah odvozený z `rules`. Test proto porovnává právě ten:
      // nezávislý zdroj (rules) vs. co vrátí computeAiMove (knihu). Kdyby se knižní
      // objekt a legální tah pro tuto pozici lišily (jiné captures/path), padne.
      const applied = matchLegalMove(position, bookMove);
      if (applied !== undefined) {
        return { move: applied, viaSearch: false };
      }
    }
  }
  // Sestav bestmove request přesně jako by ho poslal server enginu a prožeň ho
  // reálným handlerem se seedovaným rng a pevnými hodinami.
  const request = JSON.stringify({
    type: 'bestmove',
    id: 'contract',
    position,
    timeMs: TIME_MS,
    maxDepth: strength.maxDepth,
    carelessness: strength.carelessness ?? 0,
  });
  const response = handleLine(request, mulberry32(seed), fixedNow);
  if (response.type !== 'bestmove') {
    throw new Error(`handleLine vrátil "${response.type}", čekán bestmove.`);
  }
  return { move: response.move, viaSearch: true };
}

/**
 * Reprezentativní pozice: výchozí + několik po deterministickém přehrání prvních
 * legálních tahů (rychle opustí knihu). Mix knižních (výchozí + odpovědi bílého)
 * a mimoknižních (hlubší). Deterministické – žádná náhoda.
 */
function representativePositions(): Position[] {
  const positions: Position[] = [];
  let position = initialPosition();
  // Sber pozice na půltazích 0..8; výběr prvního legálního tahu je deterministický.
  for (let ply = 0; ply <= 8; ply++) {
    if (ply === 0 || ply === 1 || ply === 2 || ply === 5 || ply === 8) {
      positions.push(position);
    }
    const [first] = legalMoves(position);
    if (first === undefined) {
      break; // partie skončila – dál nejdeme
    }
    position = applyMove(position, first);
  }
  return positions;
}

/**
 * Legální tah v pozici odpovídající `move` (from + path prvek po prvku), nebo
 * `undefined` – TÝŽ kontrakt jako serverový `findLegalMove` (dto.ts): vrací tah
 * odvozený z `rules`, přesně to, co server pro knižní tah aplikuje.
 */
function matchLegalMove(position: Position, move: Move): Move | undefined {
  return legalMoves(position).find(
    (m) => m.from === move.from && samePath(m.path, move.path),
  );
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((sq, i) => sq === b[i]);
}

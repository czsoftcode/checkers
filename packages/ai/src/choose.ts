/**
 * Orchestrátor výběru tahu AI (fáze 86) – jedno in-process jádro `book → search
 * → chooseMove`, ze kterého staví tah AI budoucí prohlížečový offline klient.
 *
 * Přesně replikuje serverovou cestu z `app.ts` (`runEngineMove`) + `handler.ts`
 * (`handleBestmove`), aby se online (server přes podproces) a offline (tenhle
 * orchestrátor) síla NEROZEŠLY. Shodu se serverovou hledací větví přibíjí
 * kontraktní test (`choose-contract.test.ts`) nad reálným `handleLine`.
 *
 * Dvě větve, stejně jako server:
 *  1. Knižní – jen když volající předá knihu (`book`, tj. úroveň knihu užívá,
 *     viz `levelUsesBook`). Lookup → re-validace legality přes `rules` →
 *     legální knižní tah se zahraje BEZ hledání. Nelegální/chybějící knižní tah
 *     se zahodí a hledá se normálně (fallback), přesně jako app.ts.
 *  2. Hledací – `searchTimed` + `chooseMove` (tytéž primitivy jako `handleLine`).
 *     `rankRoot` jen pro nepozornou hru, chybějící `carelessness` = 0.
 *
 * Strop hloubky (offline `maxDepth`, ve vizi 12) je VOLITELNÝ parametr a v této
 * fázi ho server NEPŘEDÁVÁ – chová se tedy bit po bitu jako dnes. Aktivace stropu
 * je až v offline fázi.
 *
 * Balíček nesmí sáhnout na `node:` ani na `@checkers/server`; závisí jen na
 * `@checkers/rules` a `@checkers/engine`.
 */

import { legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import { chooseMove, searchTimed } from '@checkers/engine';
import type { Strength } from '@checkers/engine';

import { lookupBookMove } from './opening-book.js';
import type { OpeningBook } from './opening-book.js';

/** Parametry výběru tahu AI. */
export interface ComputeAiMoveOptions {
  /** Páky síly (mapa úroveň → síla je `STRENGTH_BY_LEVEL`). Chybí páky → Profesionál. */
  readonly strength: Strength;
  /** Měkký časový limit hledání v ms (kladné celé číslo, kontrakt `searchTimed`). */
  readonly timeMs: number;
  /**
   * VOLITELNÝ offline strop hloubky (ve vizi 12). Kombinuje se se `strength.maxDepth`
   * jako PŘÍSNĚJŠÍ z obou (menší). V této fázi ho server NEPŘEDÁVÁ (undefined) →
   * žádný efekt; strop se aktivuje až s offline klientem.
   */
  readonly maxDepth?: number;
  /**
   * Kniha zahájení. Když je předaná (úroveň knihu užívá), konzultuje se PŘED
   * hledáním; když ne, jde se rovnou hledat. Rozhodnutí „užít knihu" dělá volající
   * (přes `levelUsesBook`), stejně jako app.ts – orchestrátor jen ctí předanou knihu.
   */
  readonly book?: OpeningBook;
  /** Injektovatelné hodiny pro `searchTimed` (deterministické testy). */
  readonly now?: () => number;
}

/**
 * Vybere tah AI pro pozici. `rng` (rozsah [0,1)) dodává náhodu pro tie-break a
 * nepozornost – předává se zvenku (seedovatelný v testech), stejně jako u
 * `handleLine`. Pozice MUSÍ mít aspoň jeden legální tah (jinak `searchTimed`
 * vyhodí RangeError – volající to hlídá dřív, jako server přes efektivní výsledek).
 */
export function computeAiMove(
  position: Position,
  options: ComputeAiMoveOptions,
  rng: () => number,
): Move {
  const { strength, timeMs, book, now } = options;

  // 1. Knižní větev – přesně jako app.ts: lookup → re-validace legality přes
  //    rules. Legální knižní tah se zahraje bez hledání; jinak fallback na search.
  if (book !== undefined) {
    const bookMove = lookupBookMove(book, position);
    if (bookMove !== undefined && isLegalMove(position, bookMove)) {
      return bookMove;
    }
  }

  // 2. Hledací větev – bit po bitu jako handleBestmove (handler.ts).
  const carelessness = strength.carelessness ?? 0;
  const maxDepth = tighterDepth(strength.maxDepth, options.maxDepth);
  const { bestMoves, rankedMoves } = searchTimed(position, {
    timeMs,
    // rankRoot jen pro nepozornou hru; Profesionál (carelessness 0) hledá i losuje
    // rng identicky jako dřív. Stejná podmínka jako handleBestmove.
    rankRoot: carelessness > 0,
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(now !== undefined ? { now } : {}),
  });
  return chooseMove(bestMoves, rankedMoves, carelessness, rng);
}

/**
 * Přísnější (menší) z obou stropů hloubky; `undefined` = bez stropu. Slučuje
 * úrovňový `strength.maxDepth` s volitelným offline stropem tak, aby offline strop
 * úroveň mohl jen ZPŘÍSNIT, nikdy uvolnit (Začátečník s maxDepth 1 nesmí offline
 * stropem 12 zesílit na 12).
 */
function tighterDepth(levelDepth?: number, cap?: number): number | undefined {
  if (levelDepth === undefined) {
    return cap;
  }
  if (cap === undefined) {
    return levelDepth;
  }
  return Math.min(levelDepth, cap);
}

/**
 * Je `move` legální v této pozici? Porovnává `from` + `path` prvek po prvku proti
 * `legalMoves` – TÝŽ kontrakt jako serverový `findLegalMove` (dto.ts): kniha je
 * data, ne autorita, a knižní tah se musí re-validovat proti aktuální pozici.
 * `path` smí mít duplicity (kruhový skok dámy), proto se porovnává prvkově, ne přes Set.
 */
function isLegalMove(position: Position, move: Move): boolean {
  return legalMoves(position).some(
    (m) => m.from === move.from && pathsEqual(m.path, move.path),
  );
}

function pathsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

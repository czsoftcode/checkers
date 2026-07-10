import { describe, expect, it } from 'vitest';
import { OPENING_BOOK, STRENGTH_BY_LEVEL, computeAiMove, levelUsesBook } from '@checkers/ai';
import type { GameLevel } from '@checkers/ai';
import type { Move, Position } from '@checkers/rules';
import type { Strength } from '@checkers/engine';
import { createInProcessEngineWorker } from '../../src/local/engine-worker.js';
import type { EngineMoveRequest } from '../../src/local/compute-move.js';
import type { EngineWorker } from '../../src/local/engine-worker.js';
import { createLocalClient } from '../../src/local-client.js';
import type { GameDto } from '../../src/server-client.js';
import { makeClock, pollUntilSettled } from './helpers.js';

const ALL_LEVELS: readonly GameLevel[] = [
  'championship',
  'professional',
  'intermediate',
  'beginner',
  'education',
];

const SEED = 0x0bad_c0de;
const TIME_MS = 1;

/**
 * Spy worker: zaznamená KAŽDÝ požadavek i vrácený tah a jinak deleguje na
 * in-process jádro. Umožní porovnat tah, který LocalClient skutečně zahrál, se
 * serverovou referencí (`computeAiMove` se serverovou silou).
 */
function createSpyWorker(): { worker: EngineWorker; records: { req: EngineMoveRequest; move: Move }[] } {
  const inner = createInProcessEngineWorker({ now: makeClock() });
  const records: { req: EngineMoveRequest; move: Move }[] = [];
  const worker: EngineWorker = {
    async computeMove(req: EngineMoveRequest): Promise<Move> {
      const move = await inner.computeMove(req);
      records.push({ req, move });
      return move;
    },
  };
  return { worker, records };
}

/**
 * Referenční tah SERVEROVOU cestou: `computeAiMove` se silou `STRENGTH_BY_LEVEL`
 * (BEZ offline stropu 12 – server strop nemá) a s knihou podle `levelUsesBook`.
 * Seed i timeMs jako LocalClient; hodiny čerstvé (stejná hloubka 1). Na server je
 * to tranzitivní přes kontraktní test fáze 86 (`computeAiMove == handleLine`).
 */
function serverReferenceMove(position: Position, level: GameLevel, seed: number): Move {
  const serverStrength: Strength = STRENGTH_BY_LEVEL[level] ?? {};
  const book = levelUsesBook(level) ? { book: OPENING_BOOK } : {};
  return computeAiMove(
    position,
    { strength: serverStrength, timeMs: TIME_MS, ...book, now: makeClock() },
    (() => {
      // mulberry32(seed) inline, ať test nezávisí na privátním importu prng z src.
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })(),
  );
}

describe('LocalClient == computeAiMove (regrese proti serverové cestě, pevný seed)', () => {
  it('každý tah enginu z LocalClientu sedí na computeAiMove(stejná pozice+seed+síla) pro všechny úrovně', async () => {
    let comparisons = 0;
    for (const level of ALL_LEVELS) {
      const spy = createSpyWorker();
      const client = createLocalClient(spy.worker, {
        rng: (() => {
          // seedovaný los ballotu (Mistrovství) – ať je partie deterministická.
          let a = 424242;
          return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        })(),
        seed: () => SEED,
        timeMs: TIME_MS,
      });

      // Odehraj pár tahů člověka; engine odpoví po každém → několik tahů enginu
      // (rané v knize, pozdější mimo knihu = skutečné hledání).
      let state: GameDto = await client.createGame(level, 'black');
      state = await pollUntilSettled(client, state.id);
      for (let ply = 0; ply < 3 && state.result === 'ongoing'; ply++) {
        if (state.position.turn !== 'black') {
          break;
        }
        const [move] = state.legalMoves;
        if (move === undefined) {
          break;
        }
        await client.postMove(state.id, move.from, move.path);
        state = await pollUntilSettled(client, state.id);
      }

      expect(spy.records.length, `úroveň ${level}: engine musel aspoň jednou táhnout`).toBeGreaterThan(0);
      for (const { req, move } of spy.records) {
        const reference = serverReferenceMove(req.position, req.level, req.seed);
        expect(move.from, `${level}: from`).toBe(reference.from);
        expect([...move.path], `${level}: path`).toEqual([...reference.path]);
        comparisons++;
      }
    }
    expect(comparisons).toBeGreaterThanOrEqual(ALL_LEVELS.length);
  });
});

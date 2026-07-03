import { initialPosition } from '@checkers/rules';
import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../src/prng.js';
import { extractId, respondToLine } from '../src/respond.js';

/** rng mimo kontrakt [0, 1) – vyvolá RangeError uvnitř handleru. */
const brokenRng = (): number => 2;

describe('respondToLine – poslední záchrana', () => {
  it('validní zprávy deleguje na handler beze změny', () => {
    const raw = JSON.stringify({ type: 'hello', id: 'r-1' });
    const response = respondToLine(raw, mulberry32(1), () => {
      throw new Error('logError se nesmí volat na happy path');
    });
    expect(response).toMatchObject({ type: 'hello', id: 'r-1' });
  });

  it('výjimka handleru vrací internal_error s obnoveným id a stackem na logu', () => {
    const raw = JSON.stringify({ type: 'bestmove', id: 'r-2', position: initialPosition() });
    const logged: string[] = [];
    const response = respondToLine(raw, brokenRng, (text) => logged.push(text));
    expect(response).toEqual({
      type: 'error',
      id: 'r-2',
      code: 'internal_error',
      message: 'Nečekaná chyba enginu, detail na stderr.',
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('RangeError');
  });
});

describe('extractId – best-effort id pro internal_error', () => {
  it('vrací string id z validního objektu', () => {
    expect(extractId('{"type":"bestmove","id":"x-1"}')).toBe('x-1');
  });

  it.each([
    ['nevalidní JSON', 'rozbité{'],
    ['ne-objekt', '"jen string"'],
    ['pole', '[1,2]'],
    ['chybějící id', '{"type":"hello"}'],
    ['nestringové id', '{"id":42}'],
  ])('vrací null pro %s', (_label, line) => {
    expect(extractId(line)).toBeNull();
  });
});

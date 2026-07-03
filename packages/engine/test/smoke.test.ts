import { expect, it } from 'vitest';

import { ENGINE_ID } from '../src/index.js';

it('exportuje identifikátor enginu', () => {
  expect(ENGINE_ID).toBe('checkers-ts-engine');
});

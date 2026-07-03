import { expect, it } from 'vitest';

import { BOARD_SQUARES } from '../src/index.js';

it('exportuje počet hracích polí desky', () => {
  expect(BOARD_SQUARES).toBe(32);
});

import { expect, it } from 'vitest';

import { DEFAULT_PORT } from '../src/index.js';

it('exportuje výchozí port serveru', () => {
  expect(DEFAULT_PORT).toBe(3000);
});

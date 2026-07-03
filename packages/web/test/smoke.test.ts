import { expect, it } from 'vitest';

import { APP_TITLE } from '../src/index.js';

it('exportuje titulek aplikace', () => {
  expect(APP_TITLE).toBe('Americká dáma');
});

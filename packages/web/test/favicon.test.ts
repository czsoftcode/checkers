import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Fáze 85: favicon.ico musí v produkci fungovat. Kořenová příčina byla, že soubor
 * ležel v KOŘENI balíčku (kam `vite build` nesahá – kopíruje jen `public/`), takže
 * v `dist/` chyběl a nginx `try_files` vracel místo ikony SPA fallback index.html.
 *
 * Tyto testy hlídají obě strany fixu proti regresi:
 *  - soubor je v `public/` (jinak ho build nezkopíruje),
 *  - index.html na něj explicitně odkazuje.
 * Nesuplují reálné produkční ověření (nginx), to je na člověku po deployi.
 */

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('favicon (fáze 85)', () => {
  it('favicon.ico leží v public/ (odkud ho Vite kopíruje do dist/ při buildu)', () => {
    // Zub: kdyby se soubor přesunul jinam než do public/, build by ho vynechal a
    // produkce by favicon zase neměla. To je přesně bug, který fáze opravuje.
    expect(existsSync(resolve(webRoot, 'public/favicon.ico'))).toBe(true);
  });

  it('index.html explicitně odkazuje /favicon.ico přes <link rel="icon">', () => {
    const html = readFileSync(resolve(webRoot, 'index.html'), 'utf8');
    expect(html).toMatch(/<link[^>]+rel=["']icon["'][^>]*>/i);
    expect(html).toMatch(/href=["']\/favicon\.ico["']/i);
  });
});

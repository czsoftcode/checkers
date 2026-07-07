/**
 * Integrační testy archivace partie na disk (fáze 23). Bez enginu (manuální
 * režim) se přes `app.inject` odehraje celá partie do REÁLNÉHO konce a ověří,
 * že vznikl validní `<id>.pdn`. Druhá půlka testuje selhací cestu: nezapisatelný
 * adresář partii nesmí shodit ani nechat po sobě `.tmp`.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move, Position } from '@checkers/rules';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import type { EngineMover, GameDto, OpeningBook } from '../src/index.js';

// Cvičí ENGINE/archivaci, ne knihu zahájení: partie stavíme s PRÁZDNOU knihou,
// aby knižní zkrat (od fáze 59 je i 9-13 v knize) nepředběhl engine a nezměnil
// trajektorii partie. Viz engine-move.test.ts.
const NO_BOOK: OpeningBook = new Map();
const build = (opts: Parameters<typeof buildApp>[0] = {}): FastifyInstance =>
  buildApp({ openingBook: NO_BOOK, ...opts });

/**
 * Engine stub: POSLEDNÍ legální tah. Proti člověku, který hraje první legální
 * tah, tahle deterministická partie končí VÍTĚZSTVÍM BÍLÉHO (enginu) po 38
 * půltazích – tj. terminální tah dělá engine. To je nutné, aby test opravdu
 * prošel archivační větví v `runEngineMove` (s „prvním legálním" by partie
 * skončila remízou po tahu ČERNÉHO a engine větev by se netrefila).
 */
const lastMoveStub: EngineMover = {
  bestmove: (position: Position): Promise<Move> => {
    const moves = legalMoves(position);
    const move = moves[moves.length - 1];
    return move === undefined
      ? Promise.reject(new Error('stub: pozice bez tahu'))
      : Promise.resolve(move);
  },
  evaluate: () => Promise.resolve({ score: 0 }), // nevyužito v archivačních testech
};

const RESULT_TOKEN: Record<string, string> = {
  'black-wins': '0-1',
  'white-wins': '1-0',
  draw: '1/2-1/2',
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'checkers-pdn-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Přečte soubor, který možná ještě nevznikl. U tahu ENGINU se zápis PDN děje
 * na pozadí (`runEngineMove` je fire-and-forget) a doběhne až chvíli po tom, co
 * polling uvidí konec partie – proto se na jeho vznik krátce počká.
 */
async function readFileEventually(file: string, timeoutMs = 2000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() > deadline) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

async function createGame(app: FastifyInstance): Promise<GameDto> {
  const res = await app.inject({ method: 'POST', url: '/games' });
  expect(res.statusCode).toBe(201);
  return res.json<GameDto>();
}

/**
 * Odehraje partii do terminálního stavu tak, že pořád posílá PRVNÍ legální tah
 * (bez enginu hraje klient obě strany). Deterministické a díky remízovým
 * pravidlům (80 půltahů bez pokroku / trojí opakování) zaručeně konečné.
 * Tvrdý strop je jen pojistka proti zacyklení testu.
 */
async function playToEnd(app: FastifyInstance, dto: GameDto): Promise<GameDto> {
  let current = dto;
  let guard = 0;
  while (current.result === 'ongoing') {
    if (++guard > 5000) {
      throw new Error('partie se nedohrála do stropu – něco je špatně');
    }
    const move = current.legalMoves[0];
    if (move === undefined) {
      throw new Error('ongoing partie bez legálního tahu');
    }
    const res = await app.inject({
      method: 'POST',
      url: `/games/${current.id}/moves`,
      payload: { from: move.from, path: move.path },
    });
    expect(res.statusCode).toBe(200);
    current = res.json<GameDto>();
  }
  return current;
}

describe('archivace dokončené partie na disk', () => {
  it('zapíše validní <id>.pdn a nenechá po sobě žádný .tmp', async () => {
    const app = build({ pdnDir: dir });
    try {
      const game = await createGame(app);
      const final = await playToEnd(app, game);
      expect(final.result).not.toBe('ongoing');

      const content = await readFile(join(dir, `${game.id}.pdn`), 'utf8');
      expect(content).toContain('[Event "Checkers"]');
      expect(content).toContain('[Black "Human"]');
      expect(content).toContain('[White "Engine"]');
      expect(content).toContain(`[Result "${RESULT_TOKEN[final.result]}"]`);
      expect(content).toMatch(/^1\. /m); // aspoň jedno číslo tahu v movetextu
      expect(content.trimEnd().endsWith(RESULT_TOKEN[final.result] ?? '')).toBe(true);

      const entries = await readdir(dir);
      expect(entries.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
      expect(entries).toContain(`${game.id}.pdn`);
    } finally {
      await app.close();
    }
  });

  it('archivuje PRÁVĚ JEDNOU – další polling/GET soubor nepřepíše', async () => {
    const app = build({ pdnDir: dir });
    try {
      const game = await createGame(app);
      const final = await playToEnd(app, game);
      const file = join(dir, `${game.id}.pdn`);
      const first = await readFile(file, 'utf8');

      // Opakovaný GET (to dělá klientský polling) nesmí nic zapisovat.
      await app.inject({ method: 'GET', url: `/games/${game.id}` });
      expect(await readFile(file, 'utf8')).toBe(first);

      // Tah do skončené partie → 409 game_over, soubor beze změny.
      const move = final.legalMoves[0] ?? { from: 1, path: [1] };
      const res = await app.inject({
        method: 'POST',
        url: `/games/${game.id}/moves`,
        payload: { from: move.from, path: move.path },
      });
      expect(res.statusCode).toBe(409);
      expect(await readFile(file, 'utf8')).toBe(first);
    } finally {
      await app.close();
    }
  });

  it('bez pdnDir se nic nezapisuje (archivace vypnutá)', async () => {
    const app = build(); // žádný pdnDir
    try {
      const game = await createGame(app);
      const final = await playToEnd(app, game);
      expect(final.result).not.toBe('ongoing');
      expect(await readdir(dir)).toHaveLength(0); // temp adresář zůstal prázdný
    } finally {
      await app.close();
    }
  });
});

/** Poll GET, dokud predikát nesedí (nebo timeout). Modeluje klientský polling. */
async function pollUntil(
  app: FastifyInstance,
  id: string,
  predicate: (dto: GameDto) => boolean,
  timeoutMs = 3000,
): Promise<GameDto> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/games/${id}` });
    const dto = res.json<GameDto>();
    if (predicate(dto)) {
      return dto;
    }
    if (Date.now() > deadline) {
      throw new Error(`polling timeout, poslední stav: ${JSON.stringify(dto)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Dožene partii se zapojeným enginem do konce: člověk (černý) hraje první
 * legální tah přes POST, engine (bílý) odpoví na pozadí, poll čeká na jeho tah.
 * Pokrývá archivační větev v `runEngineMove` – tu manuální testy výš netrefí.
 */
async function playEngineGameToEnd(app: FastifyInstance, game: GameDto): Promise<GameDto> {
  let dto = game;
  let guard = 0;
  while (dto.result === 'ongoing') {
    if (++guard > 5000) {
      throw new Error('partie se nedohrála do stropu');
    }
    const move = dto.legalMoves[0];
    if (move === undefined) {
      throw new Error('ongoing partie bez legálního tahu');
    }
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: move.from, path: move.path },
    });
    expect(res.statusCode).toBe(200);
    dto = res.json<GameDto>();
    if (dto.result !== 'ongoing') {
      break; // partii ukončil tah člověka
    }
    // Engine odpoví na pozadí – počkej, než dotáhne (nebo partii ukončí).
    dto = await pollUntil(
      app,
      game.id,
      (d) => d.result !== 'ongoing' || (d.engineStatus === 'idle' && d.position.turn === 'black'),
    );
    if (dto.engineStatus === 'error') {
      throw new Error('engine skončil v erroru – archivační test nemá co ověřit');
    }
  }
  return dto;
}

describe('archivace v partii s enginem (větev runEngineMove)', () => {
  it('partie dohraná enginem na pozadí se zarchivuje se správným tokenem', async () => {
    const app = build({ engine: lastMoveStub, pdnDir: dir });
    try {
      const game = await createGame(app);
      const final = await playEngineGameToEnd(app, game);
      // Terminální tah dělá engine (bílý) → ověřuje větev v runEngineMove.
      expect(final.result).toBe('white-wins');

      const content = await readFileEventually(join(dir, `${game.id}.pdn`));
      expect(content).toContain('[Event "Checkers"]');
      expect(content).toContain(`[Result "${RESULT_TOKEN[final.result]}"]`);
      expect(content.trimEnd().endsWith(RESULT_TOKEN[final.result] ?? '')).toBe(true);

      const entries = await readdir(dir);
      expect(entries.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe('archivace – selhání zápisu partii neshodí', () => {
  it('nezapisatelný adresář: partie se dohraje, jen se zaloguje, žádný .tmp', async () => {
    // Nadřazená cesta je SOUBOR → mkdir(recursive) uvnitř skončí ENOTDIR.
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'x', 'utf8');
    const badDir = join(blocker, 'sub');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = build({ pdnDir: badDir });
    try {
      const game = await createGame(app);
      const final = await playToEnd(app, game); // NEsmí spadnout
      expect(final.result).not.toBe('ongoing');

      // Zápis selhal → adresář nevznikl, žádný soubor ani .tmp.
      const entries = await readdir(dir);
      expect(entries).toEqual(['blocker']);

      // Selhání se zalogovalo přes console.error (archivační hláška).
      expect(
        errorSpy.mock.calls.some(
          (call) => typeof call[0] === 'string' && call[0].includes('archivovat PDN'),
        ),
      ).toBe(true);
    } finally {
      await app.close();
      errorSpy.mockRestore();
    }
  });
});

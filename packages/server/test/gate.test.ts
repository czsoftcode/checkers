/**
 * BRÁNA M4: kill enginu uprostřed přemýšlení → partie přežije, zotaví se a
 * pokračuje přes HTTP.
 *
 * Scénář přes celý stack (HTTP → EngineClient → reálný podproces enginu):
 * 1. člověk zahraje 9→13 (POST /moves) → engine (bílý) začne přemýšlet,
 * 2. falešný engine se na první (plný) pokus ZASEKNE (mode slow-then-ok),
 * 3. test ho ZABIJE zvenčí (SIGKILL na jeho PID) – „kill uprostřed přemýšlení",
 * 4. orchestrace pád detekuje, restartuje engine a zopakuje na timeMs/2,
 * 5. retry (kratší čas < práh) fake zodpoví tahem 23→18,
 * 6. server tah OVĚŘÍ přes rules a zahraje → GET ukáže černého na tahu, idle.
 *
 * Zuby: kdyby se retry/restart vypnul, po killu by engine nikdy netáhl,
 * engineStatus by uvázl na `error` a čekání na `idle` + černého by spadlo.
 */

import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';
import { buildApp, EngineClient } from '../src/index.js';
import type { GameDto, SpawnCommand, OpeningBook } from '../src/index.js';

// Cvičí orchestraci ENGINU (kill + zotavení), ne knihu zahájení: test hraje
// 9-13 a ověřuje, že engine reálně táhne 23-18. Od fáze 59 je 9-13 v knize, což
// by na úrovni Profesionál engine zkratovalo (a rozbilo board asserty). Proto
// PRÁZDNÁ kniha – chování je identické jako před naplněním knihy.
const NO_BOOK: OpeningBook = new Map();
const build = (opts: Parameters<typeof buildApp>[0] = {}): FastifyInstance =>
  buildApp({ openingBook: NO_BOOK, ...opts });

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url));

/** Čas na tah a práh fake enginu: první pokus (plný čas ≥ práh) se zasekne,
 *  retry (timeMs/2 < práh) projde. timeMs velký, ať stihneme zabít my dřív
 *  než tvrdý strop (timeMs + 500). */
const TIME_MS = 1000;
const THRESHOLD = 700;

function fakeCmd(): SpawnCommand {
  return {
    command: process.execPath,
    args: [FIXTURE, '--mode', 'slow-then-ok', '--threshold', String(THRESHOLD)],
  };
}

let app: FastifyInstance;
let engine: EngineClient;
afterEach(async () => {
  await app.close();
  await engine.close();
});

async function pollUntil(
  id: string,
  predicate: (dto: GameDto) => boolean,
  timeoutMs = 5000,
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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it('kill enginu uprostřed přemýšlení – partie přežije a pokračuje', async () => {
  engine = new EngineClient({ spawn: fakeCmd(), timeMs: TIME_MS, pidFile: null });
  app = build({ engine });
  await engine.warmup();

  // Člověk zahraje 9→13.
  const game = (await app.inject({ method: 'POST', url: '/games' })).json<GameDto>();
  const moved = (
    await app.inject({
      method: 'POST',
      url: `/games/${game.id}/moves`,
      payload: { from: 9, path: [13] },
    })
  ).json<GameDto>();
  expect(moved.position.turn).toBe('white');
  expect(moved.engineStatus).toBe('thinking');

  // Počkej, až engine reálně přemýšlí, a zabij jeho proces zvenčí.
  await pollUntil(game.id, (dto) => dto.engineStatus === 'thinking');
  const pid = engine.currentPid();
  expect(pid).not.toBeNull();
  process.kill(pid!, 'SIGKILL'); // ← kill uprostřed přemýšlení

  // Orchestrace se zotaví (restart + retry) a tah enginu dorazí přes HTTP.
  const recovered = await pollUntil(
    game.id,
    (dto) => dto.engineStatus === 'idle' && dto.position.turn === 'black',
  );
  expect(recovered.result).toBe('ongoing');
  // Engine opravdu táhl 23→18: pole 18 (index 17) je teď bílý, 23 (index 22) prázdné.
  expect(recovered.position.board[17]).toEqual({ color: 'white', kind: 'man' });
  expect(recovered.position.board[22]).toBeNull();

  // Server žije: člověk může táhnout dál.
  const next = recovered.legalMoves[0];
  if (next === undefined) {
    throw new Error('po tahu enginu musí mít černý legální tah');
  }
  const afterNext = await app.inject({
    method: 'POST',
    url: `/games/${game.id}/moves`,
    payload: { from: next.from, path: next.path },
  });
  expect(afterNext.statusCode).toBe(200);
}, 30_000);

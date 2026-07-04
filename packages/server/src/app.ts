/**
 * Autoritativní HTTP server partie (Fastify + zod). Server je JEDINÝ zdroj
 * pravdy: každý tah se ověřuje přes sdílenou `rules` (přes `findLegalMove`),
 * žádná pravidla se tu neduplikují.
 *
 * `buildApp()` vrací nakonfigurovanou instanci bez `listen` (testuje se přes
 * `app.inject()`); reálné naslouchání řeší `main.ts`.
 */

import Fastify from 'fastify';
import { z } from 'zod';
import { gameResultFromState } from '@checkers/rules';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findLegalMove, gameToDto, legalMoveDtos } from './dto.js';
import { ERROR_CODES, sendError } from './errors.js';
import { GameStore } from './store.js';

/** Tělo POST /games/:id/moves: výchozí pole + cesta dopadů (čísla 1–32). */
const moveBodySchema = z.object({
  from: z.number().int().min(1).max(32),
  path: z.array(z.number().int().min(1).max(32)).min(1),
});

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new GameStore();

  // Jednotná obálka i pro chyby z frameworku: rozbité JSON tělo přijde jako 4xx
  // s `statusCode`, přemapuje se na invalid_request. Neočekávaná chyba (např.
  // RangeError z rules na poškozeném stavu) NENÍ klientská → 500 + log,
  // nikdy se nemaskuje jako 4xx.
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      // Klientská chyba z frameworku (rozbité JSON tělo, špatný Content-Type…).
      // Fixní zpráva – err.message frameworku umí prozradit interní detaily.
      return sendError(reply, status, ERROR_CODES.invalidRequest, 'Neplatný požadavek');
    }
    // Logger je vypnutý (logger: false), takže req.log.error je no-op. Bez
    // tohohle by neočekávaná chyba (např. RangeError z rules) zmizela bez
    // stacku. console.error ji zachová nezávisle na konfiguraci loggeru.
    req.log.error(err);
    console.error('Neočekávaná chyba serveru:', err);
    return sendError(reply, 500, ERROR_CODES.internal, 'Interní chyba serveru');
  });

  // Neznámá routa/metoda: Fastify by jinak vrátil vlastní tvar (error jako
  // string, bez `code`) → drift kontraktu { error: { code, message } }, na který
  // se navěsí web klient. Sjednotíme obálku i tady.
  app.setNotFoundHandler((req, reply) => {
    return sendError(
      reply,
      404,
      ERROR_CODES.notFound,
      `Neznámá cesta ${req.method} ${req.url}`,
    );
  });

  app.post('/games', (_req, reply) => {
    const { id, state } = store.create();
    return reply.code(201).send(gameToDto(id, state));
  });

  app.get<{ Params: { id: string } }>('/games/:id', (req, reply) => {
    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    return reply.send(gameToDto(record.id, record.state));
  });

  app.post<{ Params: { id: string } }>('/games/:id/moves', (req, reply) => {
    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }

    const parsed = moveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        ERROR_CODES.invalidRequest,
        'Neplatné tělo tahu: očekávám { from: 1–32, path: [1–32, …] }',
      );
    }

    // Tah do už skončené partie → 409 game_over. Kontroluje se PŘED hledáním
    // legálního tahu: remíza opakováním / 80 půltahů může mít legální tahy, ale
    // partie je u konce.
    if (gameResultFromState(record.state) !== 'ongoing') {
      return sendError(reply, 409, ERROR_CODES.gameOver, 'Partie je u konce');
    }

    const move = findLegalMove(record.state.position, parsed.data.from, parsed.data.path);
    if (move === undefined) {
      return sendError(reply, 409, ERROR_CODES.illegalMove, 'Nelegální tah', {
        legalMoves: legalMoveDtos(record.state.position),
      });
    }

    const next = store.applyMove(record.id, move);
    if (next === undefined) {
      // Partie zmizela mezi get a applyMove – v jednom procesu se nestane.
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    return reply.send(gameToDto(next.id, next.state));
  });

  return app;
}

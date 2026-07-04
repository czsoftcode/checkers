/**
 * Jednotná chybová obálka. Kód chyby je strojově čitelný (kontrakt pro klienta),
 * lidská zpráva je jen doplněk. Tvar: `{ error: { code, message }, legalMoves? }`.
 */

import type { FastifyReply } from 'fastify';
import type { MoveDto } from './dto.js';

/** Strojově čitelné kódy chyb. Součást kontraktu se serverem/klientem. */
export const ERROR_CODES = {
  invalidRequest: 'invalid_request',
  notFound: 'not_found',
  gameNotFound: 'game_not_found',
  illegalMove: 'illegal_move',
  gameOver: 'game_over',
  notYourTurn: 'not_your_turn',
  internal: 'internal_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorEnvelope {
  readonly error: { readonly code: ErrorCode; readonly message: string };
  /** Přítomné jen u `illegal_move` – aktuální legální tahy pro zotavení klienta. */
  readonly legalMoves?: MoveDto[];
}

/**
 * Pošle chybovou odpověď v jednotné obálce. `legalMoves` se přiloží jen když je
 * předáno (kvůli exactOptionalPropertyTypes se pole nikdy nenastavuje na undefined).
 */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string,
  extra?: { legalMoves: MoveDto[] },
): FastifyReply {
  const body: ErrorEnvelope =
    extra === undefined
      ? { error: { code, message } }
      : { error: { code, message }, legalMoves: extra.legalMoves };
  return reply.code(status).send(body);
}

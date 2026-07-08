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
  /** Nabídka remízy v manuálním režimu (server běží bez enginu → není decidér). */
  drawOfferUnavailable: 'draw_offer_unavailable',
  /** Nápověda tahu v manuálním režimu (server běží bez enginu → není radící). */
  hintUnavailable: 'hint_unavailable',
  /** Nabídka remízy, když engine zrovna přemýšlí (na tahu je engine). */
  engineBusy: 'engine_busy',
  /** Engine selhal při vyhodnocení nabídky (timeout/pád/protokol) – přechodné. */
  engineUnavailable: 'engine_unavailable',
  /**
   * Engine-orientovaný REST endpoint (čtení dto, tah, vzdání, remíza, nápověda)
   * zavolaný na PvP partii (fáze 68). PvP partie se v tomto řezu ještě nehraje ani
   * nečte přes REST (routování/autorita tahů = todo 36, konec = todo 40) – partie
   * existuje, ale tato cesta pro ni není. Ne 404 (partie JE), ne 500 (není to chyba
   * serveru), ne tichý default: distinktní 409, ať klient/test pozná důvod.
   */
  pvpNotPlayable: 'pvp_not_playable',
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

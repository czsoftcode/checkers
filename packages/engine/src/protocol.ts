/**
 * JSON Lines protokol enginu.
 *
 * Server píše na stdin enginu jeden JSON objekt na řádek a engine na každý
 * požadavek odpoví právě jedním JSON objektem na řádku stdout. Každý
 * požadavek nese `id`; odpověď ho vrací beze změny, aby si volající uměl
 * spárovat odpovědi s požadavky. Chybová odpověď má `id: null`, když se id
 * z nevalidního vstupu nedá bezpečně zjistit.
 *
 * Tvary `Position` a `Move` se přenášejí přímo jako JSON podoba typů
 * z `@checkers/rules` – server (M4) má importovat TYHLE typy, ne opisovat
 * literály (jeden zdroj kontraktu mezi procesy).
 */

import type { Move, Position } from '@checkers/rules';

/**
 * Verze protokolu; engine ji hlásí v odpovědi `hello`.
 * v2: bestmove nese povinné `timeMs` (měkký časový limit searche).
 */
export const PROTOCOL_VERSION = 2;

/** Identifikátor enginu pro protokolovou zprávu hello. */
export const ENGINE_ID = 'checkers-ts-engine';

/** Id požadavku – volí volající, engine ho jen vrací. */
export type MessageId = string;

/** Požadavek na handshake: ověření, že na druhé straně žije engine. */
export interface HelloRequest {
  readonly type: 'hello';
  readonly id: MessageId;
}

/**
 * Požadavek na tah v zadané pozici.
 *
 * `timeMs` je MĚKKÝ limit v milisekundách (kladné celé číslo): engine
 * prohledává iterativním prohlubováním a vrací poslední kompletní iteraci;
 * odpověď přijde nejpozději za timeMs + malou režii (jedno okno kontroly
 * hodin + serializace; navíc hloubka 1 s quiescence běží vždy celá – viz
 * search.ts, prakticky jednotky ms). Tvrdý strop (kill procesu) je věc
 * volajícího – orchestrace M4 počítá s timeMs + 500 ms.
 *
 * Limity protokolu v2 (vědomé, ne opomenutí):
 * - timeMs nemá horní mez: engine je jednovláknový a během searche nečte
 *   stdin, absurdně velký limit ho tedy na dlouho zabaví. Volající je
 *   důvěryhodný server, který timeouty vlastní; strop případně přidá M4
 *   podle skutečných požadavků orchestrace,
 * - nenese remízový stav partie (čítač půltahů bez pokroku, historii
 *   opakování) – engine hodnotí jen samotnou pozici a o blížící se remíze
 *   neví; remízy autoritativně hlídá server přes GameState.
 */
export interface BestmoveRequest {
  readonly type: 'bestmove';
  readonly id: MessageId;
  readonly position: Position;
  readonly timeMs: number;
}

/** Všechny požadavky, kterým engine rozumí. */
export type EngineRequest = HelloRequest | BestmoveRequest;

/** Odpověď na hello: verze protokolu + identifikátor enginu. */
export interface HelloResponse {
  readonly type: 'hello';
  readonly id: MessageId;
  readonly protocol: number;
  readonly engine: string;
}

/** Odpověď na bestmove: vybraný tah. */
export interface BestmoveResponse {
  readonly type: 'bestmove';
  readonly id: MessageId;
  readonly move: Move;
}

/**
 * Chybové kódy protokolu:
 * - `invalid_json` – řádek není platný JSON,
 * - `invalid_message` – JSON není objekt se string `type` a string `id`,
 * - `unknown_type` – typ zprávy engine nezná,
 * - `invalid_position` – pole `position` nemá tvar pozice z rules,
 * - `no_legal_moves` – v pozici není žádný legální tah (partie skončila),
 * - `internal_error` – nečekaná chyba enginu (stack jde na stderr).
 */
export const ERROR_CODES = [
  'invalid_json',
  'invalid_message',
  'unknown_type',
  'invalid_position',
  'no_legal_moves',
  'internal_error',
] as const;

/** Chybový kód protokolu. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Chybová odpověď; `id` je null, když se z vstupu nedá zjistit. */
export interface ErrorResponse {
  readonly type: 'error';
  readonly id: MessageId | null;
  readonly code: ErrorCode;
  readonly message: string;
}

/** Všechny odpovědi, které engine posílá. */
export type EngineResponse = HelloResponse | BestmoveResponse | ErrorResponse;

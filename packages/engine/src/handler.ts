/**
 * Zpracování jedné protokolové zprávy – čistá funkce bez I/O.
 *
 * Vstupem je syrový řádek, výstupem vždy právě jedna odpověď. Všechny
 * očekávatelné vady vstupu (nevalidní JSON, špatný tvar, neznámý typ,
 * vadná pozice, pozice bez tahů) končí odpovědí `error`, nikdy výjimkou –
 * engine je dlouhoběžící proces a nesmí ho shodit vstup. Nečekané chyby
 * (programátorská chyba) ven propadnout SMÍ; poslední záchranu dělá až
 * respondToLine (respond.ts), aby se nezamaskoval stack.
 */

import { BOARD_SQUARES, legalMoves } from '@checkers/rules';
import type { Cell, Position } from '@checkers/rules';

import { ENGINE_ID, PROTOCOL_VERSION } from './protocol.js';
import type { EngineResponse, ErrorCode, ErrorResponse, MessageId } from './protocol.js';

/**
 * Zpracuje jeden řádek protokolu a vrátí odpověď.
 *
 * `rng` dodává náhodu pro výběr tahu (rozsah [0,1) jako Math.random);
 * předává se zvenku, aby byl výběr v testech seedovatelný.
 */
export function handleLine(rawLine: string, rng: () => number): EngineResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return errorResponse(null, 'invalid_json', 'Řádek není platný JSON.');
  }

  if (!isRecord(parsed)) {
    return errorResponse(null, 'invalid_message', 'Zpráva musí být JSON objekt.');
  }
  if (typeof parsed.id !== 'string') {
    return errorResponse(null, 'invalid_message', 'Zpráva musí mít textové pole "id".');
  }
  const id = parsed.id;
  if (typeof parsed.type !== 'string') {
    return errorResponse(id, 'invalid_message', 'Zpráva musí mít textové pole "type".');
  }

  switch (parsed.type) {
    case 'hello':
      return { type: 'hello', id, protocol: PROTOCOL_VERSION, engine: ENGINE_ID };
    case 'bestmove':
      return handleBestmove(id, parsed.position, rng);
    default:
      return errorResponse(id, 'unknown_type', `Neznámý typ zprávy "${parsed.type}".`);
  }
}

function handleBestmove(id: MessageId, rawPosition: unknown, rng: () => number): EngineResponse {
  const position = parsePosition(rawPosition);
  if (position === null) {
    return errorResponse(
      id,
      'invalid_position',
      'Pole "position" nemá tvar pozice (board s 32 poli, turn black/white).',
    );
  }

  const moves = legalMoves(position);
  if (moves.length === 0) {
    return errorResponse(id, 'no_legal_moves', 'V pozici není žádný legální tah – partie skončila.');
  }

  const index = Math.floor(rng() * moves.length);
  const move = moves[index];
  if (move === undefined) {
    // rng mimo kontrakt [0, 1) – programátorská chyba, zachytí ji respondToLine
    throw new RangeError(`Engine: rng vrátil hodnotu mimo [0, 1), index ${String(index)}`);
  }
  return { type: 'bestmove', id, move };
}

/**
 * Ověří tvar pozice z JSON a vrátí čerstvou `Position`, nebo `null`.
 * Kopíruje jen známá pole – případné smetí navíc ve vstupu se zahodí.
 */
function parsePosition(value: unknown): Position | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.turn !== 'black' && value.turn !== 'white') {
    return null;
  }
  if (!Array.isArray(value.board) || value.board.length !== BOARD_SQUARES) {
    return null;
  }

  const board: Cell[] = [];
  for (const rawCell of value.board as unknown[]) {
    const cell = parseCell(rawCell);
    if (cell === undefined) {
      return null;
    }
    board.push(cell);
  }
  return { board, turn: value.turn };
}

/** Vrátí obsah pole (kámen/null), nebo `undefined` pro nevalidní vstup. */
function parseCell(value: unknown): Cell | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.color !== 'black' && value.color !== 'white') {
    return undefined;
  }
  if (value.kind !== 'man' && value.kind !== 'king') {
    return undefined;
  }
  return { color: value.color, kind: value.kind };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorResponse(id: MessageId | null, code: ErrorCode, message: string): ErrorResponse {
  return { type: 'error', id, code, message };
}

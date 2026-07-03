/**
 * Odpověď na jeden řádek protokolu s poslední záchranou proti bugu enginu.
 *
 * Odděleno od main.ts, aby šla větev `internal_error` otestovat bez
 * podprocesu (injektovaným rozbitým rng). Nečekaná výjimka z handleru se
 * celá (i se stackem) předá `logError` a volajícímu se vrátí `error`
 * s best-effort obnoveným `id` – server si tak spáruje i odpověď na
 * požadavek, u kterého engine vybuchl, místo čekání na timeout.
 */

import { handleLine } from './handler.js';
import type { EngineResponse } from './protocol.js';

/** Zpracuje řádek; výjimku handleru převede na `internal_error`. */
export function respondToLine(
  line: string,
  rng: () => number,
  logError: (text: string) => void,
): EngineResponse {
  try {
    return handleLine(line, rng);
  } catch (error) {
    const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
    logError(stack);
    return {
      type: 'error',
      id: extractId(line),
      code: 'internal_error',
      message: 'Nečekaná chyba enginu, detail na stderr.',
    };
  }
}

/**
 * Best-effort `id` z řádku pro párování `internal_error` odpovědi.
 *
 * Dnes handler hází až po validaci id (rozbitý rng u bestmove), takže id
 * tu typicky JE; null větve jsou pojistka pro budoucí kód handleru, který
 * může vybouchnout dřív. Exportováno kvůli přímému testu obou větví.
 */
export function extractId(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const id = (parsed as Record<string, unknown>).id;
  return typeof id === 'string' ? id : null;
}

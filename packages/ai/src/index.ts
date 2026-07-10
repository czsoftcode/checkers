/**
 * @checkers/ai – jediný zdroj logiky výběru tahu AI (fáze 86).
 *
 * Sdružuje knihu zahájení, mapování úroveň → síla a orchestrátor výběru tahu
 * (book → search → chooseMove) do jednoho balíčku, ze kterého staví tah AI jak
 * dnešní server, tak budoucí prohlížečový offline klient – aby se online a
 * offline síla nerozešly. Závisí JEN na `@checkers/rules` a `@checkers/engine`
 * (čisté exporty, žádné `node:`); nesmí vzniknout zpětná závislost na serveru.
 */

export type { OpeningBook } from './opening-book.js';
export { OPENING_BOOK, buildBook, lookupBookMove } from './opening-book.js';
export type { GameLevel } from './levels.js';
export {
  LEVELS,
  DEFAULT_LEVEL,
  STRENGTH_BY_LEVEL,
  LEVELS_WITH_BOOK,
  levelUsesBook,
} from './levels.js';
export { computeAiMove } from './choose.js';
export type { ComputeAiMoveOptions } from './choose.js';

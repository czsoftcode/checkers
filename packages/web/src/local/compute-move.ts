/**
 * Jádro výběru tahu AI v prohlížeči (fáze 87) – čistá funkce bez I/O a bez
 * Web Workeru. Volá `@checkers/ai` `computeAiMove` (jediný sdílený zdroj logiky
 * výběru tahu, fáze 86) s OFFLINE politikou síly a knihou zahájení. Sem se
 * zapouzdřuje jediný offline rozdíl proti serveru: strop hloubky `maxDepth 12`.
 *
 * Proč čistá funkce: Vitest + jsdom NEMÁ Web Worker. Těžký výpočet (~1 s search)
 * musí jít v provozu mimo hlavní vlákno (worker), ale samotné jádro je čistá
 * funkce, kterou worker jen tenkým transportem obalí (viz `engine-worker.ts`) a
 * testy volají přímo (in-process). `EngineMoveRequest` je proto SERIALIZOVATELNÝ
 * (žádná funkce), ať projde `postMessage` reálného workeru; injektovatelné hodiny
 * pro deterministický test se předávají zvlášť (parametr `now`), ne v requestu.
 */

import type { Move, Position, VariantId } from '@checkers/rules';
import type { Strength } from '@checkers/engine';
import {
  OPENING_BOOK,
  STRENGTH_BY_LEVEL,
  computeAiMove,
  levelUsesBook,
} from '@checkers/ai';
import type { GameLevel } from '@checkers/ai';

import { mulberry32 } from './prng.js';

/**
 * Offline strop hloubky (vize projektu): Profesionál/Mistrovství/Výuka + nápověda
 * počítají nejvýš do hloubky 12 – definice síly NEZÁVISLÁ na rychlosti zařízení
 * (medián hloubky 12 v 1 s na dev Ryzen7). Začátečník (d1) a Střední (d3) mají
 * vlastní strop nižší než 12, takže je tenhle strop jen ZPŘÍSNIT nemůže (bez
 * efektu). Server strop NEMÁ (zůstává časový) – proto ho drží tenhle offline
 * modul, ne sdílený `@checkers/ai`.
 */
export const MAX_OFFLINE_DEPTH = 12;

/**
 * Výchozí měkký časový limit searche v ms. Shodné s DEFAULT_ENGINE_TIME_MS
 * serveru (1 s) – aby online a offline dostaly stejný časový rozpočet a lišily
 * se jen stropem hloubky. Injektovatelné přes `EngineMoveRequest.timeMs`.
 */
export const DEFAULT_SEARCH_TIME_MS = 1000;

/**
 * Požadavek na výpočet tahu enginu ve tvaru, který PROJDE `postMessage` reálného
 * Web Workeru (jen JSON-serializovatelná data, žádné funkce). Seed určuje rng pro
 * tie-break a nepozornost (`computeAiMove`) – produkce ho losuje náhodně, test
 * dosadí pevný, aby byl výběr reprodukovatelný.
 */
export interface EngineMoveRequest {
  readonly position: Position;
  readonly level: GameLevel;
  readonly seed: number;
  readonly timeMs: number;
  /**
   * Přepíše rozhodnutí „konzultovat knihu zahájení" (jinak z `levelUsesBook(level)`).
   * Slouží NÁPOVĚDĚ: server ji počítá `bestmove(position, undefined)` BEZ knihy
   * (knihu aplikuje jen u tahu enginu, ne u hintu), takže nápověda musí knihu
   * vypnout (`useBook: false`), aby v zahájení radila TÝŽ tah jako server, ne
   * knižní. Serializovatelný boolean → projde `postMessage` reálného workeru.
   */
  readonly useBook?: boolean;
  /**
   * Varianta pravidel (id). Chybí → 'american' (zpětná kompatibilita: dnešní
   * requesty bez pole hrají americky – přesně jako server i dosavadní offline
   * klient). Teče do `computeAiMove`, kde určuje ruleset předaný searchi i váhy
   * evaluace (létavá dáma je řádově cennější). Serializovatelný řetězec → projde
   * `postMessage` reálného workeru.
   */
  readonly variant?: VariantId;
}

/**
 * Offline politika síly pro danou úroveň: serverová síla (`STRENGTH_BY_LEVEL`)
 * ZPŘÍSNĚNÁ stropem `MAX_OFFLINE_DEPTH`. Silné úrovně (Profesionál/Mistrovství/
 * Výuka), které serverově nemají žádné páky (`undefined`), dostanou offline
 * `maxDepth 12`; Začátečník (d1) a Střední (d3) mají vlastní nižší strop, který
 * `Math.min` nechá být (12 na ně nemá vliv). `carelessness` se přebírá beze změny.
 *
 * Čistá funkce, jediný zdroj offline mapování úroveň → síla – strop 12 žije JEN
 * tady (server ho nemá). `computeAiMove` dostane sílu už se stropem zapečeným do
 * `maxDepth`, takže žádný další parametr stropu neřeší.
 */
export function strengthFor(level: GameLevel): Strength {
  const base = STRENGTH_BY_LEVEL[level];
  const cappedDepth = Math.min(base?.maxDepth ?? MAX_OFFLINE_DEPTH, MAX_OFFLINE_DEPTH);
  return base?.carelessness !== undefined
    ? { maxDepth: cappedDepth, carelessness: base.carelessness }
    : { maxDepth: cappedDepth };
}

/**
 * Spočítá tah AI pro pozici v requestu. Sestaví offline sílu (`strengthFor`),
 * dodá knihu zahájení JEN úrovni, která ji užívá (`levelUsesBook`, stejné
 * rozhodnutí jako server), seeduje rng z `req.seed` a předá vše `computeAiMove`.
 *
 * `now` (volitelné) jsou injektovatelné hodiny pro `searchTimed` – slouží JEN
 * deterministickému testu (produkce nechá výchozí `performance.now`). Nejsou v
 * `EngineMoveRequest`, protože funkce neprojde `postMessage` reálného workeru.
 *
 * Pozice MUSÍ mít aspoň jeden legální tah (jinak `searchTimed` vyhodí RangeError);
 * volající (`LocalClient`) to hlídá dřív přes efektivní výsledek partie, stejně
 * jako server přes autoritu tahu enginu.
 */
export function computeEngineMove(req: EngineMoveRequest, now?: () => number): Move {
  const rng = mulberry32(req.seed);
  const useBook = req.useBook ?? levelUsesBook(req.level);
  const book = useBook ? OPENING_BOOK : undefined;
  return computeAiMove(
    req.position,
    {
      strength: strengthFor(req.level),
      timeMs: req.timeMs,
      // Variantu předáváme JEN když je zadaná – `computeAiMove` si chybějící
      // dosadí na 'american' (zpětná kompatibilita). Ruleset varianty pak řídí
      // generování tahů v searchi i cenu dámy v evaluaci.
      ...(req.variant !== undefined ? { variant: req.variant } : {}),
      ...(book !== undefined ? { book } : {}),
      ...(now !== undefined ? { now } : {}),
    },
    rng,
  );
}

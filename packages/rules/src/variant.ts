/**
 * Registr variant: id varianty → Ruleset.
 *
 * `VariantId` je STRINGOVÝ identifikátor varianty (patří do GameState a po drátě
 * do protokolu enginu), `rulesetForVariant` ho mapuje na konkrétní `Ruleset`.
 * Objekt Ruleset se záměrně NEpřenáší v GameState ani po drátě (leakuje tvar
 * configu, riziko rozjezdu) – jediný zdroj pravdy o tom, co které id znamená,
 * je tenhle registr.
 *
 * Neznámé id → RangeError, NE tiché defaultnutí na americkou: překlep
 * ('russian' → český ruleset) by tiše rozehrál JINOU hru, což je přesně ta
 * korupce, kterou registr nesmí dopustit. Kdo dostává id zvenčí (untrusted wire),
 * si ho ověří přes `isVariantId` DŘÍV, než sáhne na `rulesetForVariant`.
 */

import {
  AMERICAN_RULESET,
  CZECH_RULESET,
  POOL_RULESET,
  RUSSIAN_RULESET,
} from './ruleset.js';
import type { Ruleset } from './ruleset.js';

/** Identifikátor varianty (drát/kód). Výchozí všude, kde se nenastaví, je 'american'. */
export type VariantId = 'american' | 'pool' | 'russian' | 'czech';

/**
 * Všechna známá id v jednom seznamu – zdroj pravdy pro `isVariantId` (runtime
 * validace vstupu zvenčí) i pro testy, které chtějí projít každou variantu.
 * Pořadí je jen kosmetické (nikde se na něj nespoléhá).
 */
export const VARIANT_IDS: readonly VariantId[] = ['american', 'pool', 'russian', 'czech'];

/**
 * Mapa id → Ruleset. Úplná (každé `VariantId` má záznam) – TS to hlídá typem
 * `Record<VariantId, Ruleset>`, takže přidání varianty do `VariantId` bez
 * záznamu tady je chyba překladu, ne tichá díra za běhu.
 */
const REGISTRY: Record<VariantId, Ruleset> = {
  american: AMERICAN_RULESET,
  pool: POOL_RULESET,
  russian: RUSSIAN_RULESET,
  czech: CZECH_RULESET,
};

/** True, právě když `value` je známé `VariantId` (runtime brána pro vstup zvenčí). */
export function isVariantId(value: unknown): value is VariantId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, value);
}

/**
 * Ruleset pro dané id varianty. Neznámé id (překlep, cizí string prošlý castem)
 * → RangeError; NEdefaultuje na americkou, aby se poškozená partie nerozehrála
 * tiše pod jinými pravidly. TS caller s korektním `VariantId` chybu nikdy
 * nedostane (registr je úplný); brána je pro hodnoty přišlé zvenčí.
 */
export function rulesetForVariant(id: VariantId): Ruleset {
  // hasOwnProperty místo `REGISTRY[id] === undefined`: kdyby někdo předal
  // 'constructor'/'toString', indexace by vrátila zděděnou funkci z prototypu
  // (truthy) a tiše by prošla jako „ruleset".
  if (!Object.prototype.hasOwnProperty.call(REGISTRY, id)) {
    throw new RangeError(`Neznámá varianta: ${String(id)}`);
  }
  return REGISTRY[id];
}

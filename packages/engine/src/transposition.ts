/**
 * Transpoziční tabulka (TT): cache výsledků prohledaných pozic. Když se
 * search přes transpozici (jiné pořadí tahů → tatáž pozice) dostane k pozici,
 * kterou už prohledal, vytáhne uložený výsledek místo znovuprohledávání.
 *
 * Struktura (viz .mini/discuss/phase-017.md):
 * - Pole PEVNÉ velikosti (mocnina dvojky), index = `klíč % velikost`. Bitovou
 *   masku nelze – 53-bit klíč přesahuje 32 bitů, na kterých `&` pracuje.
 *   Pevná velikost drží paměť předvídatelnou; engine má tvrdý timeout a `Map`
 *   rostoucí s počtem unikátních pozic by na dlouhém přemýšlení mohl narůst.
 * - Náhrada „preferuj hlubší": mělčí záznam nikdy nepřepíše hlubší (ani na
 *   stejném poli od jiné pozice). Hlubší záznam nese víc práce.
 * - Při ČTENÍ se ověřuje plný klíč: chytne kolizi kbelíku (dvě různé pozice
 *   spadnou na stejný index). Kolizi KLÍČE (dvě pozice, stejný 53-bit otisk)
 *   NEodhalí – to je vědomě přijaté riziko volby 53-bit klíče (zobrist.ts).
 *
 * Typ meze (`bound`) je pro alfa-beta: `exact` = přesné skóre, `lower` =
 * dolní mez (fail-high / cutoff), `upper` = horní mez (fail-low). Jak search
 * meze používá (jen při SHODNÉ hloubce, aby nezměnil výsledek fixní hloubky)
 * řeší search.ts.
 */

import type { Move } from '@checkers/rules';

/** Typ uloženého skóre vůči oknu alfa-beta. */
export type BoundType = 'exact' | 'lower' | 'upper';

/** Jeden záznam TT. */
export interface TtEntry {
  /** Plný 53-bit Zobrist klíč – ověřuje se při čtení (kolize kbelíku). */
  readonly key: number;
  /** Zbývající hloubka, do níž byla pozice prohledána. */
  readonly depth: number;
  /** Uložené skóre z pohledu strany na tahu (celé číslo). */
  readonly score: number;
  /** Typ meze skóre vůči oknu při uložení. */
  readonly bound: BoundType;
  /** Nejlepší tah v pozici (pro řazení tahů); `null`, když není znám. */
  readonly bestMove: Move | null;
}

/** Výchozí exponent velikosti: 2^20 ≈ 1 M polí. */
const DEFAULT_SIZE_EXPONENT = 20;

/**
 * Transpoziční tabulka pevné velikosti. Životnost je jedno prohledávání
 * (jedno volání `searchTimed`, sdílená napříč iterativním prohlubováním);
 * `clear()` ji vrátí do prázdného stavu pro nové prohledávání.
 */
export class TranspositionTable {
  private readonly size: number;
  private readonly slots: (TtEntry | null)[];

  /** `sizeExponent` = log2 počtu polí (1..24). */
  constructor(sizeExponent: number = DEFAULT_SIZE_EXPONENT) {
    if (!Number.isInteger(sizeExponent) || sizeExponent < 1 || sizeExponent > 24) {
      throw new RangeError(`Neplatný exponent velikosti TT: ${String(sizeExponent)}`);
    }
    this.size = 2 ** sizeExponent;
    this.slots = new Array<TtEntry | null>(this.size).fill(null);
  }

  /** Vyprázdní tabulku (na začátku nového prohledávání). */
  clear(): void {
    this.slots.fill(null);
  }

  /** Index pole pro klíč. `% size` (mocnina dvojky) – ne bitová maska (53 b). */
  private index(key: number): number {
    return key % this.size;
  }

  /**
   * Vrátí záznam pro klíč, nebo `null`. Ověřuje plný klíč: záznam s jiným
   * klíčem na stejném poli (kolize kbelíku) se chová jako „nenalezeno".
   */
  probe(key: number): TtEntry | null {
    const entry = this.slots[this.index(key)];
    // Ověření plného klíče: cizí záznam na stejném poli (kolize kbelíku) i
    // prázdné/mimo rozsah pole (`?.` → undefined) se chovají jako „nenalezeno".
    if (entry?.key === key) {
      return entry;
    }
    return null;
  }

  /**
   * Uloží záznam. Náhrada „preferuj hlubší": pokud na poli je HLUBŠÍ záznam
   * (větší `depth`, byť od jiné pozice), nový mělčí se zahodí. Shodná/menší
   * hloubka na poli se přepíše (i obnova téže pozice novější mezí).
   */
  store(key: number, depth: number, score: number, bound: BoundType, bestMove: Move | null): void {
    const i = this.index(key);
    // Prázdné/mimo rozsah pole → sentinel −1 (reálné hloubky jsou ≥ 1), aby
    // se nový záznam vždy uložil; hlubší existující záznam se zachová.
    const existingDepth = this.slots[i]?.depth ?? -1;
    if (existingDepth > depth) {
      return;
    }
    this.slots[i] = { key, depth, score, bound, bestMove };
  }
}

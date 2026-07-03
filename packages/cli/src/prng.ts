/**
 * Mulberry32 – malý deterministický PRNG.
 *
 * Vědomá kopie `packages/rules/test/support/prng.ts`: test support jiného
 * balíčku není jeho veřejné API a rules má zůstat čistá knihovna pravidel
 * bez utilit tohoto druhu. Duplicita je levnější než falešná závislost.
 * CLI nesmí používat Math.random pro tahy – se seedem je každá partie
 * reprodukovatelná (stejný seed = stejná partie).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

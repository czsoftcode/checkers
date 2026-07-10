/**
 * Mulberry32 – malý deterministický PRNG (zdroj náhody v [0, 1)).
 *
 * Vědomá kopie `packages/server/src/prng.ts` (a `packages/cli/src/prng.ts`).
 * Duplicita jednoho krátkého vzorce je levnější než falešná závislost mezi
 * balíčky (web na server ani cli nezávisí; `rules` má zůstat čistá knihovna
 * pravidel bez utilit tohoto druhu).
 *
 * K čemu v prohlížeči: (1) los třítahového zahájení (3-move ballot) pro úroveň
 * Mistrovství v `LocalClient`; (2) seed náhody pro výběr tahu enginu
 * (`computeAiMove` konzumuje rng pro tie-break a nepozornost). Produkce si vezme
 * náhodný seed (`Math.random`); test injektuje pevný seed, takže je výběr
 * reprodukovatelný (stejný seed = stejný tah) a regresní test má zuby.
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

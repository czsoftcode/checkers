/**
 * Mulberry32 – malý deterministický PRNG (zdroj náhody v [0, 1)).
 *
 * Vědomá kopie `packages/cli/src/prng.ts` (a rules test-support). Rules má
 * zůstat čistá knihovna pravidel bez utilit tohoto druhu a cli test-support
 * není veřejné API – duplicita jednoho krátkého vzorce je levnější než falešná
 * závislost mezi balíčky.
 *
 * K čemu na serveru: los třítahového zahájení (3-move ballot) pro úroveň
 * Mistrovství. Produkce si vezme `Math.random`; test injektuje seedovaný
 * `mulberry32(seed)`, takže je los reprodukovatelný (stejný seed = stejný
 * ballot) a test má deterministické zuby. Vlastní výběr indexu do decku dělá
 * store – tady je jen zdroj náhody.
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

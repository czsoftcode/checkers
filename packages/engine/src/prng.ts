/**
 * Mulberry32 – malý deterministický PRNG.
 *
 * Vědomá kopie `packages/cli/src/prng.ts` (a test supportu rules) ze
 * stejného důvodu jako tam: sdílet utilitu přes hranici balíčku by
 * vytvořilo falešnou závislost. Engine nesmí používat Math.random –
 * se seedem je výběr tahu reprodukovatelný v testech.
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

/**
 * Mulberry32 – malý deterministický PRNG pro testy. Testy NESMÍ používat
 * Math.random: se seedem je každý běh stejný, takže zelený test zůstane
 * zelený. Sdílí ho test terminace a round-trip test notace.
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

/**
 * Výběr náhodného pozadí stránky z obrázků `src/assets/background_*.webp`.
 *
 * Počet obrázků se NEzadává natvrdo: Vite při buildu vyčte soubory přes
 * `import.meta.glob` a každému přidělí hashovanou URL. Přidání dalšího
 * `background_<NN>.webp` do `assets/` se tak projeví po rebuildu bez zásahu do
 * kódu. Výběr běží při každé nové partii (viz `app-shell.ts`).
 *
 * `pickBackground` je čistá a bez DOM/glob – RNG se injektuje, aby šla otestovat
 * deterministicky (viz `test/backgrounds.test.ts`).
 */

/**
 * URL všech dostupných obrázků pozadí. `eager: true` je načte hned při buildu,
 * `query: '?url', import: 'default'` dá místo modulu rovnou řetězec s URL (Vite 8).
 * Prázdné pole (žádný soubor v assets) je legální stav – `pickBackground` ho zvládne.
 */
const modules = import.meta.glob<string>('./assets/background_*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const backgroundUrls: string[] = Object.values(modules);

/**
 * Vybere náhodně jednu URL ze seznamu. `rng` vrací číslo v [0, 1) (výchozí
 * `Math.random`). Nikdy nevyhazuje výjimku.
 *
 * `exclude` (obvykle právě zobrazené pozadí) se z výběru vyřadí, aby dvě po sobě
 * jdoucí losování nevrátila stejný obrázek. Losuje se pak jen ze zbytku a
 * distribuce jde přes délku ZBYTKU (`pool.length`), ne původního seznamu.
 * `exclude`, který v seznamu není (zastaralý), nebo `undefined` nechají výběr
 * beze změny. Když by po vyřazení nezbylo nic (jediný obrázek se rovná
 * `exclude`), padá se zpět na původní `urls` – radši zopakovat pozadí než vrátit
 * `undefined` a přijít o obrázek.
 *
 * Prázdný seznam → `undefined`: `Math.min(0, -1) = -1` a `pool[-1]` je `undefined`
 * (žádná zvláštní větev – indexace mimo pole to řeší sama). Volající to překlopí
 * na výchozí barevné pozadí z CSS. `Math.min(..., length-1)` navíc chrání proti
 * rng, které vrátí přesně 1 (mimo kontrakt), ať index nepřeteče za konec pole.
 */
export function pickBackground(
  urls: readonly string[],
  rng: () => number = Math.random,
  exclude?: string,
): string | undefined {
  const filtered = urls.filter((url) => url !== exclude);
  // Prázdný pool (jediný obrázek == exclude) → zpět na plný seznam. Prázdné
  // `urls` zůstanou prázdná v obou větvích → index -1 → undefined.
  const pool = filtered.length > 0 ? filtered : urls;
  const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
  return pool[index];
}

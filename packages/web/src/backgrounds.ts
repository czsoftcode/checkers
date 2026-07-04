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
const modules = import.meta.glob('./assets/background_*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const backgroundUrls: string[] = Object.values(modules);

/**
 * Vybere náhodně jednu URL ze seznamu. `rng` vrací číslo v [0, 1) (výchozí
 * `Math.random`). Nikdy nevyhazuje výjimku.
 *
 * Prázdný seznam → `undefined`: `Math.min(0, -1) = -1` a `urls[-1]` je `undefined`
 * (žádná zvláštní větev – indexace mimo pole to řeší sama). Volající to překlopí
 * na výchozí barevné pozadí z CSS. `Math.min(..., length-1)` navíc chrání proti
 * rng, které vrátí přesně 1 (mimo kontrakt), ať index nepřeteče za konec pole.
 */
export function pickBackground(
  urls: readonly string[],
  rng: () => number = Math.random,
): string | undefined {
  const index = Math.min(Math.floor(rng() * urls.length), urls.length - 1);
  return urls[index];
}

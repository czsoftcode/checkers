/**
 * Úrovně obtížnosti hry a jejich mapování na páky síly enginu.
 *
 * Toto je JEDINÝ zdroj pravdy o tom, jaká úroveň znamená jak silného soupeře.
 * Server (zod validace těla POST /games), store (uložení úrovně partie) i test
 * čtou odsud – čísla se nikde neopisují. Páky (`maxDepth`, `carelessness`) samy
 * definuje protokol enginu (fáze 34); tady se jen přiřazují k úrovni.
 *
 * Kalibrace čísel je PRVNÍ ODHAD, ne ověřená obtížnost: fáze 34 dokázala jen
 * monotónní oslabení, ne cílové % výher. Doladění je editace téhle konstanty
 * (a nasazení), ne přepínač za běhu – vědomé omezení rozsahu.
 */

import type { Strength } from './engine-client.js';

/** Úroveň obtížnosti. Interní hodnoty (drát/kód); v UI se lokalizují do češtiny. */
export const LEVELS = ['professional', 'beginner'] as const;

/** Typ úrovně odvozený ze seznamu – přidání úrovně = jediná změna v `LEVELS`. */
export type GameLevel = (typeof LEVELS)[number];

/**
 * Výchozí úroveň, když klient žádnou nepošle (`POST /games` bez `level`).
 * Profesionál = dnešní chování před fází 35 → zpětně kompatibilní: starý klient
 * i testy, které tělo neposílají, hrají jako dřív proti plné síle.
 */
export const DEFAULT_LEVEL: GameLevel = 'professional';

/**
 * Mapa úroveň → páky síly předané enginu při `bestmove`.
 *
 * `professional` → `undefined`: ŽÁDNÉ páky. Server enginu pošle přesně dnešní
 * požadavek (bez `maxDepth`/`carelessness`), takže Profesionál hraje bit po bitu
 * jako před fází 35 (viz zpětná kompatibilita v EngineClient).
 *
 * `beginner` → `maxDepth: 1` (kouká jen na svůj tah + povinná braní, ne na
 * dvoutahové hrozby soupeře) + mírná nepozornost. Kalibrace opřená o měření
 * (fáze 35): hloubka je DOMINANTNÍ páka – `maxDepth 2` prohrává mělkému soupeři
 * (hloubka 1) jen 7:3 a slabšího člověka pořád poráží; `maxDepth 1` prohrává
 * témuž soupeři 10:0, teprve to dá slabšímu hráči vyhratelnou partii. Nepozornost
 * při hloubce 1 skoro nemění výsledek (bariérou je mělkost, ne „druhý nejlepší
 * tah"), drží se proto mírná – jen ať engine občas zahraje horší tah k potrestání.
 * Braní je v americké dámě povinné, takže darovaný kámen engine sebere vždy;
 * poražitelnost stojí na tom, že sám nevidí soupeřovy delší hrozby.
 */
export const STRENGTH_BY_LEVEL: Record<GameLevel, Strength | undefined> = {
  professional: undefined,
  beginner: { maxDepth: 1, carelessness: 0.5 },
};

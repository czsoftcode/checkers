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
export const LEVELS = ['professional', 'intermediate', 'beginner', 'education'] as const;

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
 *
 * `intermediate` → `maxDepth: 3` + mírná nepozornost (`carelessness: 0.2`).
 * Střed mezi Začátečníkem (hloubka 1) a Profesionálem (neomezená hloubka).
 * Kalibrace opřená o self-play (fáze 36, `runStrengthMatch`, seedované): proti
 * Začátečníkovi {d1, c0.5} vyhrává drtivě (100 %, 12:0 na malém N), proti
 * pro-like straně jasně prohrává ({d4, c0}: 8 %; {d6, c0}: 4 %) – pořadí síly
 * sedí. Hloubka 3 vidí bezprostřední rekaptury a jednoduché dvojtahové hrozby,
 * ne hluboké kombinace; nepozornost 0.2 (méně než začátečníkových 0.5) nechá
 * engine občas zahrát druhý nejlepší tah, aby ho schopnější člověk mohl
 * potrestat, ale drží ho výrazně spolehlivějším než Začátečníka. Čísla jsou
 * první rozumný odhad, ne ověřená obtížnost proti člověku (self-play je šumivý
 * a Profesionál v provozu má neomezenou hloubku – test ho jen aproximuje).
 */
export const STRENGTH_BY_LEVEL: Record<GameLevel, Strength | undefined> = {
  professional: undefined,
  intermediate: { maxDepth: 3, carelessness: 0.2 },
  beginner: { maxDepth: 1, carelessness: 0.5 },
  // `education` → `undefined`: soupeř hraje PLNOU silou, stejně jako Profesionál.
  // Dvě úrovně tak mají záměrně shodnou sílu soupeře – rozdíl Výuky je JEN klientský
  // (na tahu člověka se ukazuje nápověda, endpoint /hint). Server o „výukovosti"
  // nerozhoduje jinak než touto úrovní; nápověda samotná jede vždy plnou silou
  // nezávisle na úrovni. Plná síla je zvolená vědomě: nápověda ukáže vždy nejlepší
  // tah (držíš-li se jí, hraješ optimálně; odchýlíš-li se, engine chybu potrestá =
  // učení). Slabší soupeř by chyby netrestal tak, aby se hráč poučil.
  education: undefined,
};

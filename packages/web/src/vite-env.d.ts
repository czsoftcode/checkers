/// <reference types="vite/client" />

/**
 * Typy pro vlastní `VITE_` proměnné (fáze 89). Bez tohoto by `import.meta.env.VITE_ITCH`
 * mělo typ `any` (index signature z vite/client) – deklarace je zpřesní na `string`,
 * ať se překlep v názvu chytne při typové kontrole. Proměnné existují jen v itch buildu
 * (`.env.itch`); ve výchozím buildu jsou `undefined`, proto jsou volitelné.
 */
interface ImportMetaEnv {
  /** "1" v itch buildu, jinak nedefinováno (viz `.env.itch`). */
  readonly VITE_ITCH?: string;
  /** Adresa živé verze pro modal „hrát s člověkem" (jen itch build). */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

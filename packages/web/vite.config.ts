import { defineConfig } from 'vite';

/**
 * Konfigurace webového klienta.
 *
 * Zatím výchozí – kořen balíčku obsahuje `index.html`, vstupní modul je
 * `src/main.ts`. Žádné inline scripty ani styly (CSP): skript se linkuje
 * z HTML a CSS Vite v produkci extrahuje do samostatného souboru.
 */
export default defineConfig({
  server: { port: 5173 },
});

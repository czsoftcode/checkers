import { defineConfig } from 'vite';

/**
 * Konfigurace webového klienta.
 *
 * Kořen balíčku obsahuje `index.html`, vstupní modul je `src/main.ts`. Žádné
 * inline scripty ani styly (CSP): skript se linkuje z HTML a CSS Vite v produkci
 * extrahuje do samostatného souboru.
 *
 * `server.proxy` přeposílá volání API (`/games…`) na autoritativní server na
 * portu 3000 (server `DEFAULT_PORT`). Klient tak volá relativní cesty ze stejného
 * původu – žádné CORS a žádná URL serveru natvrdo v kódu. V produkci by stejnou
 * roli plnil reverzní proxy před oběma službami.
 */
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/games': { target: 'http://127.0.0.1:3000' },
    },
  },
});

import { defineConfig } from 'vitest/config';

/**
 * Konfigurace webového klienta.
 *
 * Kořen balíčku obsahuje `index.html`, vstupní modul je `src/main.ts`. Žádné
 * inline scripty ani styly (CSP): skript se linkuje z HTML a CSS Vite v produkci
 * extrahuje do samostatného souboru.
 *
 * `server.proxy` přeposílá volání API (`/games…`) i WebSocket místnosti (`/room/ws`,
 * `ws: true`) na autoritativní server na portu 3000 (server `DEFAULT_PORT`). Klient
 * tak volá relativní cesty ze stejného původu – žádné CORS a žádná URL serveru
 * natvrdo v kódu. V produkci by stejnou roli plnil reverzní proxy před oběma
 * službami (pozor: musí umět i WS upgrade – viz todo 46).
 */
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/games': { target: 'http://127.0.0.1:3000' },
      // Místnost jede po WebSocketu (`/room/ws`); `ws: true` zapne upgrade spojení,
      // jinak by ho dev proxy neprotáhla a lobby by se lokálně nepřipojilo.
      '/room': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  test: {
    // jsdom shim (viz test/setup.ts): tichý `HTMLMediaElement.play`, ať přehrávání
    // zvuku v testech nezaplevelí výstup „Not implemented".
    setupFiles: ['./test/setup.ts'],
  },
});

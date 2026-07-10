import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

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
 *
 * ITCH MÓD (`vite build --mode itch`, fáze 89): statický AI-only build pro itch.io.
 * Liší se od výchozího buildu ve TŘECH věcech, jinak je shodný:
 *  - `base: './'` – appka běží z PODCESTY (`html-classic.itch.zone/html/<id>/`), ne
 *    z kořene domény, takže cesty k assetům musí být relativní, ne absolutní.
 *  - strip Plausible `<script>` – externí měřicí skript na itch nefunguje (offline /
 *    sandbox) a itch má vlastní měření; hlavní web ho má dál.
 *  - `/favicon.ico` → `./favicon.ico` – absolutní odkaz na favicon (fáze 85) by se z
 *    podcesty rozbil; Vite u odkazu na public-dir asset base NEmusí aplikovat sám,
 *    proto ho přepisujeme ručně v `transformIndexHtml` (a ověřujeme ve výstupu).
 * Přepínač jazyka/lobby ví o itch módu přes `import.meta.env.VITE_ITCH` (z `.env.itch`).
 * VÝCHOZÍ build (`vite build` bez `--mode itch`) zůstává beze změny: base `/`,
 * Plausible přítomný, favicon absolutní.
 */

/**
 * HTML transform pro itch build: odstraní externí Plausible skript a přepíše
 * absolutní favicon na relativní. Běží jen v itch módu (jinde se plugin vůbec
 * nezařadí). `enforce: 'post'` = spouští se AŽ po vlastním HTML zpracování Vite,
 * takže normalizuje i případný `/favicon.ico`, který by Vite nechal absolutní.
 */
function itchHtmlPlugin(): Plugin {
  return {
    name: 'checkers-itch-html',
    enforce: 'post',
    transformIndexHtml(html: string): string {
      return (
        html
          // Plausible `<script async src="…plausible…js"></script>` (i víceřádkový:
          // `[^>]` matchuje i newline). Klíč „plausible" v src ho odliší od modul-
          // scriptu appky. Bez tohoto by se z itch snažil tahat měřicí skript.
          .replace(/\s*<script\b[^>]*plausible[^>]*>\s*<\/script>/gi, '')
          // I HTML komentář o Plausible – jinak by build tvrdil, že měří přes Plausible,
          // ačkoli skript je pryč (zavádějící). Lookahead `(?!-->)` hlídá, ať se match
          // nepřelije přes hranici komentáře a nesežral i sousední (favicon) komentář.
          .replace(/\s*<!--(?:(?!-->)[\s\S])*?Plausible(?:(?!-->)[\s\S])*?-->/gi, '')
          // Absolutní favicon → relativní, ať se načte i z podcesty itch.zone.
          .replace(/(href=)(["'])\/favicon\.ico\2/gi, '$1$2./favicon.ico$2')
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isItch = mode === 'itch';
  return {
    // Itch běží z podcesty → relativní base; jinak kořen domény (dnešní chování).
    base: isItch ? './' : '/',
    plugins: isItch ? [itchHtmlPlugin()] : [],
    server: {
      port: 5173,
      // Naslouchat na všech síťových rozhraních (ne jen localhost), ať jde dev klient
      // otevřít z jiného zařízení ve stejné síti (mobil ↔ počítač, testování PvP). Vite
      // pak vypíše i „Network:" URL. POZOR: vystavuje dev server celé LAN – vhodné jen v
      // důvěryhodné síti; server (Fastify) zůstává na 127.0.0.1, mobil k němu jde přes tuhle proxy.
      host: true,
      proxy: {
        // `/games` nese REST (POST/GET partie) I WebSocket stavu partie (`/games/:id/ws`,
        // fáze 66/72). `ws: true` zapne upgrade spojení (běžné HTTP requesty proxy dál
        // obsluhuje) – bez něj by se PvP stav klientovi nikdy nedoručil (deska by visela
        // na „Připojuji k partii…"). Engine deska jede REST pollingem, tam WS netřeba.
        '/games': { target: 'http://127.0.0.1:3000', ws: true },
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
  };
});

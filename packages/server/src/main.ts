/**
 * Vstupní bod serveru: postaví app a nechá ji naslouchat. Port lze přebít
 * proměnnou PORT.
 *
 * Server od fáze 90 NEpočítá AI – hra proti počítači běží celá v prohlížeči
 * (@checkers/ai ve Web Workeru). Server je autorita jen nad PvP (room WS +
 * `/games/:id/ws`), žádný podproces enginu se nespouští. `pdnDir` se app předává
 * dál (PDN modul se drží pro budoucí napojení na PvP archiv), i když ho dnes nic
 * nevolá. Při vypnutí (SIGTERM/SIGINT) se korektně zavře HTTP server.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, DEFAULT_PORT } from './index.js';

const port = Number(process.env.PORT ?? DEFAULT_PORT);

// Kam archivovat dokončené partie (PDN).
// Výchozí `.pdn` ukotvíme na KOŘEN REPA odvozený z polohy tohoto zdrojáku
// (packages/server/src/main.ts → ../../..), NE na `process.cwd()`. Důvod:
// `pnpm --filter @checkers/server start` spouští proces s cwd = packages/server,
// takže cwd-relativní default by soubory házel vedle balíku, ne do rootu, kde je
// člověk čeká. Pozor: `../../..` napevno předpokládá umístění balíku v repu –
// když se přesune, je potřeba upravit i tohle.
// `CHECKERS_PDN_DIR` (když je zadán) se naopak bere relativně ke cwd, jako u
// běžných nástrojů; absolutní cesta (např. ~/.checkers/pdn) funguje taky.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pdnDir = process.env.CHECKERS_PDN_DIR
  ? resolve(process.env.CHECKERS_PDN_DIR)
  : resolve(repoRoot, '.pdn');

const app = buildApp({ pdnDir });

/** Tvrdá pojistka: kdyby cokoli viselo, proces se ukončí i bez čistého konce. */
const HARD_EXIT_TIMEOUT_MS = 5000;

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} – vypínám server…`);

  // Pojistka proti zavěšení: ať se stane cokoli, proces po HARD_EXIT skončí.
  const hardExit = setTimeout(() => {
    console.error('Vypínání trvá příliš dlouho, končím tvrdě.');
    process.exit(1);
  }, HARD_EXIT_TIMEOUT_MS);
  hardExit.unref();

  try {
    await app.close();
  } catch (err) {
    console.error('Chyba při zavírání serveru:', err);
    process.exit(1);
  }
  process.exit(0);
}

function onSignal(signal: string): void {
  if (shuttingDown) {
    // Druhý signál během vypínání = uživatel chce ven hned.
    console.error('Druhý signál – tvrdé ukončení.');
    process.exit(1);
  }
  shuttingDown = true;
  void shutdown(signal);
}

process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

async function start(): Promise<void> {
  const address = await app.listen({ port, host: '127.0.0.1' });
  console.log(`Server naslouchá na ${address}`);
}

start().catch((err: unknown) => {
  console.error('Server se nepodařilo spustit:', err);
  process.exit(1);
});

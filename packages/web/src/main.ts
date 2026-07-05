/**
 * Vstupní bod webového klienta: postaví skořápku (řádek stavu, výběr úrovně,
 * tlačítka Vzdávám hru / Nová hra) a nechá ji založit partii na serveru.
 *
 * Skořápka zakládá první partii sama (`POST /games`, napoprvé Profesionál) –
 * uživatele uvítá kompletní deska, ne prázdná obrazovka. Úroveň jde volně
 * přepínat až do prvního tahu, pak se zamkne. Deska se NESEEDUJE lokálním
 * `initialPosition()`, jediným zdrojem výchozí pozice je server.
 */

import { APP_TITLE } from './index.js';
import { createAppShell } from './app-shell.js';
import { createHttpClient } from './server-client.js';
import './analytics.js';
import './styles.css';

document.title = APP_TITLE;

const app = document.querySelector('#app');
if (!(app instanceof HTMLElement)) {
  throw new Error('Kořenový prvek #app nebyl ve stránce nalezen.');
}

const client = createHttpClient();
app.replaceChildren(createAppShell(client).element);

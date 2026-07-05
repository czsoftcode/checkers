/**
 * Vstupní bod webového klienta: postaví skořápku (řádek stavu, tlačítka Vzdávám
 * hru / Nová hra) a nechá ji založit partii na serveru.
 *
 * Skořápka zakládá partii sama (`POST /games`) a řídí i její restart přes
 * tlačítko „Nová hra" – deska se NESEEDUJE lokálním `initialPosition()`, jediným
 * zdrojem výchozí pozice je server. (Do fáze 24 byl restart jen obnovením stránky.)
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

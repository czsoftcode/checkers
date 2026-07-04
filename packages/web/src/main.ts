/**
 * Vstupní bod webového klienta: založí partii na serveru a vykreslí desku z
 * jeho odpovědi.
 *
 * Partii zakládá automaticky při načtení (`POST /games`). Do doby, než server
 * odpoví, ukazuje „Načítám partii…" – deska se NESEEDUJE lokálním
 * `initialPosition()`, jediným zdrojem výchozí pozice je server. Restart hry =
 * obnovení stránky (tlačítko Nová hra řeší až pozdější fáze).
 */

import { APP_TITLE } from './index.js';
import { createBoardController } from './controller.js';
import { createHttpClient } from './server-client.js';
import './styles.css';

document.title = APP_TITLE;

const app = document.querySelector('#app');
if (!(app instanceof HTMLElement)) {
  throw new Error('Kořenový prvek #app nebyl ve stránce nalezen.');
}
const root = app;

root.textContent = 'Načítám partii…';

const client = createHttpClient();

async function bootstrap(): Promise<void> {
  try {
    const game = await client.createGame();
    root.replaceChildren(createBoardController(client, game).element);
  } catch (error) {
    console.error('Nepodařilo se založit partii:', error);
    root.textContent = 'Partii se nepodařilo načíst. Zkuste stránku obnovit.';
  }
}

void bootstrap();

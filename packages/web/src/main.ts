/**
 * Vstupní bod webového klienta: vykreslí desku s výchozím rozestavením do `#app`.
 */

import { initialPosition } from '@checkers/rules';

import { APP_TITLE } from './index.js';
import { createBoardController } from './controller.js';
import './styles.css';

document.title = APP_TITLE;

const app = document.querySelector('#app');
if (!(app instanceof HTMLElement)) {
  throw new Error('Kořenový prvek #app nebyl ve stránce nalezen.');
}

app.append(createBoardController(initialPosition()).element);

/**
 * Vstupní bod webového klienta a PŘEPÍNAČ obrazovek (lobby ↔ deska).
 *
 * Úvod je MÍSTNOST ({@link createLobby}): hráč zadá přezdívku a vidí přítomné.
 * Odsud vede „Hrát proti počítači" na dnešní sólo desku ({@link createAppShell});
 * z desky se tlačítkem „Zpět do místnosti" vrátí do lobby. Vždy je namontovaná
 * PRÁVĚ JEDNA obrazovka: přepnutí tu předchozí `dispose`ne (lobby → zavře room WS,
 * deska → zastaví polling controlleru), takže nezůstane zombie spojení ani polling.
 */

import { APP_TITLE } from './index.js';
import { createAppShell } from './app-shell.js';
import { createLobby } from './lobby.js';
import { createHttpClient } from './server-client.js';
import './analytics.js';
import './styles.css';

document.title = APP_TITLE;

const rootEl = document.querySelector('#app');
if (!(rootEl instanceof HTMLElement)) {
  throw new Error('Kořenový prvek #app nebyl ve stránce nalezen.');
}
// Zúžený const (HTMLElement) do closures přepínače – narrowing z `instanceof` výš
// se do těl níže deklarovaných funkcí sám nepropíše.
const root: HTMLElement = rootEl;

const client = createHttpClient();

// `dispose` právě namontované obrazovky. Přepnutí ho zavolá PŘED výměnou DOM, ať
// se uklidí room WS (lobby) / polling (deska) a nezůstane běžet na pozadí.
let currentDispose: (() => void) | null = null;

/** Uklidí a odmontuje aktuální obrazovku (dispose + vyprázdnění kořene). */
function clearScreen(): void {
  currentDispose?.();
  currentDispose = null;
  root.replaceChildren();
}

/** Namontuje úvodní místnost. Odchod do sóla přepne na desku. */
function showLobby(): void {
  clearScreen();
  const lobby = createLobby({ onPlayVsComputer: showSolo });
  currentDispose = () => {
    lobby.dispose();
  };
  root.append(lobby.element);
}

/** Namontuje sólo desku proti počítači. Návrat do místnosti řeší tlačítko v řadě ovládání. */
function showSolo(): void {
  clearScreen();
  // `onExit` přidá do řady ovládání skořápky tlačítko „Do místnosti"; klik přepne
  // zpět na lobby (clearScreen skořápku disposne → zastaví polling).
  const shell = createAppShell(client, { onExit: showLobby });
  currentDispose = () => {
    shell.dispose();
  };
  root.append(shell.element);
}

showLobby();

/**
 * PLACEHOLDER herní obrazovky PvP partie. Po přijetí výzvy sem `main.ts` přejde
 * s `gameId`, vlastní barvou a přezdívkou soupeře (z `challenge-accepted`). Samotná
 * PvP deska a posílání tahů jsou VĚDOMĚ mimo tento řez = todo 47 – tady jen
 * potvrdíme, že partie vznikla a oba klienti do ní přešli.
 *
 * DŮLEŽITÉ: room WS zůstává OTEVŘENÝ i tady (drží ho `main.ts`, ne tato obrazovka).
 * Fáze 70 posílá PvP tahy po room WS a partie je na serveru navázaná na session id –
 * kdyby se WS zavřel, session by umřelo a partie by se rozpadla. „Zpět do místnosti"
 * proto jen přepne pohled, spojení nechá žít.
 *
 * Žádné inline styly ani skripty (CSP) – vzhled je ve `styles.css`.
 */

import type { ChallengeAcceptedInfo } from './room-client.js';

export interface GameScreenOptions {
  /** Návrat do místnosti (jen přepnutí pohledu; room WS řídí caller a NEzavírá se). */
  readonly onBackToRoom: () => void;
}

/** Ovládaná herní obrazovka. `dispose` odregistruje listenery (WS se tu nezavírá). */
export interface GameScreen {
  readonly element: HTMLElement;
  dispose(): void;
}

/** Lidský popis barvy hráče pro placeholder. */
function colorLabel(color: 'black' | 'white'): string {
  return color === 'black' ? 'černé' : 'bílé';
}

/** Postaví placeholder herní obrazovky. Vrací kořenový prvek k vložení do stránky. */
export function createGameScreen(info: ChallengeAcceptedInfo, options: GameScreenOptions): GameScreen {
  const element = document.createElement('div');
  element.className = 'game-screen';

  const card = document.createElement('div');
  card.className = 'game-card';

  const heading = document.createElement('h1');
  heading.className = 'game-title';
  heading.textContent = 'Partie začala';

  const colorLine = document.createElement('p');
  colorLine.className = 'game-line';
  colorLine.textContent = `Hraješ za: ${colorLabel(info.color)}`;

  const opponentLine = document.createElement('p');
  opponentLine.className = 'game-line';
  opponentLine.textContent = `Soupeř: ${info.opponentNick}`;

  // Malé gameId pomáhá při ručním ověření dvou prohlížečů (oba mají mít stejné).
  const gameLine = document.createElement('p');
  gameLine.className = 'game-id';
  gameLine.textContent = `Partie #${info.gameId}`;

  const note = document.createElement('p');
  note.className = 'game-note';
  note.textContent = 'Herní deska přijde v další fázi.';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'game-back-btn';
  backBtn.textContent = 'Zpět do místnosti';
  const onBack = (): void => {
    options.onBackToRoom();
  };
  backBtn.addEventListener('click', onBack);

  card.append(heading, colorLine, opponentLine, gameLine, note, backBtn);
  element.append(card);

  return {
    element,
    dispose: (): void => {
      backBtn.removeEventListener('click', onBack);
    },
  };
}

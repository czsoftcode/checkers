/**
 * Herní obrazovka PvP partie (člověk vs. člověk). Po přijetí výzvy sem `main.ts`
 * přejde s `gameId`, vlastní barvou a přezdívkou soupeře (z `challenge-accepted`)
 * a s mostem k živému room WS (`GameLink`).
 *
 * Skládá dohromady tři díly z jiných modulů:
 *  - {@link createPvpController} = deska (klik-tah vč. vícenásobného skoku, orientace
 *    dle vlastní barvy). Tah posílá přes `link.move` (room WS – fáze 70).
 *  - {@link createGameSocket} = odběr stavu partie přes `/games/:id/ws`; každý
 *    pushnutý stav předá `controller.applyState` (server je autorita, deska jen kreslí).
 *  - `link.onError` = chyby tahu (odmítnutí serverem) míří do `controller.showError`
 *    (deska se vrátí na poslední potvrzený stav, ukáže se hláška).
 *
 * DŮLEŽITÉ: room WS zůstává OTEVŘENÝ (drží ho `main.ts` přes lobby) – tahy jdou tudy
 * a partie je na serveru navázaná na session id; „Zpět do místnosti" jen přepne pohled.
 * Herní WS (stav) je NAOPAK vlastní téhle obrazovce a `dispose` ho zavře.
 *
 * Mimo řez (vědomě): vzdání/remíza (todo 40), reconnection (todo 42), timeout (todo 43).
 * Žádné inline styly ani skripty (CSP) – vzhled je ve `styles.css`.
 */

import type { Color, GameResult } from '@checkers/rules';

import { createGameSocket } from './game-socket.js';
import type { GameSocketFactory } from './game-socket.js';
import { createPvpController } from './pvp-controller.js';
import type { PvpStatus } from './pvp-controller.js';
import type { GameLink } from './lobby.js';
import type { ChallengeAcceptedInfo } from './room-client.js';

export interface GameScreenOptions {
  /** Návrat do místnosti (jen přepnutí pohledu; room WS řídí caller a NEzavírá se). */
  readonly onBackToRoom: () => void;
  /** Most k živému room WS: odeslání tahu + příjem chyb tahu (z lobby). */
  readonly link: GameLink;
  /** URL herního WS – jen pro testy; jinak se odvodí z `location`. */
  readonly gameSocketUrl?: string;
  /** Náhrada tovární funkce herního socketu – jen pro testy (fake socket). */
  readonly gameSocketFactory?: GameSocketFactory;
}

/** Ovládaná herní obrazovka. `dispose` zavře herní WS a odregistruje listenery (room WS se tu nezavírá). */
export interface GameScreen {
  readonly element: HTMLElement;
  dispose(): void;
}

/** Lidský popis barvy hráče. */
function colorLabel(color: Color): string {
  return color === 'black' ? 'černé' : 'bílé';
}

/** Text výsledku z pohledu hráče `myColor` (jen pro terminální výsledek). */
function outcomeText(result: Exclude<GameResult, 'ongoing'>, myColor: Color): string {
  if (result === 'draw') {
    return 'Remíza.';
  }
  const iWin =
    (result === 'black-wins' && myColor === 'black') ||
    (result === 'white-wins' && myColor === 'white');
  return iWin ? 'Vyhrál jsi!' : 'Prohrál jsi.';
}

/** Postaví herní obrazovku. Vrací kořenový prvek k vložení do stránky. */
export function createGameScreen(info: ChallengeAcceptedInfo, options: GameScreenOptions): GameScreen {
  const element = document.createElement('div');
  element.className = 'game-screen';

  const card = document.createElement('div');
  card.className = 'game-card';

  const heading = document.createElement('h1');
  heading.className = 'game-title';
  heading.textContent = 'Partie';

  const info_line = document.createElement('p');
  info_line.className = 'game-line';
  info_line.textContent = `Hraješ za ${colorLabel(info.color)} · soupeř ${info.opponentNick}`;

  // Řádek stavu: kdo je na tahu / výsledek. Aktualizuje ho controller přes onStatus.
  const statusLine = document.createElement('p');
  statusLine.className = 'game-status';
  statusLine.textContent = 'Připojuji k partii…';

  // Hláška odmítnutého tahu (chyba z room WS). Skrytá, dokud nic nepřijde.
  const errorLine = document.createElement('p');
  errorLine.className = 'game-error hidden';

  const controller = createPvpController({
    myColor: info.color,
    sendMove: (from, path) => options.link.move(from, path),
    onStatus: renderStatus,
    onError: showMoveError,
  });

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'game-back-btn';
  backBtn.textContent = 'Zpět do místnosti';
  const onBack = (): void => {
    options.onBackToRoom();
  };
  backBtn.addEventListener('click', onBack);

  card.append(heading, info_line, statusLine, errorLine, controller.element, backBtn);
  element.append(card);

  // Chyby tahu z room WS (přes lobby most) → deska se vrátí na poslední stav a ukáže hlášku.
  const unsubscribeError = options.link.onError((message) => {
    controller.showError(message);
  });

  // Odběr stavu partie přes herní WS. Každý push → controller.applyState.
  const gameSocket = createGameSocket(
    info.gameId,
    {
      onState: (game) => {
        controller.applyState(game);
      },
      onClosed: () => {
        // Spojení se stavem partie skončilo (pád / restart serveru / neznámá partie).
        // ZAMKNI desku (bez živého kanálu by potvrzený stav tahu nedorazil → deska by
        // tiše přijala tah, který nikam nejde) a ukaž trvalou hlášku. Reconnection je
        // todo 42 – „Zpět do místnosti" zůstává jediná cesta ven.
        controller.setConnectionLost();
        statusLine.textContent = 'Spojení s partií se přerušilo. Vrať se do místnosti.';
      },
    },
    {
      ...(options.gameSocketUrl === undefined ? {} : { url: options.gameSocketUrl }),
      ...(options.gameSocketFactory === undefined ? {} : { socketFactory: options.gameSocketFactory }),
    },
  );

  /** Vykreslí řádek stavu podle stavu partie z controlleru. Nová událost skryje starou chybu. */
  function renderStatus(status: PvpStatus): void {
    hideMoveError();
    if (status.result !== 'ongoing') {
      statusLine.textContent = outcomeText(status.result, info.color);
      return;
    }
    statusLine.textContent = status.myTurn ? 'Jsi na tahu.' : 'Na tahu je soupeř.';
  }

  function showMoveError(message: string): void {
    errorLine.textContent = message;
    errorLine.classList.remove('hidden');
  }
  function hideMoveError(): void {
    errorLine.textContent = '';
    errorLine.classList.add('hidden');
  }

  return {
    element,
    dispose: (): void => {
      backBtn.removeEventListener('click', onBack);
      unsubscribeError(); // chyby tahu už do zavřené obrazovky nesměruj
      gameSocket.close(); // zavři herní WS (room WS drží dál main.ts/lobby)
      controller.dispose();
    },
  };
}

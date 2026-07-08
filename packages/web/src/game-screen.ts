/**
 * Herní obrazovka PvP partie (člověk vs. člověk). Po přijetí výzvy sem `main.ts`
 * přejde s `gameId`, vlastní barvou a přezdívkou soupeře (z `challenge-accepted`)
 * a s mostem k živému room WS (`GameLink`).
 *
 * Rozvržení SDÍLÍ se hrou proti počítači (app-shell): svislý sloupec `.game` s
 * panelem ovládání NAD deskou (`.panel`/`.controls`), řádkem desky (`.board-row`)
 * a stavovým pruhem pod deskou (`.status-bar`). Na pozadí náhodný `background_NN.webp`
 * (`.page-bg`). Znovupoužití tříd i globálního `--board-size` drží „vejde se do
 * viewportu" na jednom místě – žádný druhý výpočet velikosti desky.
 *
 * Skládá dohromady tři díly z jiných modulů:
 *  - {@link createPvpController} = deska (klik-tah vč. vícenásobného skoku, orientace
 *    dle vlastní barvy). Tah posílá přes `link.move` (room WS – fáze 70).
 *  - {@link createGameSocket} = odběr stavu partie přes `/games/:id/ws`; každý
 *    pushnutý stav předá `controller.applyState` (server je autorita, deska jen kreslí).
 *  - `link.onError` = chyby tahu (odmítnutí serverem) míří do `controller.showError`
 *    (deska se vrátí na poslední potvrzený stav, ukáže se hláška).
 *
 * Kdo je na tahu ukazuje REÁLNÝ kámen na boku desky (`.pvp-turn`): na změnu tahu
 * se mění jen třída kamene (obrázek/barva), ne obal indikátoru. Kámen je primárně
 * webp (`black.webp`/`white.webp`), zapnutý přes třídu `.pvp-turn--img` AŽ po
 * ověřeném načtení (`preloadImages`); do té doby (a při chybě/jsdom) platí prosté
 * CSS kolečko černé/bílé. Barvu na tahu poznat i BEZ indikátoru z vlastních kamenů
 * dole, proto tu není textová hláška „kdo je na tahu" – textový pruh nese jen
 * výsledek, ztrátu spojení a chybu tahu.
 *
 * DŮLEŽITÉ: room WS zůstává OTEVŘENÝ (drží ho `main.ts` přes lobby) – tahy jdou tudy
 * a partie je na serveru navázaná na session id; „Zpět do místnosti" jen přepne pohled.
 * Herní WS (stav) je NAOPAK vlastní téhle obrazovce a `dispose` ho zavře.
 *
 * Mimo řez (vědomě): vzdání/remíza (todo 40), reconnection (todo 42), timeout (todo 43).
 * Žádné inline styly ani skripty (CSP) – vzhled je ve `styles.css`.
 */

import type { Color, GameResult } from '@checkers/rules';

import { backgroundUrls, pickBackground } from './backgrounds.js';
import { createGameSocket } from './game-socket.js';
import type { GameSocketFactory } from './game-socket.js';
import { preloadImages } from './image-preload.js';
import { createPvpController } from './pvp-controller.js';
import type { PvpStatus } from './pvp-controller.js';
import blackStoneUrl from './assets/black.webp?url';
import whiteStoneUrl from './assets/white.webp?url';
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
  /**
   * Náhrada tovární funkce na `Image` pro ověření kamenů indikátoru – jen pro testy
   * (fake Image, ať jde deterministicky ověřit přepnutí na webp). Ve hře je výchozí
   * `() => new Image()`; `null` (prostředí bez `Image`) ověření přeskočí a indikátor
   * zůstane na CSS fallbacku.
   */
  readonly createStoneImage?: (() => HTMLImageElement) | null;
}

/** Ovládaná herní obrazovka. `dispose` zavře herní WS a odregistruje listenery (room WS se tu nezavírá). */
export interface GameScreen {
  readonly element: HTMLElement;
  dispose(): void;
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
  // `true` po dispose(): async ověření kamenů (preloadImages) může doběhnout až po
  // odchodu z obrazovky – pak už do (odpojeného) indikátoru nesahej.
  let disposed = false;

  const element = document.createElement('div');
  element.className = 'game';

  // Pozadí celé stránky: skrytý `<img>` přes celý viewport, POD obsahem (třída
  // `.page-bg`). URL se losuje JEDNOU při vzniku obrazovky – nová partie = nová
  // výzva = nová obrazovka, uvnitř se „nová hra" neděje. Prázdný výčet (žádné pozadí)
  // → src='' → prosvítá barevné pozadí z CSS. `src` je atribut, ne styl → CSP OK.
  const pageBg = document.createElement('img');
  pageBg.className = 'page-bg';
  pageBg.alt = '';
  pageBg.src = pickBackground(backgroundUrls, Math.random) ?? '';
  element.append(pageBg);

  // Panel s ovládáním NAD deskou (na šířku desky). Vlevo TUČNÁ přezdívka soupeře,
  // svislý oddělovač, pak „Zpět do místnosti" a místo pro budoucí tlačítka
  // (vzdání/remíza = todo 40). Barvu, za kterou hraju, tu NEPÍŠEME – je jasná z
  // vlastních kamenů dole na desce.
  const panel = document.createElement('div');
  panel.className = 'panel';
  const controls = document.createElement('div');
  controls.className = 'controls pvp-controls';
  // Popisek „Soupeř:" (běžný řez) + TUČNÁ přezdívka, ať je jasné, že jde o jméno
  // soupeře, ne o moje.
  const opponentLabel = document.createElement('span');
  opponentLabel.className = 'pvp-opponent-label';
  opponentLabel.textContent = 'Soupeř:';
  const opponent = document.createElement('span');
  opponent.className = 'pvp-opponent';
  opponent.textContent = info.opponentNick;
  const divider = document.createElement('span');
  divider.className = 'controls-divider';
  divider.setAttribute('aria-hidden', 'true');
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn-back-room';
  backBtn.textContent = 'Zpět do místnosti';
  const onBack = (): void => {
    options.onBackToRoom();
  };
  backBtn.addEventListener('click', onBack);
  controls.append(opponentLabel, opponent, divider, backBtn);
  panel.append(controls);

  const controller = createPvpController({
    myColor: info.color,
    sendMove: (from, path) => options.link.move(from, path),
    onStatus: renderStatus,
    onError: showMoveError,
  });

  // Indikátor strany na tahu: SAMOTNÝ kámen na boku desky (bez prstence). Obal
  // (`.pvp-turn`) persistuje; na změnu tahu se přepíná jen třída kamene (.black/
  // .white → jiný obrázek/barva). Startuje skrytý, zobrazí se s prvním stavem
  // partie a schová se po konci (viz `updateTurnIndicator`). Kámen je webp až po
  // ověřeném načtení (`.pvp-turn--img`), jinak CSS kolečko.
  const turnIndicator = document.createElement('div');
  turnIndicator.className = 'pvp-turn hidden';
  const turnStone = document.createElement('div');
  turnStone.className = 'pvp-turn-stone';
  turnIndicator.append(turnStone);

  // Řádek desky: deska + indikátor na tahu vedle sebe (na <768 px se `.board-row`
  // v CSS přepne na sloupec a indikátor je pod deskou). Panel je NAD tímto řádkem.
  const boardRow = document.createElement('div');
  boardRow.className = 'board-row';
  boardRow.append(controller.element, turnIndicator);

  // Stavový pruh POD deskou (`flex: 1` ho roztáhne do zbytku výšky – deska se
  // nenatáhne a celek se vejde do okna). Nese už JEN: hlášku o načítání / výsledek /
  // ztrátu spojení (`statusLine`) a chybu odmítnutého tahu (`errorLine`). Kdo je na
  // tahu ukazuje kámen v indikátoru, ne text.
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  const statusLine = document.createElement('p');
  statusLine.className = 'status hidden';
  const errorLine = document.createElement('p');
  errorLine.className = 'pvp-error hidden';
  statusBar.append(statusLine, errorLine);

  element.append(panel, boardRow, statusBar);
  setStatus('Připojuji k partii…');

  // Zapnutí webp kamene indikátoru AŽ po ověřeném načtení obou obrázků (jako u
  // desky – `piece-images.ts`): jistota, že se `url(...)` ve `styles.css` opravdu
  // vykreslí, jinak zůstat na CSS kolečku. V jsdom se `onload`/`onerror` nevyvolá →
  // promise visí → fallback drží (test si `createStoneImage` injektuje). `null`
  // (prostředí bez `Image`) ověření přeskočí.
  const createStoneImage =
    options.createStoneImage ?? (typeof Image === 'function' ? (): HTMLImageElement => new Image() : null);
  if (createStoneImage !== null) {
    void preloadImages([blackStoneUrl, whiteStoneUrl], createStoneImage).then((ok) => {
      if (ok && !disposed) {
        turnIndicator.classList.add('pvp-turn--img');
      }
    });
  }

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
        // tiše přijala tah, který nikam nejde) a ukaž trvalou hlášku. `setConnectionLost`
        // uvnitř přes onStatus zavolá renderStatus (ta stav vyprázdní), proto hlášku
        // nastavujeme AŽ PO něm, ať ji nepřepíše. Reconnection je todo 42 – „Zpět do
        // místnosti" zůstává jediná cesta ven.
        controller.setConnectionLost();
        setStatus('Spojení s partií se přerušilo. Vrať se do místnosti.');
        // Deska je mrtvá → schovej i indikátor na tahu (jinak by dál svítil kámen a
        // aria-label by tvrdil „na tahu", i když se nedá hrát). Žádný další status už
        // nedorazí (kanál je zavřený a showError je po ztrátě spojení zahozen), takže
        // zůstane skrytý.
        turnIndicator.classList.add('hidden');
      },
    },
    {
      ...(options.gameSocketUrl === undefined ? {} : { url: options.gameSocketUrl }),
      ...(options.gameSocketFactory === undefined ? {} : { socketFactory: options.gameSocketFactory }),
    },
  );

  /** Nastaví text stavového řádku a schová ho, když je prázdný (ať prázdný odstavec ve vodorovném pruhu netvoří mezeru/oddělovač). */
  function setStatus(text: string): void {
    statusLine.textContent = text;
    statusLine.classList.toggle('hidden', text === '');
  }

  /**
   * Indikátor strany na tahu: viditelný jen za běhu partie (`result === 'ongoing'`),
   * kámen v barvě strany NA TAHU. `aria-label` nese informaci i pro čtečku (kámen je
   * jinak čistě vizuální). Barvu drž i ve skrytém stavu, ať při dalším zobrazení
   * neproblikne stará.
   */
  function updateTurnIndicator(status: PvpStatus): void {
    const ongoing = status.result === 'ongoing';
    turnIndicator.classList.toggle('hidden', !ongoing);
    turnStone.classList.toggle('black', status.turn === 'black');
    turnStone.classList.toggle('white', status.turn === 'white');
    turnIndicator.setAttribute('aria-label', status.turn === info.color ? 'Na tahu: ty' : 'Na tahu: soupeř');
  }

  /**
   * Vykreslí stav podle stavu partie z controlleru. Za běhu je textový řádek prázdný
   * (kdo je na tahu ukazuje kámen); terminální výsledek jde do řádku. Nová událost
   * skryje starou chybu tahu.
   */
  function renderStatus(status: PvpStatus): void {
    hideMoveError();
    updateTurnIndicator(status);
    if (status.result !== 'ongoing') {
      setStatus(outcomeText(status.result, info.color));
      return;
    }
    setStatus('');
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
      disposed = true;
      backBtn.removeEventListener('click', onBack);
      unsubscribeError(); // chyby tahu už do zavřené obrazovky nesměruj
      gameSocket.close(); // zavři herní WS (room WS drží dál main.ts/lobby)
      controller.dispose();
    },
  };
}

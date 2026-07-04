/**
 * Skořápka aplikace kolem desky: řádek stavu, tlačítka „Vzdávám hru" / „Nová
 * hra" a slot pro desku. Skořápka NEzná pravidla ani stav partie – jen přebírá
 * `GameStatus`, který jí controller hlásí ze serveru, a podle něj kreslí stav a
 * povoluje tlačítka.
 *
 * Dělba práce oproti controlleru: controller mluví se serverem a řídí desku,
 * skořápka řídí životní cyklus partie (Nová hra = zahodit starý controller
 * včetně jeho pollingu a založit nový) a potvrzení vzdání.
 */

import { createBoardController } from './controller.js';
import type { BoardController, BoardControllerOptions, GameStatus } from './controller.js';
import type { GameDto, ServerClient } from './server-client.js';

/** Tovární funkce controlleru – injektovatelná kvůli testům (výchozí = reálný). */
type ControllerFactory = (
  client: ServerClient,
  game: GameDto,
  options: BoardControllerOptions,
) => BoardController;

export interface AppShellOptions {
  /** Náhrada tovární funkce controlleru (test injektuje špiona). */
  readonly createController?: ControllerFactory;
  /** Perioda pollingu předaná controlleru. */
  readonly pollIntervalMs?: number;
}

/** Ovládaná aplikace. `dispose` uklidí i běžící controller (polling). */
export interface AppShell {
  readonly element: HTMLElement;
  dispose(): void;
}

/**
 * Postaví skořápku a založí první partii. Vrací kořenový prvek k vložení do
 * stránky; caller ho tam připne. Chyba při zakládání partie desku neshodí –
 * ukáže se hláška a „Nová hra" zůstane aktivní k dalšímu pokusu.
 */
export function createAppShell(client: ServerClient, options: AppShellOptions = {}): AppShell {
  const makeController = options.createController ?? createBoardController;

  const element = document.createElement('div');
  element.className = 'game';

  // Panel (stav + tlačítka) je plovoucí v pravém horním rohu (CSS position:
  // fixed), aby NEzabíral místo ve sloupci s deskou – jinak by se výška panelu
  // přičetla k desce a plocha by přetekla dolů z obrazovky.
  const panel = document.createElement('div');
  panel.className = 'panel';

  const status = document.createElement('p');
  status.className = 'status';

  // Řádek s hlavními tlačítky.
  const controls = document.createElement('div');
  controls.className = 'controls';
  const resignBtn = button('btn-resign', 'Vzdávám hru');
  const newGameBtn = button('btn-newgame', 'Nová hra');
  controls.append(resignBtn, newGameBtn);

  // Inline potvrzení vzdání (bez nativního confirm() kvůli CSP). Přepíná se s
  // `controls`; nikdy se nezobrazují obě řady zároveň.
  const confirm = document.createElement('div');
  confirm.className = 'confirm hidden';
  const confirmLabel = document.createElement('span');
  confirmLabel.textContent = 'Opravdu vzdát?';
  const yesBtn = button('btn-confirm-yes', 'Ano');
  const noBtn = button('btn-confirm-no', 'Zrušit');
  confirm.append(confirmLabel, yesBtn, noBtn);

  panel.append(status, controls, confirm);

  const boardSlot = document.createElement('div');
  boardSlot.className = 'board-slot';

  element.append(panel, boardSlot);

  let controller: BoardController | null = null;
  // Poslední známý výsledek – řídí stav tlačítek i to, jestli je vzdání aktuální.
  let lastResult: GameStatus['result'] = 'ongoing';
  // `true`, dokud běží zakládání nové partie (createGame) – ať se tlačítka a
  // dvojklik na „Nová hra" mezitím zablokují.
  let loading = false;
  // `true` po dispose(): kdyby se appka disposla během běžícího createGame,
  // nesmí se pak založit „zombie" controller s vlastním pollingem.
  let disposed = false;

  /** Přepne mezi hlavními tlačítky a inline potvrzením vzdání. */
  function showConfirm(show: boolean): void {
    controls.classList.toggle('hidden', show);
    confirm.classList.toggle('hidden', !show);
  }

  /** Text řádku stavu podle výsledku a strany na tahu. „Počítač" = bílý (engine). */
  function statusText(s: GameStatus): string {
    if (s.result === 'black-wins') {
      return 'Konec: vyhráli jste.';
    }
    if (s.result === 'white-wins') {
      return 'Konec: vyhrál počítač.';
    }
    if (s.result === 'draw') {
      return 'Konec: remíza.';
    }
    if (s.engineStatus === 'error') {
      return 'Počítač hlásí chybu – partie stojí.';
    }
    return s.turn === 'black' ? 'Jste na tahu (černé).' : 'Počítač je na tahu…';
  }

  /** Překreslí řádek stavu a nastaví tlačítka podle stavu partie. */
  function render(s: GameStatus): void {
    lastResult = s.result;
    status.textContent = statusText(s);
    const over = s.result !== 'ongoing';
    // Vzdát jde jen za běhu; novou hru jen po konci. Během zakládání obojí zamčené.
    resignBtn.disabled = over || loading;
    newGameBtn.disabled = !over || loading;
    // Po skončení partie nemá potvrzení vzdání smysl – schovej ho.
    if (over) {
      showConfirm(false);
    }
  }

  function onState(s: GameStatus): void {
    render(s);
  }

  /**
   * Zahodí starý controller (VČETNĚ jeho pollingu přes `dispose`) a založí novou
   * partii. `dispose` PŘED `createGame` je klíčové: jinak by po založení běžely
   * dva pollery na dvou partiích. Chyba zakládání se jen zobrazí, appka žije dál.
   */
  async function startNewGame(): Promise<void> {
    if (loading) {
      return;
    }
    loading = true;
    showConfirm(false);
    resignBtn.disabled = true;
    newGameBtn.disabled = true;
    if (controller !== null) {
      controller.dispose();
      controller = null;
    }
    boardSlot.replaceChildren();
    status.textContent = 'Načítám partii…';
    try {
      const game = await client.createGame();
      if (disposed) {
        return; // appka se mezitím disposla – nezakládej controller s pollingem
      }
      // `loading` MUSÍ být false ještě před vytvořením controlleru: ten hned
      // ohlásí výchozí stav přes onState → render() a to čte `loading` do stavu
      // tlačítek. Kdyby tu bylo pořád true, tlačítka by zůstala zamčená.
      loading = false;
      controller = makeController(client, game, {
        onState,
        ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      });
      boardSlot.append(controller.element);
    } catch (error) {
      loading = false;
      console.error('Nepodařilo se založit partii:', error);
      status.textContent = 'Partii se nepodařilo založit. Zkuste to znovu tlačítkem Nová hra.';
      // Chyba = partie „neběží": povol Novou hru k opakování, vzdání zamkni.
      lastResult = 'white-wins';
      resignBtn.disabled = true;
      newGameBtn.disabled = false;
    }
  }

  resignBtn.addEventListener('click', () => {
    if (lastResult === 'ongoing') {
      showConfirm(true);
    }
  });
  noBtn.addEventListener('click', () => {
    showConfirm(false);
  });
  yesBtn.addEventListener('click', () => {
    showConfirm(false);
    controller?.resign();
  });
  newGameBtn.addEventListener('click', () => {
    void startNewGame();
  });

  void startNewGame();

  return {
    element,
    dispose: () => {
      disposed = true;
      controller?.dispose();
      controller = null;
    },
  };
}

/** Vytvoří tlačítko s třídou a popiskem. */
function button(className: string, label: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}

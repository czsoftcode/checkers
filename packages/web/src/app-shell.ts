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

import { backgroundUrls, pickBackground } from './backgrounds.js';
import { createBoardController } from './controller.js';
import type {
  BoardController,
  BoardControllerOptions,
  DrawOfferOutcome,
  GameStatus,
} from './controller.js';
import { GAME_LEVELS } from './server-client.js';
import type { GameDto, GameLevel, ServerClient } from './server-client.js';

/**
 * České popisky úrovní pro UI (interní hodnoty zůstávají anglické na drátě).
 * `Record<GameLevel, …>` vynutí popisek pro KAŽDOU úroveň – přidání úrovně do
 * `GAME_LEVELS` bez popisku sem shodí typecheck (jediný zdroj = server-client).
 */
const LEVEL_LABELS: Record<GameLevel, string> = {
  professional: 'Profesionál',
  intermediate: 'Pokročilý',
  beginner: 'Začátečník',
};

/** Klíč v LocalStorage pro zapamatovanou volbu úrovně (přežije reload stránky). */
const LEVEL_STORAGE_KEY = 'checkers.level';

/**
 * Načte zapamatovanou úroveň z LocalStorage. Vrací `null`, když nic uloženo není,
 * uložená hodnota NENÍ platná úroveň (stará/poškozená/cizí zápis), nebo když
 * LocalStorage vůbec nejde (privátní režim, vypnuté úložiště → `getItem` hodí).
 * Čtení NESMÍ shodit start appky – proto try/catch a validace proti `GAME_LEVELS`,
 * ne slepá důvěra uloženému řetězci (jinak by neznámá hodnota protekla jako
 * `GameLevel` do `createGame` a server ji odmítl 400).
 */
function loadSavedLevel(): GameLevel | null {
  try {
    const raw = localStorage.getItem(LEVEL_STORAGE_KEY);
    if (raw !== null && (GAME_LEVELS as readonly string[]).includes(raw)) {
      return raw as GameLevel;
    }
  } catch {
    // LocalStorage nedostupný → tichý fallback na výchozí úroveň (return null).
  }
  return null;
}

/** Uloží zvolenou úroveň. Selhání zápisu (kvóta/privátní režim) je neškodné → spolknout. */
function saveLevel(level: GameLevel): void {
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, level);
  } catch {
    // Nejde uložit → preference se prostě nezapamatuje, appka běží dál.
  }
}

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

  // Pozadí CELÉ stránky: skrytý `<img>` na celý viewport, POD veškerým obsahem
  // (z-index/pozici řeší třída `.page-bg` v styles.css; `pointer-events: none`,
  // ať nezachytává kliky do desky). URL se losuje při každé nové partii ve
  // `startNewGame`. Nastavuje se přes `src` (atribut, ne styl) → CSP se ho netýká.
  const pageBg = document.createElement('img');
  pageBg.className = 'page-bg';
  pageBg.alt = '';
  element.append(pageBg);

  // Panel (stav + tlačítka) je v toku NAD deskou na obou layoutech (CSS: první
  // dítě `.game`, nad `.board-row`), na šířku desky. Dřív plaval fixed v rohu a
  // při některých šířkách zasahoval do desky; jeho výška se teď připočítává k
  // desce, proto CSS počítá s rezervou ve `--board-size`.
  const panel = document.createElement('div');
  panel.className = 'panel';

  const status = document.createElement('p');
  status.className = 'status';

  // Výběr úrovně pro DALŠÍ novou hru. Musí vzniknout PŘED prvním `startNewGame()`
  // (na konci funkce), protože jeho hodnotu čte při zakládání partie. Výchozí je
  // Profesionál (první `<option>`). Během rozehrané partie je zamčený (mění se jen
  // když jde založit nová hra) – ať nevzniká dojem, že přepnutí mění běžící partii.
  // Bez viditelného popisku (sedí v řádku tlačítek) → přístupnost drží aria-label.
  const levelSelect = document.createElement('select');
  levelSelect.className = 'level-select';
  levelSelect.setAttribute('aria-label', 'Úroveň soupeře pro novou hru');
  // Pořadí = pořadí v `GAME_LEVELS` (Profesionál → Pokročilý → Začátečník);
  // první je výchozí. Jediný zdroj hodnot i pořadí, žádná druhá kopie seznamu.
  for (const value of GAME_LEVELS) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = LEVEL_LABELS[value];
    levelSelect.append(opt);
  }
  // Předvyplň naposledy zvolenou úrovní z LocalStorage (přežije reload). Musí být
  // PŘED prvním `startNewGame()` (na konci funkce), který hodnotu selectu čte.
  // Neplatná/chybějící → necháme výchozí (první <option> = Profesionál).
  const savedLevel = loadSavedLevel();
  if (savedLevel !== null) {
    levelSelect.value = savedLevel;
  }

  // Řádek s ovládáním: vlevo přepínač úrovně, pak svislý oddělovač, pak hlavní
  // tlačítka. Přepínač je součást téhle řady (ne samostatný řádek nad ní).
  const controls = document.createElement('div');
  controls.className = 'controls';
  const controlsDivider = document.createElement('span');
  controlsDivider.className = 'controls-divider';
  controlsDivider.setAttribute('aria-hidden', 'true');
  const offerDrawBtn = button('btn-offer-draw', 'Nabízím remízu');
  const resignBtn = button('btn-resign', 'Vzdávám hru');
  const newGameBtn = button('btn-newgame', 'Nová hra');
  controls.append(levelSelect, controlsDivider, offerDrawBtn, resignBtn, newGameBtn);

  // Samostatný řádek pro verdikt nabídky remízy (řídí ho výhradně skořápka kolem
  // offerDraw, NE onState) – proud stavů z pollingu ho tak nepřepíše.
  const offerMsg = document.createElement('p');
  offerMsg.className = 'offer-msg hidden';

  // Inline potvrzení vzdání (bez nativního confirm() kvůli CSP). Přepíná se s
  // `controls`; nikdy se nezobrazují obě řady zároveň.
  const confirm = document.createElement('div');
  confirm.className = 'confirm hidden';
  const confirmLabel = document.createElement('span');
  confirmLabel.textContent = 'Opravdu vzdát?';
  const yesBtn = button('btn-confirm-yes', 'Ano');
  const noBtn = button('btn-confirm-no', 'Zrušit');
  confirm.append(confirmLabel, yesBtn, noBtn);

  panel.append(status, controls, confirm, offerMsg);

  const boardSlot = document.createElement('div');
  boardSlot.className = 'board-slot';

  // Indikátor strany na tahu: kruh v barvě tmavého pole desky se svítícím kamenem
  // barvy toho, kdo je na tahu (černý = člověk, bílý = počítač). Vzhled kamene sdílí
  // třídy `.piece.black/.white` s deskou (jeden zdroj vzhledu). Sourozenec desky
  // v `.board-row`: na desktopu (flex row) je vpravo od desky, na <768 (flex column)
  // pod ní. Řídí se výhradně z `render()` podle GameStatus – žádné vlastní volání
  // serveru. Startuje skrytý (`hidden`), zobrazí se až s prvním stavem partie.
  const turnIndicator = document.createElement('div');
  turnIndicator.className = 'turn-indicator hidden';
  const turnPiece = document.createElement('div');
  turnPiece.className = 'piece';
  turnIndicator.append(turnPiece);

  // Řádek desky: deska + indikátor strany na tahu vedle sebe. Panel je nad tímto
  // řádkem (v toku, ne fixed), aby na žádné šířce nezasahoval do desky. `.game` je
  // svislý sloupec [panel, board-row].
  const boardRow = document.createElement('div');
  boardRow.className = 'board-row';
  boardRow.append(boardSlot, turnIndicator);

  element.append(panel, boardRow);

  let controller: BoardController | null = null;
  // Poslední známý stav ze serveru – řídí stav tlačítek (result i turn a
  // engineStatus kvůli tlačítku nabídky remízy) a to, jestli je vzdání aktuální.
  let lastStatus: GameStatus = { result: 'ongoing', turn: 'black', engineStatus: 'idle' };
  // `true`, dokud běží zakládání nové partie (createGame) – ať se tlačítka a
  // dvojklik na „Nová hra" mezitím zablokují.
  let loading = false;
  // `true` od okamžiku, kdy v aktuální partii padl první tah (stav přestal být
  // „výchozí": černý na tahu, engine idle, hra běží). Zamyká výběr úrovně – před
  // prvním tahem jde volně přepínat, po něm ne. Resetuje se při každé nové hře.
  let firstMoveMade = false;
  // `true`, dokud čeká verdikt enginu na nabídku remízy (zámek proti dvojkliku +
  // zamčení tlačítka po dobu rozhodování).
  let offering = false;
  // `true` po dispose(): kdyby se appka disposla během běžícího createGame,
  // nesmí se pak založit „zombie" controller s vlastním pollingem.
  let disposed = false;
  // Právě zobrazené pozadí – přesně ta hodnota vrácená z `pickBackground` (jedna
  // z `backgroundUrls`), NE `pageBg.src`, který prohlížeč překlopí na absolutní
  // URL a řetězcové porovnání by pak selhalo. Předává se do `pickBackground` jako
  // `exclude`, aby se stejné pozadí nevylosovalo dvakrát po sobě.
  let lastBg: string | undefined;

  /** Přepne mezi hlavními tlačítky a inline potvrzením vzdání. */
  function showConfirm(show: boolean): void {
    controls.classList.toggle('hidden', show);
    confirm.classList.toggle('hidden', !show);
  }

  /**
   * Text řádku stavu. Za běhu partie je prázdný – kdo je na tahu, signalizuje
   * barva svítícího kamene (turn-indicator), ne text. Řádek nese jen konec partie
   * a chybu enginu.
   */
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
    return '';
  }

  /** Nastaví stav všech tlačítek podle posledního stavu partie + běžících operací. */
  function refreshControls(): void {
    const over = lastStatus.result !== 'ongoing';
    // Vzdát jde jen za běhu; novou hru jen po konci. Během zakládání obojí zamčené.
    resignBtn.disabled = over || loading;
    newGameBtn.disabled = !over || loading;
    // Výběr úrovně je volný PŘED prvním tahem (i za rozehrané, ale ještě
    // neodehrané partie) a po konci partie; zamčený je jen když se hraje
    // (padl první tah) nebo běží zakládání. Tím se úroveň nezamkne bez vědomí
    // hráče, ale rozehranou partii přepnutí nerozbije.
    levelSelect.disabled = loading || (!over && firstMoveMade);
    // Nabídnout remízu jde jen na tahu člověka (černý) a když engine nepřemýšlí;
    // ne během zakládání ani když už jedna nabídka čeká na verdikt. Server to i
    // tak ověří – tohle je jen UI, ne autorita.
    offerDrawBtn.disabled =
      over ||
      loading ||
      offering ||
      lastStatus.turn !== 'black' ||
      lastStatus.engineStatus === 'thinking';
  }

  /** Překreslí řádek stavu a nastaví tlačítka podle stavu partie. */
  function render(s: GameStatus): void {
    lastStatus = s;
    // Jakmile stav přestane být „výchozí" (černý na tahu, engine idle, hra běží),
    // padl první tah → zamkni výběr úrovně. Latch (jen nahoru): i když se stav
    // po tahu enginu vrátí na černý+idle, přepínač zůstane zamčený až do konce
    // partie / nové hry. Člověk je černý a táhne první, takže dřív než jeho
    // prvním tahem se sem nedostane nic než výchozí stav.
    if (s.result !== 'ongoing' || s.turn !== 'black' || s.engineStatus !== 'idle') {
      firstMoveMade = true;
    }
    status.textContent = statusText(s);
    refreshControls();
    updateTurnIndicator(s);
    // Po skončení partie nemá potvrzení vzdání smysl – schovej ho.
    if (s.result !== 'ongoing') {
      showConfirm(false);
    }
  }

  /**
   * Nastaví indikátor strany na tahu: viditelný jen za běhu partie
   * (`result === 'ongoing'`), barva kamene podle `turn`. Po konci partie i při
   * chybě enginu (result != ongoing → sem se dostane přes onState) se skryje.
   */
  function updateTurnIndicator(s: GameStatus): void {
    const ongoing = s.result === 'ongoing';
    turnIndicator.classList.toggle('hidden', !ongoing);
    // Barvu drž konzistentní i ve skrytém stavu, ať při dalším zobrazení
    // neproblikne stará barva. `black` = člověk, `white` = počítač.
    turnPiece.classList.toggle('black', s.turn === 'black');
    turnPiece.classList.toggle('white', s.turn === 'white');
  }

  function onState(s: GameStatus): void {
    render(s);
  }

  /**
   * Nabídne enginu remízu přes controller a podle verdiktu ukáže hlášku v
   * `offerMsg`. Po dobu rozhodování je tlačítko zamčené (`offering`). Hláška v
   * `offerMsg` žije nezávisle na řádku stavu (ten řídí polling přes onState).
   */
  async function offerDraw(): Promise<void> {
    if (offering || controller === null || lastStatus.result !== 'ongoing') {
      return;
    }
    offering = true;
    offerMsg.textContent = 'Počítač zvažuje nabídku…';
    offerMsg.classList.remove('hidden');
    refreshControls();
    let outcome: DrawOfferOutcome;
    try {
      outcome = await controller.offerDraw();
    } finally {
      offering = false;
    }
    if (outcome === 'accepted') {
      // Přijato → onState už ohlásil `draw`; řádek stavu řekne „Konec: remíza".
      offerMsg.textContent = '';
      offerMsg.classList.add('hidden');
    } else if (outcome === 'declined') {
      offerMsg.textContent = 'Počítač remízu odmítl, hrajete dál.';
    } else {
      offerMsg.textContent = 'Nabídku se teď nepodařilo vyřídit, zkuste to znovu.';
    }
    refreshControls();
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
    firstMoveMade = false; // nová partie → úroveň zas volná až do prvního tahu
    showConfirm(false);
    // Nové pozadí HNED (před await createGame), ať se přehodí okamžitě. Předchozí
    // pozadí se vyloučí (`lastBg`), ať nepadne dvakrát po sobě totéž. Prázdný
    // výčet → undefined → src='' → zůstane výchozí barevné pozadí z CSS, žádný
    // pád; `lastBg` v tom případě necháme být (nemáme čím ho přepsat).
    const nextBg = pickBackground(backgroundUrls, Math.random, lastBg);
    pageBg.src = nextBg ?? '';
    if (nextBg !== undefined) {
      lastBg = nextBg;
    }
    // Zbytek po minulé partii: schovej hlášku nabídky remízy.
    offerMsg.textContent = '';
    offerMsg.classList.add('hidden');
    // Indikátor na tahu skrýt do doby, než nový controller ohlásí stav partie
    // (chybová cesta zakládání render() nevolá – jinak by tu zůstal z minulé hry).
    turnIndicator.classList.add('hidden');
    resignBtn.disabled = true;
    newGameBtn.disabled = true;
    offerDrawBtn.disabled = true;
    levelSelect.disabled = true;
    // Úroveň se čte TEĎ, na začátku zakládání – pozdější přepnutí selectu partii
    // nezmění. `value` je vždy jedna z `<option>` (uživatel nemůže vložit jiné);
    // přetypování na GameLevel je tím kryté, server navíc neznámou úroveň odmítne.
    const level = levelSelect.value as GameLevel;
    saveLevel(level); // zapamatuj volbu na příští reload (přežije zavření stránky)
    if (controller !== null) {
      controller.dispose();
      controller = null;
    }
    boardSlot.replaceChildren();
    status.textContent = 'Načítám partii…';
    try {
      const game = await client.createGame(level);
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
      // Chyba = partie „neběží": povol Novou hru k opakování, vzdání i nabídku zamkni.
      lastStatus = { result: 'white-wins', turn: 'white', engineStatus: 'idle' };
      resignBtn.disabled = true;
      newGameBtn.disabled = false;
      offerDrawBtn.disabled = true;
      // Zakládání selhalo → povol změnu úrovně pro další pokus (refreshControls
      // se tu nevolá, tak explicitně).
      levelSelect.disabled = false;
    }
  }

  resignBtn.addEventListener('click', () => {
    // `controller !== null` zavře díru pro pre-game stav (lastStatus je 'ongoing'
    // jako výchozí, ale žádná partie neběží – bez tohohle by dispatch kliku na
    // zamčené tlačítko v testu ukázal potvrzení vzdání neexistující hry).
    if (controller !== null && lastStatus.result === 'ongoing') {
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
  offerDrawBtn.addEventListener('click', () => {
    void offerDraw();
  });
  newGameBtn.addEventListener('click', () => {
    void startNewGame();
  });

  // Přepnutí úrovně PŘED prvním tahem rovnou přehraje partii na novou úroveň:
  // žádný tah ještě nepadl, nic se neztrácí. Za běhu partie je select zamčený
  // (sem se nedostane); po konci partie se úroveň jen zvolí pro příští „Nová hra"
  // (start řeší tlačítko, ne tahle změna).
  levelSelect.addEventListener('change', () => {
    const over = lastStatus.result !== 'ongoing';
    if (!over && !firstMoveMade && !loading) {
      void startNewGame();
    }
  });

  // Automatická první hra: uživatele uvítá kompletní deska (napoprvé Profesionál),
  // ne prázdná obrazovka. Úroveň zůstává volná až do prvního tahu.
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

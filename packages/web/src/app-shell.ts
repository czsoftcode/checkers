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
import { createSoundPlayer } from './sound.js';
import type { SoundPlayer } from './sound.js';

/**
 * České popisky úrovní pro UI (interní hodnoty zůstávají anglické na drátě).
 * `Record<GameLevel, …>` vynutí popisek pro KAŽDOU úroveň – přidání úrovně do
 * `GAME_LEVELS` bez popisku sem shodí typecheck (jediný zdroj = server-client).
 */
const LEVEL_LABELS: Record<GameLevel, string> = {
  professional: 'Profesionál',
  championship: 'Mistrovství',
  intermediate: 'Pokročilý',
  beginner: 'Začátečník',
  education: 'Výuka',
};

/** Klíč v LocalStorage pro zapamatovanou volbu úrovně (přežije reload stránky). */
const LEVEL_STORAGE_KEY = 'checkers.level';

/**
 * Klíč v LocalStorage pro barvu, kterou má ČLOVĚK dostat v PŘÍŠTÍ partii. Střídá
 * se po každé dohrané partii (viz `render`), takže tady je uložená ta NÁSLEDUJÍCÍ
 * volba – ne barva aktuální partie (ta žije v `humanColor` a chodí ze serveru).
 */
const COLOR_STORAGE_KEY = 'checkers.nextColor';

/** Barva člověka (engine hraje druhou). Odvozeno z `GameDto`, ať je jeden zdroj pravdy. */
type HumanColor = NonNullable<GameDto['humanColor']>;

/** Opačná barva – engine dostane vždycky tu, kterou nehraje člověk. */
function opposite(color: HumanColor): HumanColor {
  return color === 'black' ? 'white' : 'black';
}

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

/**
 * Načte barvu pro PŘÍŠTÍ partii z LocalStorage. Výchozí `'black'` (dnešní chování,
 * člověk černý), když nic uloženo není, uložená hodnota není platná barva
 * (stará/poškozená/cizí zápis), nebo LocalStorage vůbec nejde (privátní režim).
 * Čtení NESMÍ shodit start appky – proto try/catch a validace, ne slepá důvěra
 * uloženému řetězci (jinak by nesmysl protekl jako barva do `createGame`).
 */
function loadNextColor(): HumanColor {
  try {
    const raw = localStorage.getItem(COLOR_STORAGE_KEY);
    if (raw === 'black' || raw === 'white') {
      return raw;
    }
  } catch {
    // LocalStorage nedostupný → tichý fallback na výchozí barvu.
  }
  return 'black';
}

/** Uloží barvu pro příští partii. Selhání zápisu (kvóta/privátní režim) je neškodné → spolknout. */
function saveNextColor(color: HumanColor): void {
  try {
    localStorage.setItem(COLOR_STORAGE_KEY, color);
  } catch {
    // Nejde uložit → střídání se prostě nezapamatuje přes reload, appka běží dál.
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
  /**
   * Sdílený přehrávač zvuků. Skořápka ho vlastní a předává KAŽDÉMU controlleru
   * (napříč partiemi), aby ho šlo odemknout (`unlock`) na uživatelském gestu
   * (výběr úrovně / „Nová hra") ještě než controller vůbec vznikne. To je jediná
   * cesta, jak u Mistrovství rozeznít ballot i první tah enginu, které hrají DŘÍV,
   * než se hráč dotkne desky (autoplay policy prohlížeče). Injektovatelný kvůli testu.
   */
  readonly soundPlayer?: SoundPlayer;
  /**
   * Návrat do místnosti (lobby). Když je zadán, skořápka přidá do řady ovládání
   * tlačítko „Do místnosti", které ho zavolá – přepínač obrazovek (main.ts) pak
   * skořápku disposne a vrátí lobby. Bez něj (sólo mimo místnostní tok, testy)
   * se tlačítko vůbec nevykreslí. Tlačítko je vždy aktivní: odchod je povolený i
   * uprostřed partie (sólo proti počítači nemá druhého hráče, o kterého by šlo).
   */
  readonly onExit?: () => void;
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
  // Sdílený přehrávač: jedna instance na celou appku, předávaná každému controlleru.
  // Odemyká se na gestu (viz `unlockAudio`), takže odemčení přežije i výměnu partie
  // za „Nová hra" – kdyby si player vytvářel každý controller sám, gesto by odemklo
  // jen tu instanci, co v tu chvíli neexistuje (nová partie se zakládá až po awaitu).
  const soundPlayer = options.soundPlayer ?? createSoundPlayer();

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

  // Stavový řádek pod deskou: za běhu prázdný, nese hlášku o načítání partie.
  // Výsledek a chyby jdou do modalu, ne sem. Umístí se do `.status-bar` pod deskou.
  // Startuje skrytý (prázdný) – `setStatus('')` drží `.hidden`, ať prázdný odstavec
  // ve vodorovném řádku netvoří mezeru ani falešný oddělovač před verdiktem remízy.
  const status = document.createElement('p');
  status.className = 'status hidden';

  // Výběr úrovně pro DALŠÍ novou hru. Musí vzniknout PŘED prvním `startNewGame()`
  // (na konci funkce), protože jeho hodnotu čte při zakládání partie. Výchozí je
  // Profesionál (první `<option>`). Během rozehrané partie je zamčený (mění se jen
  // když jde založit nová hra) – ať nevzniká dojem, že přepnutí mění běžící partii.
  // Bez viditelného popisku (sedí v řádku tlačítek) → přístupnost drží aria-label.
  const levelSelect = document.createElement('select');
  levelSelect.className = 'level-select';
  levelSelect.setAttribute('aria-label', 'Úroveň soupeře pro novou hru');
  // Pořadí = pořadí v `GAME_LEVELS` (Profesionál → Mistrovství → Pokročilý →
  // Začátečník → Výuka); první je výchozí. Jediný zdroj hodnot i pořadí, žádná
  // druhá kopie seznamu.
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
  // „Do místnosti" jen když je návrat zapojen (main.ts). Sedí v téže řadě jako
  // ostatní tlačítka → dědí responzivní chování (na mobilu se zalomí), na rozdíl
  // od dřívějšího fixního tlačítka v rohu, které se na úzkém displeji nevešlo.
  // Vždy aktivní (odchod je povolený i za běhu partie), proto ho refreshControls
  // nezamyká.
  const onExit = options.onExit;
  if (onExit !== undefined) {
    // Oddělovač před „Do místnosti" (stejný jako mezi úrovní a tlačítky): opticky
    // oddělí navigaci od ovládání partie. Na mobilu ho `.controls-divider` skryje.
    const exitDivider = document.createElement('span');
    exitDivider.className = 'controls-divider';
    exitDivider.setAttribute('aria-hidden', 'true');
    const exitBtn = button('btn-back-room', 'Do místnosti');
    exitBtn.addEventListener('click', () => {
      onExit();
    });
    controls.append(exitDivider, exitBtn);
  }

  // Verdikt nabídky remízy (řídí ho výhradně skořápka kolem offerDraw, NE onState –
  // proud stavů z pollingu ho tak nepřepíše). Žije ve stavovém řádku POD deskou.
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

  // Panel nad deskou nese UŽ JEN ovládání (tlačítka + přepínač) a potvrzení vzdání –
  // žádný prázdný stavový řádek nad tlačítky, ať je panel co nejnižší a deska větší.
  panel.append(controls, confirm);

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

  // Stavový řádek POD deskou: vyplní mezeru mezi deskou a spodním okrajem (CSS
  // flex: 1). Nese informace, které dřív byly nad/pod tlačítky – hlášku o načítání
  // (status) i verdikt nabídky remízy (offerMsg). Výsledek/chyba jdou do modalu.
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  statusBar.append(status, offerMsg);

  element.append(panel, boardRow, statusBar);

  // Modal s výsledkem partie / chybou: překryv přes celý viewport se zprávou a
  // tlačítkem „Zavřít". Ovládá se z `render()` (konec partie, chyba enginu) a
  // z chybové cesty zakládání partie. Startuje skrytý. Žádné inline styly (CSP) –
  // vzhled je v CSS. `role=dialog`/`aria-modal` na dialogu kvůli přístupnosti.
  const modal = document.createElement('div');
  modal.className = 'modal-overlay hidden';
  const modalDialog = document.createElement('div');
  modalDialog.className = 'modal-dialog';
  modalDialog.setAttribute('role', 'dialog');
  modalDialog.setAttribute('aria-modal', 'true');
  const modalMsg = document.createElement('p');
  modalMsg.className = 'modal-msg';
  const modalCloseBtn = button('btn-modal-close', 'Zavřít');
  modalDialog.append(modalMsg, modalCloseBtn);
  modal.append(modalDialog);
  element.append(modal);

  let controller: BoardController | null = null;
  // Poslední známý stav ze serveru – řídí stav tlačítek (result i turn a
  // engineStatus kvůli tlačítku nabídky remízy) a to, jestli je vzdání aktuální.
  let lastStatus: GameStatus = { result: 'ongoing', turn: 'black', engineStatus: 'idle' };
  // Barva člověka v AKTUÁLNÍ partii (ze serveru přes `GameDto.humanColor`). Řídí
  // mapování výsledku na výhru/prohru, „jsem na tahu" pro nabídku remízy a detekci
  // prvního tahu (výchozí stav = člověk na tahu). Výchozí `'black'` (dnešní chování)
  // do prvního `createGame`; každá nová partie ji přepíše podle vráceného DTO.
  let humanColor: HumanColor = 'black';
  // Barva, kterou má člověk dostat v PŘÍŠTÍ zakládané partii. Init z LocalStorage
  // (výchozí černý = dnešní chování). Po každé DOHRANÉ partii se překlopí (viz
  // `render`) a uloží, takže se barvy střídají hru po hře a přežije to reload.
  // Oddělená od `humanColor` schválně: `humanColor` je barva AKTUÁLNÍ partie ze
  // serveru, tohle je volba pro tu následující (posílá se do `createGame`).
  let nextColor: HumanColor = loadNextColor();
  // --- Stav zápasu „2 kola" (úroveň Mistrovství). JEN V PAMĚTI: reload ho zahodí
  // a appka založí čerstvé 1. kolo (rozhodnutí discuss – žádný LocalStorage). ---
  // `matchBallotIndex ≠ null` = je „owed" 2. kolo: PŘÍŠTÍ startNewGame má přehrát
  // tenhle vylosovaný index (stejné zahájení jako 1. kolo). Nastaví se po regulérně
  // dohraném 1. kole Mistrovství, spotřebuje ho startNewGame 2. kola.
  let matchBallotIndex: number | null = null;
  // `true`, když AKTUÁLNÍ partie je 2. kolo zápasu. Řídí: (a) že se po ní nespustí
  // 3. kolo, (b) zámek úrovně (2. kolo = člověk bílý → táhne první → firstMoveMade
  // by select neuzamkl). Reset na konci 2. kola i při zrušení zápasu.
  let playingRoundTwo = false;
  // Barva/ballot AKTUÁLNÍ partie potřebné v render() (GameStatus je nenese): jestli
  // je to Mistrovství (řídí střídání barvy i owed 2. kolo) a jaký ballot padl.
  let currentIsChampionship = false;
  let currentBallotIndex: number | null = null;
  // `true`, když aktuální partie skončila kliknutím na „Vzdávám" (ne regulérní
  // prohrou). Vzdání a prohra mají ZE SERVERU stejný výsledek, rozlišit je jde jen
  // tímhle příznakem. Vzdané 1. kolo Mistrovství zápas ZRUŠÍ (žádné 2. kolo). Reset
  // v startNewGame.
  let resignedThisGame = false;
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
  // Klíč posledního terminálního stavu, na který už modal vyskočil (výsledek partie
  // nebo 'error'). Brání opakovanému otevření při každém pollu; po zavření uživatelem
  // zůstává nastavený, takže se pro tentýž stav znovu neotevře. Nová hra ho resetuje.
  let notifiedTerminalKey: string | null = null;

  /**
   * Nastaví text stavového řádku a schová ho, když je prázdný. Skrytí (`.hidden` =
   * display:none) je nutné kvůli vodorovnému rozložení `.status-bar`: prázdný
   * odstavec by jinak zabíral mezeru a spouštěl CSS oddělovač před další hláškou.
   */
  function setStatus(text: string): void {
    status.textContent = text;
    status.classList.toggle('hidden', text === '');
  }

  /** Přepne mezi hlavními tlačítky a inline potvrzením vzdání. */
  function showConfirm(show: boolean): void {
    controls.classList.toggle('hidden', show);
    confirm.classList.toggle('hidden', !show);
  }

  /**
   * Zpráva do modalu pro terminální stav: výsledek partie (bez „Konec:" prefixu)
   * nebo chyba enginu. `null`, když se nemá nic hlásit (běžící partie).
   */
  function terminalMessage(s: GameStatus): string | null {
    // Výhra/prohra podle barvy člověka: 'black-wins' vyhrává člověk jen když hraje
    // černé, jinak vyhrál počítač (a naopak). Remíza je na barvě nezávislá.
    if (s.result === 'black-wins' || s.result === 'white-wins') {
      const humanWon = s.result === `${humanColor}-wins`;
      return humanWon ? 'Vyhráli jste.' : 'Vyhrál počítač.';
    }
    if (s.result === 'draw') {
      return 'Remíza.';
    }
    if (s.engineStatus === 'error') {
      return 'Počítač hlásí chybu, partie stojí.';
    }
    return null;
  }

  /** Klíč terminálního stavu pro latch (výsledek, nebo 'error'); `null` = neterminální. */
  function terminalKey(s: GameStatus): string | null {
    if (s.result !== 'ongoing') {
      return s.result;
    }
    return s.engineStatus === 'error' ? 'error' : null;
  }

  /** Otevře modal s danou zprávou a dá fokus na „Zavřít" (přístupnost). */
  function showModal(text: string): void {
    modalMsg.textContent = text;
    modalDialog.setAttribute('aria-label', text);
    modal.classList.remove('hidden');
    modalCloseBtn.focus();
  }

  /** Zavře modal (když je otevřený) a vrátí fokus na „Nová hra", je-li aktivní. */
  function closeModal(): void {
    if (modal.classList.contains('hidden')) {
      return;
    }
    modal.classList.add('hidden');
    if (!newGameBtn.disabled) {
      newGameBtn.focus();
    }
  }

  /**
   * Zavření modalu UŽIVATELEM (tlačítko „Zavřít" / klik na backdrop / Esc). Kromě
   * zavření spustí AUTO 2. kolo zápasu, když je „owed" (`matchBallotIndex !== null`):
   * rozhodnutí discuss – 2. kolo naskočí až po zavření výsledkového modalu 1. kola,
   * ať hráč stihne vidět výsledek. Vnitřní `closeModal` z `startNewGame` (reset) tuhle
   * cestu ZÁMĚRNĚ nevolá, aby se auto-start nespustil rekurzivně. `wasOpen` gate: když
   * byl modal už zavřený (Esc bez modalu), nic se nespustí. `loading` gate proti
   * souběhu s jiným zakládáním.
   */
  function closeModalByUser(): void {
    const wasOpen = !modal.classList.contains('hidden');
    closeModal();
    if (wasOpen && matchBallotIndex !== null && !loading) {
      unlockAudio(); // uživatelské gesto → probuď audio pro ballot 2. kola
      void startNewGame();
    }
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
    // Navíc: během celého zápasu „2 kola" Mistrovství (owed 2. kolo NEBO se právě
    // hraje 2. kolo) je úroveň zamčená na Mistrovství – jinak by šla mezi koly
    // přepnout a fixní ballotIndex mimo championship by server odmítl 400 (fáze 53).
    // Pokrývá i 2. kolo, kde je člověk bílý → táhne první → firstMoveMade sám neuzamkne.
    const matchActive = playingRoundTwo || matchBallotIndex !== null;
    levelSelect.disabled = loading || matchActive || (!over && firstMoveMade);
    // Nabídnout remízu jde jen na tahu člověka (jeho barva) a když engine
    // nepřemýšlí; ne během zakládání ani když už jedna nabídka čeká na verdikt.
    // Server to i tak ověří – tohle je jen UI, ne autorita.
    offerDrawBtn.disabled =
      over ||
      loading ||
      offering ||
      lastStatus.turn !== humanColor ||
      lastStatus.engineStatus === 'thinking';
  }

  /** Překreslí řádek stavu a nastaví tlačítka podle stavu partie. */
  function render(s: GameStatus): void {
    lastStatus = s;
    // Jakmile stav přestane být „výchozí" (člověk na tahu, engine idle, hra běží),
    // padl první tah → zamkni výběr úrovně. Latch (jen nahoru): i když se stav
    // po tahu enginu vrátí na „člověk+idle", přepínač zůstane zamčený až do konce
    // partie / nové hry. U běžných úrovní s ČLOVĚKEM ČERNÝM se sem dřív než prvním
    // tahem člověka nedostane nic než výchozí stav. Kde engine táhne PRVNÍ (Mistrovství
    // s nasazeným ballotem, nebo člověk BÍLÝ → engine černý začíná), je počáteční
    // stav rovnou „soupeř na tahu / thinking", takže se latch zamkne HNED při
    // založení – to je správně: partie už je rozehraná, úroveň se měnit nemá.
    if (s.result !== 'ongoing' || s.turn !== humanColor || s.engineStatus !== 'idle') {
      firstMoveMade = true;
    }
    // Řádek stavu už nenese výsledek ani chybu (jdou do modalu); za běhu je prázdný.
    setStatus('');
    updateTurnIndicator(s);
    // Modal na terminální stav (výsledek partie / chyba enginu) – jen při ZMĚNĚ
    // stavu, ne při každém pollu. Po zavření zůstane `notifiedTerminalKey`, takže
    // se pro tentýž stav znovu neotevře.
    const key = terminalKey(s);
    if (key === null) {
      // Návrat do neterminálního stavu (běžící partie) latch uvolní. Dnes se sem
      // po konci partie stav nevrací (výsledek je konečný, chyba enginu drží tah
      // u enginu), takže po zavření modalu k reopenu nedojde. Reset je tu ale
      // schválně, ať nespoléháme na tuhle neměnnost serveru: kdyby engine přešel
      // error → idle → error, druhá chyba by se jinak zalatchovala a spolkla.
      notifiedTerminalKey = null;
    } else if (key !== notifiedTerminalKey) {
      notifiedTerminalKey = key;
      // Gate `result !== 'ongoing'` schválně vylučuje `key === 'error'`: pád enginu
      // NENÍ dohraná partie (barvu neměníme, zápas nespouštíme). Latch (`key !==
      // notifiedTerminalKey`) zaručí přesně jedno provedení na partii – polling
      // ohlásí terminální stav vícekrát, ale sem se dostaneme jen jednou.
      if (s.result !== 'ongoing') {
        // Střídání barvy JEN u NE-Mistrovství (fáze 52): překlop `nextColor` pro
        // příští hru. Základ je barva SKUTEČNĚ odehrané partie (`humanColor` ze
        // serveru). Mistrovství má barvu FIXNÍ podle kola (1. kolo černá, 2. bílá),
        // do `nextColor` nesahá – jinak by rozhodilo paritu alternace ostatních úrovní.
        if (!currentIsChampionship) {
          nextColor = opposite(humanColor);
          saveNextColor(nextColor);
        } else if (playingRoundTwo) {
          // 2. kolo dohráno → zápas KONČÍ. Reset stavu zápasu; další partii vyvolá
          // člověk „Novou hrou" (žádné 3. kolo). Reset uvolní i zámek úrovně.
          playingRoundTwo = false;
          matchBallotIndex = null;
        } else if (resignedThisGame) {
          // 1. kolo VZDÁNO → zápas se ruší (rozhodnutí 3), žádné 2. kolo.
          matchBallotIndex = null;
        } else if (currentBallotIndex !== null) {
          // 1. kolo dohráno REGULÉRNĚ (výhra/prohra/remíza, ne vzdání) → „owed"
          // 2. kolo se stejným zahájením. Auto-start až po zavření modalu
          // (`closeModalByUser`), ať hráč stihne vidět výsledek 1. kola.
          matchBallotIndex = currentBallotIndex;
        }
      }
      const msg = terminalMessage(s);
      if (msg !== null) {
        showModal(msg);
      }
    }
    // Po skončení partie nemá potvrzení vzdání smysl – schovej ho.
    if (s.result !== 'ongoing') {
      showConfirm(false);
    }
    // Tlačítka AŽ NAKONEC: terminální větev výše mohla nastavit `matchBallotIndex`
    // (owed 2. kolo), což zamyká výběr úrovně (matchActive). Kdyby refreshControls
    // běžel dřív (před nastavením), zůstal by mezi koly za otevřeným modalem odemčený.
    refreshControls();
  }

  /**
   * Nastaví indikátor strany na tahu: viditelný jen za běhu partie
   * (`result === 'ongoing'`), barva kamene podle `turn`. Po konci partie i při
   * chybě enginu (result != ongoing → sem se dostane přes onState) se skryje.
   */
  function updateTurnIndicator(s: GameStatus): void {
    const ongoing = s.result === 'ongoing';
    turnIndicator.classList.toggle('hidden', !ongoing);
    // Kámen má barvu strany NA TAHU (ne „vždy člověk"): to je správně v obou
    // orientacích – když je na tahu člověk, svítí jeho barva, když engine, jeho.
    // Barvu drž konzistentní i ve skrytém stavu, ať při dalším zobrazení neproblikne stará.
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
   * Probudí sdílený přehrávač zvuků na uživatelském gestu (idempotentní). Volá se
   * ze synchronního těla obsluhy gesta („Nová hra" / výběr úrovně), aby odemčení
   * proběhlo v rámci user-activation okna prohlížeče (autoplay policy).
   */
  function unlockAudio(): void {
    soundPlayer.unlock();
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
    resignedThisGame = false; // nová partie → příznak vzdání z minulé neplatí
    showConfirm(false);
    // Nová partie: zavři případný modal z minulé hry a resetuj latch, ať výsledek
    // (nebo chyba) nové partie zase vyskočí.
    notifiedTerminalKey = null;
    closeModal();
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
    // Barva a případný fixní ballot pro TUHLE partii:
    // - Mistrovství: barva je FIXNÍ podle kola (NE z alternace nextColor). 2. kolo =
    //   owed přes `matchBallotIndex` → přehraj stejné zahájení, člověk bílý. 1. kolo
    //   (nový zápas) → losovaný ballot (žádný index), člověk černý = engine otevírá.
    // - Ostatní úrovně: barva z `nextColor` (alternace fáze 52), žádný ballot.
    let colorToSend: HumanColor;
    let ballotToSend: number | undefined;
    if (level === 'championship') {
      if (matchBallotIndex !== null) {
        playingRoundTwo = true;
        ballotToSend = matchBallotIndex;
        matchBallotIndex = null; // spotřebováno tímhle 2. kolem
        colorToSend = 'white';
      } else {
        playingRoundTwo = false;
        ballotToSend = undefined;
        colorToSend = 'black';
      }
    } else {
      // Ne-Mistrovství: rozehraný zápas (kdyby nějaký visel) se přepnutím úrovně
      // ruší – zámek by sem sice neměl pustit, ale stav pro jistotu vyčisti, ať
      // neuvázne owed index z minula.
      playingRoundTwo = false;
      matchBallotIndex = null;
      ballotToSend = undefined;
      colorToSend = nextColor;
    }
    if (controller !== null) {
      controller.dispose();
      controller = null;
    }
    boardSlot.replaceChildren();
    setStatus('Načítám partii…');
    try {
      // `ballotToSend` do createGame JEN když existuje (2. kolo) – ne posílat
      // spurious `undefined` třetím argumentem. Drží drát i volání čisté: 1. kolo
      // a ostatní úrovně volají stejně jako dřív (dva argumenty).
      const game =
        ballotToSend === undefined
          ? await client.createGame(level, colorToSend)
          : await client.createGame(level, colorToSend, ballotToSend);
      if (disposed) {
        return; // appka se mezitím disposla – nezakládej controller s pollingem
      }
      // Barva člověka pro tuhle partii MUSÍ být nastavená DŘÍV, než controller
      // ohlásí první stav (onState → render() čte humanColor pro latch i mapování
      // výsledku). Zdroj pravdy je server: bereme `game.humanColor`. Chybí-li v DTO,
      // je to server BEZ fáze 50 – ten pole `humanColor` v požadavku ignoruje a
      // člověka drží VŽDY černého. Fallback proto MUSÍ být `'black'` (ne poslaná
      // `nextColor`): jinak by klient orientoval desku pro bílého, zatímco server
      // hraje člověka černého → zrcadlově obrácená deska a invertované mapování
      // výhry každou druhou hru. `'black'` = korektní degradace (feature se jen
      // nestřídá), shodně s fází 51.
      humanColor = game.humanColor ?? 'black';
      // Zapamatuj pro render() (GameStatus je nenese): úroveň partie (řídí střídání
      // barvy i owed 2. kolo) a jaký ballot padl (owed 2. kolo přehraje tenhle index).
      // `?? null`: chybějící/undefined ballotIndex (drift/starý server) = „neznám" →
      // owed 2. kolo se pak nerozjede (viz gate `currentBallotIndex !== null`), místo
      // aby zápas spadl. U ne-Mistrovství je stejně null.
      currentIsChampionship = level === 'championship';
      currentBallotIndex = game.ballotIndex ?? null;
      // `loading` MUSÍ být false ještě před vytvořením controlleru: ten hned
      // ohlásí výchozí stav přes onState → render() a to čte `loading` do stavu
      // tlačítek. Kdyby tu bylo pořád true, tlačítka by zůstala zamčená.
      loading = false;
      controller = makeController(client, game, {
        onState,
        soundPlayer,
        ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      });
      boardSlot.append(controller.element);
    } catch (error) {
      loading = false;
      // Zakládání selhalo → zápas „2 kola" se nerozjel. Vyčisti jeho stav, ať po
      // selhaném 2. kole nezůstane `playingRoundTwo=true` (viselý zámek úrovně) ani
      // owed index; další „Nová hra" pak začne čistým 1. kolem, ne půlkou zápasu.
      playingRoundTwo = false;
      matchBallotIndex = null;
      console.error('Nepodařilo se založit partii:', error);
      setStatus(''); // hláška jde do modalu, ne do (mizejícího) řádku stavu
      // Umělé `white-wins` níž jen odemyká „Novou hru" – NESMÍ vyvolat výherní modal,
      // proto ho hlásíme ručně jako chybu (a `render()` se na téhle cestě nevolá).
      showModal('Partii se nepodařilo založit. Zkuste to znovu tlačítkem Nová hra.');
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
    // Označ, že tento konec přijde VZDÁNÍM (ne prohrou) – terminální handler podle
    // toho zápas Mistrovství zruší místo spuštění 2. kola. Nastav OPTIMISTICKY PŘED
    // resign(): úspěšné vzdání vyvolá terminální onState ještě UVNITŘ resign(), to
    // musí příznak vidět. Callback ho zas SUNDÁ, když vzdání NEproběhlo (síť selhala
    // → resync na ongoing, nebo partii ukončil mezitím engine) – jinak by se PŘÍŠTÍ
    // regulérní konec 1. kola omylem vyhodnotil jako vzdání a zápas by se zrušil.
    resignedThisGame = true;
    controller?.resign((didResign) => {
      if (!didResign) {
        resignedThisGame = false;
      }
    });
  });
  offerDrawBtn.addEventListener('click', () => {
    void offerDraw();
  });
  newGameBtn.addEventListener('click', () => {
    unlockAudio(); // uživatelské gesto → probuď audio (ať zní i ballot / první tah AI)
    void startNewGame();
  });

  modalCloseBtn.addEventListener('click', () => {
    closeModalByUser();
  });
  // Klik na tmavý backdrop (mimo dialog) zavře; klik dovnitř dialogu ne.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModalByUser();
    }
  });
  // Esc zavře modal, když je otevřený. Listener je na document (modal může mít fokus
  // na tlačítku Zavřít) – odhlásí se v `dispose`, ať po odstranění appky nezůstane.
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModalByUser();
    }
  };
  document.addEventListener('keydown', onKeydown);

  // Přepnutí úrovně PŘED prvním tahem rovnou přehraje partii na novou úroveň:
  // žádný tah ještě nepadl, nic se neztrácí. Za běhu partie je select zamčený
  // (sem se nedostane); po konci partie se úroveň jen zvolí pro příští „Nová hra"
  // (start řeší tlačítko, ne tahle změna).
  levelSelect.addEventListener('change', () => {
    const over = lastStatus.result !== 'ongoing';
    if (!over && !firstMoveMade && !loading) {
      // Výběr úrovně je uživatelské gesto: odemkni audio SYNCHRONNĚ (ještě v rámci
      // gesta, před await v `startNewGame`), jinak by u Mistrovství ballot a první
      // tah enginu zahrály potichu – oba běží dřív, než hráč klikne do desky.
      unlockAudio();
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
      document.removeEventListener('keydown', onKeydown);
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

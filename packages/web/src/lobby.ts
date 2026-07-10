/**
 * Úvodní obrazovka MÍSTNOSTI: hráč zadá přezdívku, připojí se přes `/room/ws`
 * (viz {@link createRoomClient}) a vidí živý seznam přítomných. Párování výzvou a
 * start partie jsou VĚDOMĚ mimo tento řez – lobby zatím jen zpřítomňuje místnost.
 *
 * Vedle vstupu do místnosti nabízí i „Hrát proti počítači" (sólo cesta proti
 * enginu), která přezdívku NEvyžaduje – přepnutí na desku řídí caller přes
 * `onPlayVsComputer` (viz `main.ts`). Odchod do sóla lobby disposne, čímž se zavře
 * i room WS (v místnosti nejsi, dokud hraješ sólo).
 *
 * Stav obrazovky (`view`): `entry` (formulář nicku), `connecting` (čekám na odpověď
 * serveru, formulář zamčený), `joined` (jsem v místnosti, vidím roster),
 * `disconnected` (spadlo spojení → „Připojit znovu"). Obsazená přezdívka / chyba
 * validace vrací do `entry` s hláškou – socket server drží, stačí poslat znovu.
 *
 * Žádné inline styly ani skripty (CSP) – vzhled je ve `styles.css`.
 *
 * Lokalizace (fáze 81): řetězce, které skládá KLIENT, jdou přes `t()` (cs/en dle
 * prohlížeče). Hlášky, které server posílá jako hotový text (`onNotice`, `onError`),
 * se NElokalizují – klient je nemá z čeho přeložit a server je autorita; zůstávají
 * v jazyce serveru (dnes česky). Náhradní přezdívka z `onNickTaken` je taky serverové
 * DATO – lokalizuje se jen věta, do které ji klient vsadí (`lobby.nickTaken`).
 */

import { t, LOCALES, isLocale, getLocale, setLocale, saveLocale } from './i18n.js';
import { createRoomClient } from './room-client.js';
import type {
  ChallengeAcceptedInfo,
  IncomingChallenge,
  OutgoingChallenge,
  RoomSocketFactory,
  RosterEntry,
} from './room-client.js';

// Celostránkové pozadí místnosti: hotový (dostatečně tmavý) obrázek `intro.webp`.
// `?url` → Vite dá při buildu hashovanou URL řetězcem (jako `board-image`); pozadí je
// FIXNÍ jeden obrázek, ne losované jako u hry (žádná logika z `backgrounds.ts`).
// Na výšku (mobil / portrait) se použije `intro_mobile.webp` – výběr řídí prohlížeč
// přes `<picture>`/`<source media>` podle ORIENTACE, ne šířky (viz níže).
import introUrl from './assets/intro.webp?url';
import introMobileUrl from './assets/intro_mobile.webp?url';

/** Klíč v LocalStorage pro zapamatovanou přezdívku (přežije reload, jako úroveň). */
const NICK_STORAGE_KEY = 'checkers.roomNick';

/**
 * Max délka přezdívky v UI. Musí sedět na serverový `NICK_MAX_LENGTH` (server je
 * autorita – delší stejně odmítne). Drží `maxLength` pole i ořez předvyplněné
 * hodnoty z LocalStorage (`maxLength` uživatelské psaní hlídá, ale programové
 * `.value` NE – bez ořezu by dřív uložená delší hodnota protekla celá).
 */
const NICK_MAX_LENGTH = 24;

/**
 * Most z herní obrazovky zpět k živému room WS (drží ho lobby). Herní obrazovka
 * NEmá vlastní room socket – tahy MUSÍ jít po témže spojení, na které je partie na
 * serveru navázaná session id (fáze 70). Lobby proto při startu partie předá tento
 * úzký most: odeslání tahu (s uzavřeným `gameId`) a registraci příjmu chyb tahu.
 */
export interface GameLink {
  /**
   * Pošle tah aktuální partie po room WS (`gameId` je uzavřený). `path` = všechna
   * dopadová pole. Vrací `true`, když tah odešel, `false`, když spojení není dostupné
   * (deska pak tah nezamkne a ohlásí, že se neodeslal).
   */
  move(from: number, path: readonly number[]): boolean;
  /**
   * Zaregistruje handler chyb tahu (odmítnutí serverem) na dobu běhu partie. Vrací
   * odregistraci – herní obrazovka ji zavolá ve svém `dispose` (návrat do místnosti).
   * Dokud je registrovaný, chyby z room WS míří sem, ne do (odpojeného) pohledu místnosti.
   */
  onError(handler: (message: string) => void): () => void;
  /** Vzdá partii (fáze 77). Vrací `true`, když příkaz odešel po room WS. */
  resign(): boolean;
  /** Nabídne remízu soupeři (fáze 77). Vrací, zda příkaz odešel. */
  offerDraw(): boolean;
  /** Přijme soupeřovu nabídku remízy (fáze 77). Vrací, zda příkaz odešel. */
  acceptDraw(): boolean;
  /** Odmítne soupeřovu nabídku remízy (fáze 77). Vrací, zda příkaz odešel. */
  rejectDraw(): boolean;
  /**
   * Zaregistruje handler „soupeř nabídl remízu" na dobu běhu partie (fáze 77). Vrací
   * odregistraci (herní obrazovka ji zavolá v `dispose`). Lobby signál filtruje na
   * gameId této partie, takže zbloudilý signál z jiné/staré partie sem nedorazí.
   */
  onDrawOffered(handler: () => void): () => void;
  /** Zaregistruje handler „soupeř odmítl mou nabídku remízy" (fáze 77). Vrací odregistraci. */
  onDrawRejected(handler: () => void): () => void;
  /**
   * Opustí DOHRANOU partii („Konec") – uvolní oba hráče z busy na serveru, ať můžou
   * hrát s někým jiným (fáze 77). Vrací, zda příkaz odešel. Následně herní obrazovka
   * přejde do místnosti přes `onBackToRoom`.
   */
  leaveGame(): boolean;
  /**
   * Nabídne soupeři ODVETU po dohrané partii (fáze 77). Nabízející ZŮSTÁVÁ na herní
   * obrazovce a čeká; soupeř dostane dotaz. Po přijetí přejdou OBA rovnou do nové
   * partie (přes `onGameStart`, prohozené barvy) – bez návratu do místnosti. Vrací,
   * zda příkaz odešel.
   */
  offerRematch(): boolean;
  /** Přijme soupeřovu nabídku odvety (fáze 77). Vrací, zda odešlo (start nové hry přijde přes onGameStart). */
  acceptRematch(): boolean;
  /** Odmítne soupeřovu nabídku odvety (fáze 77). Vrací, zda odešlo. */
  declineRematch(): boolean;
  /** Zaregistruje handler „soupeř nabídl odvetu" (fáze 77). Vrací odregistraci. Filtrováno na gameId partie. */
  onRematchOffered(handler: () => void): () => void;
  /** Zaregistruje handler „soupeř mou odvetu odmítl" (fáze 77). Vrací odregistraci. */
  onRematchDeclined(handler: () => void): () => void;
  /**
   * Zaregistruje handler „soupeř dal Konec – partie skončila pro oba" (fáze 77). Herní
   * obrazovka se na něj přesune do místnosti. Vrací odregistraci. Filtrováno na gameId.
   */
  onGameClosed(handler: () => void): () => void;
}

export interface LobbyOptions {
  /** Přepnutí na sólo hru proti počítači (dnešní deska). Řídí ho caller (`main.ts`). */
  readonly onPlayVsComputer: () => void;
  /**
   * Přijata výzva → přechod do PvP hry se svým gameId a barvou. Řídí ho caller
   * (`main.ts`), který lobby při přechodu NEzavírá (room WS musí žít – fáze 70).
   * `link` je most zpět k živému room WS (odeslání tahu + příjem chyb tahu).
   */
  readonly onGameStart: (info: ChallengeAcceptedInfo, link: GameLink) => void;
  /**
   * Uživatel přepnul jazyk v hlavičce (fáze 84). Volá se PO uložení volby do
   * LocalStorage a nastavení aktivního jazyka; caller (`main.ts`) na to znovupostaví
   * čerstvé lobby, ať se `t()` řetězce přeloží. Lobby přepínač zpřístupní jen v
   * `entry` view (uživatel ještě není v místnosti) – tam je rebuild neškodný, i kdyby
   * po `nick-taken`/`error` zůstal room WS otevřený (`dispose` ho čistě uklidí).
   */
  readonly onLocaleChange: () => void;
  /** URL WS místnosti – jen pro testy; jinak se odvodí z `location`. */
  readonly roomUrl?: string;
  /** Náhrada tovární funkce socketu – jen pro testy (fake socket). */
  readonly socketFactory?: RoomSocketFactory;
  /**
   * Itch build (fáze 89): AI-only publikace. V itch módu se místnost/room WS NIKDY
   * neotevře – „hrát s člověkem" místo formuláře přezdívky otevře modal s odkazem
   * na živou verzi. Výchozí hodnota se čte z `import.meta.env.VITE_ITCH`; parametr
   * je hlavně pro testy (vynutit itch větev bez závislosti na build módu).
   */
  readonly itchMode?: boolean;
  /**
   * Adresa živé verze pro itch modal (kam odkázat na reálné PvP). Výchozí hodnota se
   * čte z `import.meta.env.VITE_SITE_URL`; parametr je hlavně pro testy. Chybějící
   * schéma (`https://`) se doplní.
   */
  readonly siteUrl?: string;
}

/** Ovládaná obrazovka místnosti. `dispose` zavře room WS (odchod z místnosti). */
export interface Lobby {
  readonly element: HTMLElement;
  dispose(): void;
}

/** Načte zapamatovanou přezdívku (oříznutou na max délku); selhání/nedostupný LocalStorage → prázdno. */
function loadSavedNick(): string {
  try {
    return (localStorage.getItem(NICK_STORAGE_KEY) ?? '').slice(0, NICK_MAX_LENGTH);
  } catch {
    return '';
  }
}

/** Uloží přezdívku. Selhání zápisu (kvóta/privátní režim) je neškodné → spolknout. */
function saveNick(nick: string): void {
  try {
    localStorage.setItem(NICK_STORAGE_KEY, nick);
  } catch {
    // Nejde uložit → přezdívka se prostě nepředvyplní příště, appka běží dál.
  }
}

type View = 'entry' | 'connecting' | 'joined' | 'disconnected';

/** Postaví obrazovku místnosti. Vrací kořenový prvek k vložení do stránky. */
export function createLobby(options: LobbyOptions): Lobby {
  // Itch build (fáze 89): AI-only. Room WS se tu NIKDY neotevře – proto se do
  // multiplayer větve (createRoomClient a její wiring) vůbec nevstoupí a vrátí se
  // samostatný, kompaktní vstup s modalem. Výchozí přepínač z build módu, testy ho
  // umí vynutit přes `options.itchMode`.
  if (options.itchMode ?? import.meta.env.VITE_ITCH === '1') {
    return createItchEntry(options);
  }

  const element = document.createElement('div');
  element.className = 'lobby';

  // Pozadí CELÉ stránky: `<img>` na celý viewport POD obsahem (stacking řeší třída
  // `.page-bg` v styles.css: fixed, inset:0, z-index:-1, object-fit:cover). URL se
  // nastavuje přes `src`/`srcset` (atributy, ne styl) → CSP se jich netýká. Žádný
  // ztmavovací overlay – obrázek je dost tmavý a karta místnosti má vlastní tmavé pozadí.
  //
  // `<picture>` vybírá variantu podle ORIENTACE (ne šířky): na výšku `intro_mobile.webp`,
  // jinak fallback `<img>` s `intro.webp`. Rozhoduje prohlížeč přes `<source media>`,
  // takže se přepne živě i při otočení telefonu – bez JS, `matchMedia` ani listenerů.
  // `<source>` MUSÍ být před `<img>`, jinak ho prohlížeč ignoruje.
  const picture = document.createElement('picture');
  const mobileSource = document.createElement('source');
  mobileSource.media = '(orientation: portrait)';
  mobileSource.srcset = introMobileUrl;
  const pageBg = document.createElement('img');
  pageBg.className = 'page-bg';
  pageBg.alt = '';
  pageBg.src = introUrl;
  picture.append(mobileSource, pageBg);
  element.append(picture);

  const card = document.createElement('div');
  card.className = 'lobby-card';

  // Hlavička: nadpis místnosti + ruční přepínač jazyka (fáze 84) vedle sebe.
  const header = document.createElement('div');
  header.className = 'lobby-header';

  const heading = document.createElement('h1');
  heading.className = 'lobby-title';
  heading.textContent = t('lobby.title');

  // Přepínač jazyka: `<select>` generovaný z LOCALES (jediný zdroj pravdy) – přidání
  // jazyka nevyžaduje zásah sem. Aktuální jazyk je předvybraný, popisky jsou ENDONYMY
  // (jazyk sám v sobě). Změna: ulož volbu do LocalStorage, přepni aktivní jazyk a nech
  // caller znovupostavit lobby (`onLocaleChange`), ať se `t()` řetězce přeloží.
  //
  // Přepínač je zpřístupněný JEN v `entry` view (mimo něj ho `setView` skrývá): v
  // `entry` uživatel JEŠTĚ NENÍ v místnosti (žádný roster ani partie k ztrátě), takže
  // rebuild je neškodný – i kdyby po `nick-taken`/`error` zůstal room WS otevřený,
  // `dispose()` ho čistě zavře a nový se otevře líně až při dalším `join()`. V
  // `joined`/`disconnected` by naopak rebuild hráče vyhodil z rozjeté místnosti.
  const langSelect = document.createElement('select');
  langSelect.className = 'lobby-lang';
  langSelect.setAttribute('aria-label', t('lobby.langAria'));
  const activeLocale = getLocale();
  for (const { locale, label } of LOCALES) {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = label;
    option.selected = locale === activeLocale;
    langSelect.append(option);
  }
  langSelect.addEventListener('change', () => {
    const chosen = langSelect.value;
    // Hodnoty `<option>` pocházejí z LOCALES; guard je pojistka proti cizímu zásahu do
    // DOM a zároveň zúží `string` na `Locale` pro `saveLocale`/`setLocale`.
    if (!isLocale(chosen) || chosen === getLocale()) {
      return;
    }
    // Rebuild postaví čerstvé lobby a přezdívku vezme z `loadSavedNick()`. Ulož proto
    // i ROZEPSANOU (neodeslanou) přezdívku, ať ji přepnutí jazyka nesmázne – jinak by
    // se pole po rebuildu vrátilo jen na poslední ODESLANou hodnotu (fáze 84).
    saveNick(nickInput.value.trim());
    saveLocale(chosen);
    setLocale(chosen);
    options.onLocaleChange();
  });

  header.append(heading, langSelect);

  // Formulář přezdívky (`entry`/`connecting`). Submit = vstup do místnosti.
  const form = document.createElement('form');
  form.className = 'lobby-join';
  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.className = 'lobby-nick';
  nickInput.setAttribute('aria-label', t('lobby.nickAria'));
  nickInput.placeholder = t('lobby.nickPlaceholder');
  nickInput.maxLength = NICK_MAX_LENGTH;
  nickInput.value = loadSavedNick();
  const joinBtn = document.createElement('button');
  joinBtn.type = 'submit';
  joinBtn.className = 'lobby-join-btn';
  joinBtn.textContent = t('lobby.joinBtn');
  form.append(nickInput, joinBtn);

  // Hláška: stav připojování, obsazená přezdívka (návrh), chyba validace ze serveru.
  const message = document.createElement('p');
  message.className = 'lobby-msg hidden';

  // Pohled místnosti (`joined`): stav výzev + seznam přítomných.
  const room = document.createElement('div');
  room.className = 'lobby-room hidden';

  // Stav MÉ odchozí výzvy (čekám na odpověď) – skrytý, když žádná neběží.
  const outgoing = document.createElement('p');
  outgoing.className = 'lobby-outgoing hidden';

  // Neutrální provozní hláška k výzvám (soupeř odmítl / odešel) – ne chyba.
  const notice = document.createElement('p');
  notice.className = 'lobby-notice hidden';

  // Příchozí výzvy (může jich čekat víc naráz), každá s Přijmout/Odmítnout.
  const incomingList = document.createElement('ul');
  incomingList.className = 'lobby-challenges';

  const roomHeading = document.createElement('h2');
  roomHeading.className = 'lobby-room-title';
  roomHeading.textContent = t('lobby.rosterTitle');
  const rosterList = document.createElement('ul');
  rosterList.className = 'lobby-roster';
  room.append(outgoing, notice, incomingList, roomHeading, rosterList);

  // Pohled odpojení (`disconnected`): hláška + ruční znovupřipojení (žádný auto-reconnect).
  const disconnected = document.createElement('div');
  disconnected.className = 'lobby-disconnected hidden';
  const disconnectedMsg = document.createElement('p');
  const reconnectBtn = document.createElement('button');
  reconnectBtn.type = 'button';
  reconnectBtn.className = 'lobby-reconnect-btn';
  reconnectBtn.textContent = t('lobby.reconnectBtn');
  disconnected.append(disconnectedMsg, reconnectBtn);

  // Sólo cesta (proti počítači) – nezávislá na místnosti, bez přezdívky.
  const soloBtn = document.createElement('button');
  soloBtn.type = 'button';
  soloBtn.className = 'lobby-solo-btn';
  soloBtn.textContent = t('lobby.soloBtn');

  card.append(header, form, message, room, disconnected, soloBtn);
  element.append(card);

  // Přezdívka posledního úspěšného/pokusného vstupu – pro „Připojit znovu".
  let lastNick = '';
  // `true`, jakmile jsme se aspoň jednou dostali do místnosti. Rozlišuje hlášku
  // odpojení: pád PŘED vstupem = „nepodařilo se připojit" (server dole / timeout),
  // pád PO vstupu = „spojení se přerušilo".
  let joinedOnce = false;
  // Poslední roster – držíme ho, ať jde překreslit tlačítka „Vyzvat" (jejich
  // disabled stav) při změně odchozí výzvy, aniž přijde nový roster ze serveru.
  let currentRoster: RosterEntry[] = [];
  // `true`, dokud čeká MOJE odchozí výzva – tehdy nejdou vyzývat další (max-1).
  let outgoingPending = false;
  // Aktuální pohled – rozhoduje, kam mířit serverovou chybu: PŘED vstupem na formulář
  // nicku, PO vstupu (`joined`) jen jako hláška (viz `onError`).
  let currentView: View = 'entry';
  // Handler chyb tahu za běhu PvP partie (registruje ho herní obrazovka přes `GameLink`).
  // Když je nastavený, chyby z room WS jdou do hry, ne do (odpojeného) pohledu místnosti.
  // `null` mimo partii → chyby řeší běžná cesta lobby (notice / formulář nicku).
  let activeGameErrorHandler: ((message: string) => void) | null = null;
  // Signály nabídky remízy za běhu PvP partie (fáze 77). Lobby je routuje herní
  // obrazovce, ale JEN pro partii, kterou hráč právě hraje (`activeGameId`) – zbloudilý
  // signál ze staré partie tak nespustí UI nové. `null` mimo partii.
  let activeGameId: string | null = null;
  let activeDrawOfferedHandler: (() => void) | null = null;
  let activeDrawRejectedHandler: (() => void) | null = null;
  let activeRematchOfferedHandler: (() => void) | null = null;
  let activeRematchDeclinedHandler: (() => void) | null = null;
  let activeGameClosedHandler: (() => void) | null = null;

  const room_client = createRoomClient(
    {
      onJoined: (roster) => {
        joinedOnce = true;
        setView('joined');
        renderRoster(roster);
      },
      onRoster: (roster) => {
        renderRoster(roster);
      },
      onIncomingChallenges: (challenges) => {
        renderIncoming(challenges);
      },
      onOutgoingChallenge: (pending) => {
        renderOutgoing(pending);
      },
      onChallengeAccepted: (info) => {
        // Most zpět k živému room WS pro herní obrazovku. `move`/`resign`/remízové
        // příkazy uzavírají `gameId` této partie; `onError` směruje chyby (odmítnutý
        // tah i odmítnutý příkaz remízy) do hry, dokud je registrovaný.
        activeGameId = info.gameId;
        const link: GameLink = {
          move: (from, path) => room_client.move(info.gameId, from, path),
          onError: (handler) => {
            activeGameErrorHandler = handler;
            return () => {
              // Odregistruj JEN sebe – kdyby mezitím naskočila jiná partie, její
              // handler nechceme shodit (v tomto řezu nenastane, ale je to bezpečné).
              if (activeGameErrorHandler === handler) {
                activeGameErrorHandler = null;
              }
            };
          },
          resign: () => room_client.resign(info.gameId),
          offerDraw: () => room_client.offerDraw(info.gameId),
          acceptDraw: () => room_client.acceptDraw(info.gameId),
          rejectDraw: () => room_client.rejectDraw(info.gameId),
          onDrawOffered: (handler) => {
            activeDrawOfferedHandler = handler;
            return () => {
              if (activeDrawOfferedHandler === handler) {
                activeDrawOfferedHandler = null;
              }
            };
          },
          onDrawRejected: (handler) => {
            activeDrawRejectedHandler = handler;
            return () => {
              if (activeDrawRejectedHandler === handler) {
                activeDrawRejectedHandler = null;
              }
            };
          },
          leaveGame: () => room_client.leaveGame(info.gameId),
          offerRematch: () => room_client.offerRematch(info.gameId),
          acceptRematch: () => room_client.acceptRematch(info.gameId),
          declineRematch: () => room_client.declineRematch(info.gameId),
          onRematchOffered: (handler) => {
            activeRematchOfferedHandler = handler;
            return () => {
              if (activeRematchOfferedHandler === handler) {
                activeRematchOfferedHandler = null;
              }
            };
          },
          onRematchDeclined: (handler) => {
            activeRematchDeclinedHandler = handler;
            return () => {
              if (activeRematchDeclinedHandler === handler) {
                activeRematchDeclinedHandler = null;
              }
            };
          },
          onGameClosed: (handler) => {
            activeGameClosedHandler = handler;
            return () => {
              if (activeGameClosedHandler === handler) {
                activeGameClosedHandler = null;
              }
            };
          },
        };
        options.onGameStart(info, link);
      },
      onDrawOffered: (gameId) => {
        // Soupeř nabídl remízu. Routuj JEN když jde o partii, kterou právě hraju
        // (jinak zbloudilý/opožděný signál ze staré partie) a jen když hra poslouchá.
        if (gameId === activeGameId) {
          activeDrawOfferedHandler?.();
        }
      },
      onDrawRejected: (gameId) => {
        if (gameId === activeGameId) {
          activeDrawRejectedHandler?.();
        }
      },
      onRematchOffered: (gameId) => {
        if (gameId === activeGameId) {
          activeRematchOfferedHandler?.();
        }
      },
      onRematchDeclined: (gameId) => {
        if (gameId === activeGameId) {
          activeRematchDeclinedHandler?.();
        }
      },
      onGameClosed: (gameId) => {
        if (gameId === activeGameId) {
          activeGameClosedHandler?.();
        }
      },
      onNotice: (text) => {
        showNotice(text);
      },
      onNickTaken: (suggestion) => {
        setView('entry');
        nickInput.value = suggestion;
        // Náhradní přezdívku (`suggestion`) posílá server jako DATA; klient jen
        // skládá okolní hlášku – ta se lokalizuje, `suggestion` se dosadí doslova.
        setMessage(t('lobby.nickTaken', { suggestion }));
        nickInput.focus();
        nickInput.select();
      },
      onError: (text) => {
        // Za běhu PvP partie je chyba z room WS odmítnutá herní operace – tah, vzdání
        // nebo příkaz remízy (roster ani výzvy se z herní obrazovky neposílají). Doruč ji
        // herní obrazovce; pohled místnosti je mezitím odpojený z DOM, notice by nikdo neviděl.
        if (activeGameErrorHandler !== null) {
          activeGameErrorHandler(text);
          return;
        }
        // Server posílá `error` i pro CHYBY VÝZEV (vyzvaný už hraje, dvojitá/křížová
        // výzva, „výzva už neplatí"). Když už jsem v místnosti, NEvyhazuj na formulář
        // nicku (re-join by byl no-op → zásek na „Připojuji…") – ukaž jen hlášku a
        // zůstaň v pohledu místnosti. Formulář je jen pro chyby PŘED vstupem (nick).
        if (currentView === 'joined') {
          showNotice(text);
          return;
        }
        setView('entry');
        setMessage(text);
        nickInput.focus();
      },
      onDisconnected: () => {
        disconnectedMsg.textContent = joinedOnce
          ? t('lobby.disconnectedAfter')
          : t('lobby.disconnectedBefore');
        setView('disconnected');
      },
    },
    {
      ...(options.roomUrl === undefined ? {} : { url: options.roomUrl }),
      ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
    },
  );

  /** Nastaví text hlášky a skryje ji, když je prázdná. */
  function setMessage(text: string): void {
    message.textContent = text;
    message.classList.toggle('hidden', text === '');
  }

  /** Přepne viditelné sekce a stav formuláře podle stavu obrazovky. */
  function setView(view: View): void {
    currentView = view;
    const showForm = view === 'entry' || view === 'connecting';
    form.classList.toggle('hidden', !showForm);
    room.classList.toggle('hidden', view !== 'joined');
    disconnected.classList.toggle('hidden', view !== 'disconnected');
    // Přepínač jazyka jen v `entry`: mimo něj (connecting/joined/disconnected) žije
    // room WS a jeho rebuild přes `onLocaleChange` by spojení zavřel (fáze 84).
    langSelect.classList.toggle('hidden', view !== 'entry');
    const connecting = view === 'connecting';
    nickInput.disabled = connecting;
    joinBtn.disabled = connecting;
    if (connecting) {
      setMessage(t('lobby.connecting'));
      // Nový pokus o vstup: zahoď stav výzev z předchozího (padlého) spojení –
      // room-client ho interně taky vyčistil, ale prázdné seznamy sám neposílá.
      renderIncoming([]);
      renderOutgoing(null);
      showNotice('');
    } else if (view === 'joined' || view === 'disconnected') {
      setMessage('');
    }
    // `entry` hlášku nemaže – nese případný důvod (obsazený nick / chyba validace).
  }

  /**
   * Vykreslí seznam přítomných. Vlastní záznam zvýrazní a označí „(ty)"; u cizích
   * přidá tlačítko „Vyzvat" (klik → výzva). Tlačítka jsou zamčená, dokud čeká moje
   * odchozí výzva (max-1) – tehdy nejdřív dořeš tu stávající.
   */
  function renderRoster(roster: RosterEntry[]): void {
    currentRoster = roster;
    const items = roster.map((entry) => {
      const li = document.createElement('li');
      li.className = 'lobby-roster-item';
      const name = document.createElement('span');
      name.className = 'lobby-roster-name';
      name.textContent = entry.nick;
      li.append(name);
      if (entry.isSelf) {
        li.classList.add('is-self');
        const you = document.createElement('span');
        you.className = 'lobby-you';
        you.textContent = t('lobby.you');
        name.append(you);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lobby-challenge-btn';
        btn.textContent = t('lobby.challengeBtn');
        btn.disabled = outgoingPending;
        btn.addEventListener('click', () => {
          room_client.challenge(entry.id);
        });
        li.append(btn);
      }
      return li;
    });
    rosterList.replaceChildren(...items);
  }

  /** Vykreslí příchozí výzvy; každá má tlačítka Přijmout/Odmítnout na svoje id. */
  function renderIncoming(challenges: IncomingChallenge[]): void {
    const items = challenges.map((c) => {
      const li = document.createElement('li');
      li.className = 'lobby-challenge-item';
      const label = document.createElement('span');
      label.className = 'lobby-challenge-label';
      label.textContent = t('lobby.challengeFrom', { nick: c.challengerNick });
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'lobby-accept-btn';
      accept.textContent = t('lobby.acceptBtn');
      accept.addEventListener('click', () => {
        room_client.accept(c.id);
      });
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'lobby-reject-btn';
      reject.textContent = t('lobby.rejectBtn');
      reject.addEventListener('click', () => {
        room_client.reject(c.id);
      });
      li.append(label, accept, reject);
      return li;
    });
    incomingList.replaceChildren(...items);
  }

  /** Ukáže/skryje stav odchozí výzvy a přepočítá zámek tlačítek „Vyzvat". */
  function renderOutgoing(pending: OutgoingChallenge | null): void {
    outgoingPending = pending !== null;
    outgoing.textContent = pending === null ? '' : t('lobby.waitingFor', { nick: pending.targetNick });
    outgoing.classList.toggle('hidden', pending === null);
    // Překresli roster, ať se u tlačítek „Vyzvat" projeví nový disabled stav.
    renderRoster(currentRoster);
  }

  /** Krátká neutrální hláška k výzvám (odmítnutí / odchod soupeře); prázdná ji skryje. */
  function showNotice(text: string): void {
    notice.textContent = text;
    notice.classList.toggle('hidden', text === '');
  }

  /** Odešle vstup do místnosti s aktuální přezdívkou (prázdnou odmítne už klient). */
  function submitJoin(): void {
    const nick = nickInput.value.trim();
    if (nick === '') {
      setView('entry');
      setMessage(t('lobby.enterNick'));
      nickInput.focus();
      return;
    }
    lastNick = nick;
    saveNick(nick);
    setView('connecting');
    room_client.join(nick);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault(); // formulář neposílat HTTP requestem, řešíme přes WS
    submitJoin();
  });
  reconnectBtn.addEventListener('click', () => {
    setView('connecting');
    room_client.join(lastNick);
  });
  soloBtn.addEventListener('click', () => {
    options.onPlayVsComputer();
  });

  setView('entry');

  return {
    element,
    dispose: () => {
      room_client.dispose();
    },
  };
}

/**
 * Doplní chybějící schéma k adrese živé verze: „dama.softcode.cz" → „https://dama.softcode.cz".
 * Adresu už se schématem nechá být. Prázdnou (nenastavená env) vrátí prázdnou – volající
 * pak odkaz vůbec nevykreslí (raději žádný než mrtvý `#`).
 */
function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Vstupní obrazovka ITCH buildu (fáze 89): AI-only. Vypadá jako lobby (stejné pozadí,
 * karta, nadpis, přepínač jazyka, „hrát proti počítači"), ale MÍSTO formuláře přezdívky
 * má tlačítko „hrát s člověkem", které otevře modal s odkazem na živou verzi. Room WS se
 * tu NIKDY neotevře – `createRoomClient` se vůbec nevolá, takže na itch nevznikne žádné
 * spojení do (mrtvého) serveru. `dispose` proto jen odvěsí posluchač Esc; žádný socket.
 */
function createItchEntry(options: LobbyOptions): Lobby {
  const siteUrl = normalizeSiteUrl(options.siteUrl ?? import.meta.env.VITE_SITE_URL ?? '');

  const element = document.createElement('div');
  element.className = 'lobby';

  // Stejné celostránkové pozadí jako v místnosti (viz `createLobby`): `<picture>` volí
  // variantu podle orientace, `<source>` musí být před `<img>`.
  const picture = document.createElement('picture');
  const mobileSource = document.createElement('source');
  mobileSource.media = '(orientation: portrait)';
  mobileSource.srcset = introMobileUrl;
  const pageBg = document.createElement('img');
  pageBg.className = 'page-bg';
  pageBg.alt = '';
  pageBg.src = introUrl;
  picture.append(mobileSource, pageBg);
  element.append(picture);

  const card = document.createElement('div');
  card.className = 'lobby-card';

  // Hlavička: nadpis + přepínač jazyka (jako v místnosti). Na itch je tu jediný pohled
  // (bez WS), takže přepínač je vždy dostupný – rebuild přes `onLocaleChange` je neškodný.
  const header = document.createElement('div');
  header.className = 'lobby-header';
  const heading = document.createElement('h1');
  heading.className = 'lobby-title';
  heading.textContent = t('lobby.title');

  const langSelect = document.createElement('select');
  langSelect.className = 'lobby-lang';
  langSelect.setAttribute('aria-label', t('lobby.langAria'));
  const activeLocale = getLocale();
  for (const { locale, label } of LOCALES) {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = label;
    option.selected = locale === activeLocale;
    langSelect.append(option);
  }
  langSelect.addEventListener('change', () => {
    const chosen = langSelect.value;
    if (!isLocale(chosen) || chosen === getLocale()) {
      return;
    }
    saveLocale(chosen);
    setLocale(chosen);
    options.onLocaleChange();
  });
  header.append(heading, langSelect);

  // „Hrát s člověkem": na itch NEotevírá místnost, jen modal s odkazem ven.
  const humanBtn = document.createElement('button');
  humanBtn.type = 'button';
  humanBtn.className = 'lobby-human-btn';
  humanBtn.textContent = t('itch.humanBtn');

  // Sólo cesta (proti počítači) – shodná s místností: řídí ji caller přes `onPlayVsComputer`.
  const soloBtn = document.createElement('button');
  soloBtn.type = 'button';
  soloBtn.className = 'lobby-solo-btn';
  soloBtn.textContent = t('lobby.soloBtn');

  card.append(header, humanBtn, soloBtn);
  element.append(card);

  // Modal (skrytý). Znovupoužívá CSP-bezpečné třídy `.modal-overlay`/`.modal-dialog`
  // (jako modaly u hry – žádné inline styly). Zavírá se křížkem, klikem na pozadí i Esc.
  const modal = document.createElement('div');
  modal.className = 'modal-overlay hidden';
  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', t('itch.modalAria'));
  const title = document.createElement('h2');
  title.className = 'modal-msg';
  title.textContent = t('itch.modalTitle');
  const msg = document.createElement('p');
  msg.className = 'modal-notice';
  msg.textContent = t('itch.modalMsg');
  dialog.append(title, msg);

  // Odkaz ven na živou verzi. Vykreslí se JEN když je URL nastavená (jinak by byl mrtvý
  // `#`); při nenastavené env se místo něj jen zaloguje varování. `rel=noopener` kvůli
  // bezpečnosti u `target=_blank`.
  if (siteUrl !== '') {
    const link = document.createElement('a');
    link.className = 'modal-link';
    link.href = siteUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t('itch.modalLink');
    dialog.append(link);
  } else {
    console.warn('[itch] VITE_SITE_URL není nastavená – modal „hrát s člověkem" je bez odkazu.');
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close-btn';
  closeBtn.textContent = t('itch.close');
  dialog.append(closeBtn);
  modal.append(dialog);
  element.append(modal);

  function openModal(): void {
    modal.classList.remove('hidden');
    document.addEventListener('keydown', onKeydown);
    closeBtn.focus();
  }
  function closeModal(): void {
    modal.classList.add('hidden');
    document.removeEventListener('keydown', onKeydown);
    humanBtn.focus();
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      closeModal();
    }
  }

  humanBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  // Klik na ztmavené pozadí (ne na dialog) zavře modal.
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
  soloBtn.addEventListener('click', () => {
    options.onPlayVsComputer();
  });

  return {
    element,
    dispose: () => {
      // Žádný room WS k zavření (na itch nevznikl). Uklidit jen globální Esc listener,
      // kdyby se lobby disposlo s otevřeným modalem (rebuild při přepnutí jazyka).
      document.removeEventListener('keydown', onKeydown);
    },
  };
}

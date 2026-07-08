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
 */

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
import introUrl from './assets/intro.webp?url';

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
  /** URL WS místnosti – jen pro testy; jinak se odvodí z `location`. */
  readonly roomUrl?: string;
  /** Náhrada tovární funkce socketu – jen pro testy (fake socket). */
  readonly socketFactory?: RoomSocketFactory;
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
  const element = document.createElement('div');
  element.className = 'lobby';

  // Pozadí CELÉ stránky: `<img>` na celý viewport POD obsahem (stacking řeší třída
  // `.page-bg` v styles.css: fixed, inset:0, z-index:-1, object-fit:cover). URL se
  // nastavuje přes `src` (atribut, ne styl) → CSP se ho netýká. Žádný ztmavovací
  // overlay – obrázek je dost tmavý a karta místnosti má vlastní tmavé pozadí.
  const pageBg = document.createElement('img');
  pageBg.className = 'page-bg';
  pageBg.alt = '';
  pageBg.src = introUrl;
  element.append(pageBg);

  const card = document.createElement('div');
  card.className = 'lobby-card';

  const heading = document.createElement('h1');
  heading.className = 'lobby-title';
  heading.textContent = 'Herní místnost';

  // Formulář přezdívky (`entry`/`connecting`). Submit = vstup do místnosti.
  const form = document.createElement('form');
  form.className = 'lobby-join';
  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.className = 'lobby-nick';
  nickInput.setAttribute('aria-label', 'Přezdívka');
  nickInput.placeholder = 'Tvoje přezdívka';
  nickInput.maxLength = NICK_MAX_LENGTH;
  nickInput.value = loadSavedNick();
  const joinBtn = document.createElement('button');
  joinBtn.type = 'submit';
  joinBtn.className = 'lobby-join-btn';
  joinBtn.textContent = 'Vstoupit do místnosti';
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
  roomHeading.textContent = 'Přítomní hráči';
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
  reconnectBtn.textContent = 'Připojit znovu';
  disconnected.append(disconnectedMsg, reconnectBtn);

  // Sólo cesta (proti počítači) – nezávislá na místnosti, bez přezdívky.
  const soloBtn = document.createElement('button');
  soloBtn.type = 'button';
  soloBtn.className = 'lobby-solo-btn';
  soloBtn.textContent = 'Hrát proti počítači';

  card.append(heading, form, message, room, disconnected, soloBtn);
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
        // Most zpět k živému room WS pro herní obrazovku. `move` uzavírá `gameId`
        // této partie; `onError` směruje chyby tahu do hry, dokud je registrovaný.
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
        };
        options.onGameStart(info, link);
      },
      onNotice: (text) => {
        showNotice(text);
      },
      onNickTaken: (suggestion) => {
        setView('entry');
        nickInput.value = suggestion;
        setMessage(`Přezdívka je obsazená. Zkus třeba „${suggestion}".`);
        nickInput.focus();
        nickInput.select();
      },
      onError: (text) => {
        // Za běhu PvP partie je chyba z room WS odmítnutý tah (jediná odchozí operace
        // ve hře je `move` – roster ani výzvy se z herní obrazovky neposílají). Doruč ji
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
          ? 'Spojení s místností se přerušilo.'
          : 'K místnosti se nepodařilo připojit (server neodpovídá).';
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
    const connecting = view === 'connecting';
    nickInput.disabled = connecting;
    joinBtn.disabled = connecting;
    if (connecting) {
      setMessage('Připojuji do místnosti…');
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
        you.textContent = ' (ty)';
        name.append(you);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lobby-challenge-btn';
        btn.textContent = 'Vyzvat';
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
      label.textContent = `${c.challengerNick} tě vyzývá na partii`;
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'lobby-accept-btn';
      accept.textContent = 'Přijmout';
      accept.addEventListener('click', () => {
        room_client.accept(c.id);
      });
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'lobby-reject-btn';
      reject.textContent = 'Odmítnout';
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
    outgoing.textContent = pending === null ? '' : `Čekám na odpověď: ${pending.targetNick}…`;
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
      setMessage('Zadej přezdívku.');
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

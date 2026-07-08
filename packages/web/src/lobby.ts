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
import type { RoomSocketFactory, RosterEntry } from './room-client.js';

/** Klíč v LocalStorage pro zapamatovanou přezdívku (přežije reload, jako úroveň). */
const NICK_STORAGE_KEY = 'checkers.roomNick';

/**
 * Max délka přezdívky v UI. Musí sedět na serverový `NICK_MAX_LENGTH` (server je
 * autorita – delší stejně odmítne). Drží `maxLength` pole i ořez předvyplněné
 * hodnoty z LocalStorage (`maxLength` uživatelské psaní hlídá, ale programové
 * `.value` NE – bez ořezu by dřív uložená delší hodnota protekla celá).
 */
const NICK_MAX_LENGTH = 24;

export interface LobbyOptions {
  /** Přepnutí na sólo hru proti počítači (dnešní deska). Řídí ho caller (`main.ts`). */
  readonly onPlayVsComputer: () => void;
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

  // Pohled místnosti (`joined`): nadpis + seznam přítomných.
  const room = document.createElement('div');
  room.className = 'lobby-room hidden';
  const roomHeading = document.createElement('h2');
  roomHeading.className = 'lobby-room-title';
  roomHeading.textContent = 'Přítomní hráči';
  const rosterList = document.createElement('ul');
  rosterList.className = 'lobby-roster';
  room.append(roomHeading, rosterList);

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
      onNickTaken: (suggestion) => {
        setView('entry');
        nickInput.value = suggestion;
        setMessage(`Přezdívka je obsazená. Zkus třeba „${suggestion}".`);
        nickInput.focus();
        nickInput.select();
      },
      onError: (text) => {
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
    const showForm = view === 'entry' || view === 'connecting';
    form.classList.toggle('hidden', !showForm);
    room.classList.toggle('hidden', view !== 'joined');
    disconnected.classList.toggle('hidden', view !== 'disconnected');
    const connecting = view === 'connecting';
    nickInput.disabled = connecting;
    joinBtn.disabled = connecting;
    if (connecting) {
      setMessage('Připojuji do místnosti…');
    } else if (view === 'joined' || view === 'disconnected') {
      setMessage('');
    }
    // `entry` hlášku nemaže – nese případný důvod (obsazený nick / chyba validace).
  }

  /** Vykreslí seznam přítomných; vlastní záznam zvýrazní a označí „(ty)". */
  function renderRoster(roster: RosterEntry[]): void {
    const items = roster.map((entry) => {
      const li = document.createElement('li');
      li.className = 'lobby-roster-item';
      li.textContent = entry.nick;
      if (entry.isSelf) {
        li.classList.add('is-self');
        const you = document.createElement('span');
        you.className = 'lobby-you';
        you.textContent = ' (ty)';
        li.append(you);
      }
      return li;
    });
    rosterList.replaceChildren(...items);
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

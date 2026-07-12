/**
 * Úvodní obrazovka MÍSTNOSTI (form-first, fáze 106): hráč zadá přezdívku a PŘIPOJÍ
 * se do PŘEDSÍNĚ přes `/room/ws` (`connect{nick}`, viz {@link createRoomClient}).
 * Po připojení vidí ŽIVÝ akordeon 4 varianta-lobby s obsazeností a teprve pak
 * vstoupí do konkrétní přes „Vstoupit" (`enter{variant}` z předsíně / `switch-lobby`
 * mezi lobby). Vstupní formulář a akordeon jsou JEDNA obrazovka: formulář nahoře, po
 * připojení nahrazený labelem „Jsi tu jako X" + Odpojit, akordeon pod tím.
 *
 * Vedle vstupu do místnosti nabízí i „Hrát proti počítači" (sólo cesta proti
 * enginu), která přezdívku NEvyžaduje – přepnutí na desku řídí caller přes
 * `onPlayVsComputer` (viz `main.ts`). Odchod do sóla lobby disposne, čímž se zavře
 * i room WS (v místnosti nejsi, dokud hraješ sólo).
 *
 * Stav obrazovky (`view`): `entry` (formulář nicku + přepínač jazyka), `connecting`
 * (čekám na odpověď serveru, formulář zamčený), `connected` (jsem PŘIPOJEN – předsíň
 * i členství, vidím akordeon), `disconnected` (spadlo spojení → „Připojit znovu").
 * Obsazená přezdívka / chyba validace vrací do `entry` s hláškou – socket server
 * drží, stačí poslat znovu. Příchozí výzva se ukáže jako MODAL (ne řádek v seznamu).
 *
 * Žádné inline styly ani skripty (CSP) – vzhled je ve `styles.css`.
 *
 * Lokalizace (fáze 81): řetězce, které skládá KLIENT, jdou přes `t()` (cs/en dle
 * prohlížeče). Hlášky, které server posílá jako hotový text (`onNotice`, `onError`),
 * se NElokalizují – klient je nemá z čeho přeložit a server je autorita; zůstávají
 * v jazyce serveru (dnes česky). Náhradní přezdívka z `onNickTaken` je taky serverové
 * DATO – lokalizuje se jen věta, do které ji klient vsadí (`lobby.nickTaken`).
 */

import { t, LOCALES, isLocale, getLocale, setLocale, saveLocale, variantLabel } from './i18n.js';
import { VARIANT_IDS, isVariantId } from '@checkers/rules';
import type { VariantId } from '@checkers/rules';
import { createRoomClient } from './room-client.js';
import type {
  ChallengeAcceptedInfo,
  IncomingChallenge,
  LobbyView,
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

/** Klíč v LocalStorage pro zapamatovanou volbu varianty sólo hry (fáze 102). */
const VARIANT_STORAGE_KEY = 'checkers.variant';

/**
 * Načte zapamatovanou variantu z LocalStorage. Výchozí `'american'` (vize projektu),
 * když nic uloženo není, hodnota není známé id (`isVariantId` ji odmítne – stará/cizí),
 * nebo úložiště není dostupné (privátní režim). Slepě nedůvěřuje obsahu úložiště, ať se
 * do hry nedostane neznámá varianta, na které by `rulesetForVariant` spadl.
 */
function loadSavedVariant(): VariantId {
  try {
    const raw = localStorage.getItem(VARIANT_STORAGE_KEY);
    if (raw !== null && isVariantId(raw)) {
      return raw;
    }
  } catch {
    // LocalStorage nedostupný → tichý fallback na výchozí variantu.
  }
  return 'american';
}

/** Uloží zvolenou variantu. Selhání zápisu (kvóta/privátní režim) je neškodné → spolknout. */
function saveVariant(variant: VariantId): void {
  try {
    localStorage.setItem(VARIANT_STORAGE_KEY, variant);
  } catch {
    // Nejde uložit → volba se příště nepředvyplní, appka běží dál.
  }
}

/**
 * Postaví picker varianty pro sólo hru (řízený registrem `VARIANT_IDS`): `<select>`
 * s naposledy zvolenou variantou předvybranou (LocalStorage). Vrací prvek k vložení
 * a `read()`, které z aktuálního výběru vydá `VariantId` (guard je pojistka proti
 * cizímu zásahu do DOM). Sdílené místností i itch vstupem – jeden zdroj pravdy
 * picker → hra. Popisky přes `t()`, žádný natvrdo zadaný řetězec.
 */
function buildVariantPicker(): { element: HTMLSelectElement; read: () => VariantId } {
  const select = document.createElement('select');
  select.className = 'lobby-variant';
  select.setAttribute('aria-label', t('lobby.variantAria'));
  const saved = loadSavedVariant();
  for (const id of VARIANT_IDS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = variantLabel(id);
    option.selected = id === saved;
    select.append(option);
  }
  return {
    element: select,
    // Hodnoty `<option>` pocházejí z `VARIANT_IDS`; guard zúží `string` na `VariantId`
    // a odchytí cizí zásah do DOM (spadne na 'american' místo neznámé varianty).
    read: () => (isVariantId(select.value) ? select.value : 'american'),
  };
}

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
  /**
   * Přepnutí na sólo hru proti počítači (dnešní deska) ve ZVOLENÉ variantě. Variantu
   * bere z pickeru v lobby (fáze 102) a předává ji caller (`main.ts`) do `showSolo`,
   * který podle ní založí klienta i skořápku. Jediný zdroj pravdy o variantě partie
   * = tenhle picker (LocalStorage je jen jeho odraz).
   */
  readonly onPlayVsComputer: (variant: VariantId) => void;
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

/**
 * Stav obrazovky (fáze 108, jedna stránka): `connecting` (odeslán connect, čekám na
 * první snímek – akordeon je vidět s „Připojuji…", počty ještě prázdné), `connected`
 * (jsem PŘIPOJEN – předsíň i členství: nahoře „Jsi přihlášen jako X", pod tím ŽIVÝ
 * akordeon 4 lobby), `disconnected` (spadlo spojení → „Připojit znovu"). Zadání/změnu
 * přezdívky řeší MODAL nezávisle na tomto stavu; `entry` view z fáze 106 je zrušený.
 * Předsíň (`myVariant=null`) a členství sdílí view `connected`; liší se jen akce
 * v sekcích (Vstoupit→enter/switch-lobby vs. Vyzvat), viz {@link buildSectionBody}.
 */
type View = 'connecting' | 'connected' | 'disconnected';

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

  // Přepínač jazyka: `<select>` z LOCALES (jediný zdroj pravdy, ENDONYMY). Na JEDNÉ
  // vstupní stránce (fáze 108) je vidět VŽDY vedle nadpisu – dřív ho `setView` mimo
  // `entry` skrýval, protože rebuild přes `onLocaleChange` zavře room WS. Teď se
  // překreslené lobby samo auto-connectne uloženou přezdívkou (viz init dole), takže
  // se spojení obnoví a přepnutí jazyka hráče z předsíně natrvalo nevyhodí. Týž
  // přepínač staví `buildLangSelect` i do modalu přezdívky, aby ho první ne-český
  // návštěvník dosáhl i přes celoobrazovkový overlay.
  function buildLangSelect(className: string): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = className;
    select.setAttribute('aria-label', t('lobby.langAria'));
    const active = getLocale();
    for (const { locale, label } of LOCALES) {
      const option = document.createElement('option');
      option.value = locale;
      option.textContent = label;
      option.selected = locale === active;
      select.append(option);
    }
    select.addEventListener('change', () => {
      const chosen = select.value;
      // Hodnoty `<option>` pocházejí z LOCALES; guard zúží `string` na `Locale` a
      // odchytí cizí zásah do DOM. Rozepsaná (NEULOŽENÁ) přezdívka z modalu se
      // přepnutím jazyka ZÁMĚRNĚ nezachovává (fáze 108): uložit ji by buď spustilo
      // auto-connect s nedokončeným nickem, nebo obešlo bránu identity – radši prázdný
      // modal v novém jazyce.
      if (!isLocale(chosen) || chosen === getLocale()) {
        return;
      }
      saveLocale(chosen);
      setLocale(chosen);
      options.onLocaleChange();
    });
    return select;
  }

  const langSelect = buildLangSelect('lobby-lang');
  header.append(heading, langSelect);

  // Hláška stavu: „Připojuji…" během connectu, jinak skrytá. Obsazená přezdívka i
  // chyby validace nicku jdou do MODALU přezdívky (fáze 108), ne sem.
  const message = document.createElement('p');
  message.className = 'lobby-msg hidden';

  // JEDINÁ vstupní stránka (fáze 108): předsíň i členství sdílí jeden pohled. Nahoře
  // „Jsi přihlášen jako X" (klik = změnit přezdívku), pod tím stav výzev a ŽIVÝ
  // AKORDEON 4 lobby. Žádný oddělený `entry` formulář ani „Odpojit" – identitu řeší
  // modal. `room` je viditelný pořád (skryje ho jen `disconnected` pohled).
  const room = document.createElement('div');
  room.className = 'lobby-room';

  // „Jsi přihlášen jako {nick}" jako TLAČÍTKO: klik reotevře modal přezdívky (změna
  // identity) – nahrazuje zrušené „Odpojit". Text i viditelnost řídí `renderRoom`
  // (prázdný nick = skrytý, dokud nejsem připojen). `title`/`aria-label` napoví účel.
  const roomHeader = document.createElement('div');
  roomHeader.className = 'lobby-room-header';
  const nickLine = document.createElement('button');
  nickLine.type = 'button';
  nickLine.className = 'lobby-nick-line';
  nickLine.setAttribute('aria-label', t('lobby.changeNick'));
  nickLine.title = t('lobby.changeNick');
  roomHeader.append(nickLine);

  // Stav MÉ odchozí výzvy (čekám na odpověď) – skrytý, když žádná neběží.
  const outgoing = document.createElement('p');
  outgoing.className = 'lobby-outgoing hidden';

  // Neutrální provozní hláška k výzvám (soupeř odmítl / odešel) – ne chyba.
  const notice = document.createElement('p');
  notice.className = 'lobby-notice hidden';

  // Akordeon 4 varianta-lobby (fáze 104). Sekce se generují z registru variant
  // (`VARIANT_IDS`) v `renderRoom` – přidání varianty je nový záznam v registru,
  // ne zásah sem. Obsah (rostery, MOJE lobby, rozbalená sekce) plyne z all-roster
  // snímku `onLobbies`.
  const accordion = document.createElement('div');
  accordion.className = 'lobby-accordion';
  room.append(roomHeader, outgoing, notice, accordion);

  // Modal PŘÍCHOZÍ VÝZVY (fáze 106): nahradil řádek v seznamu. Server garantuje nejvýš
  // JEDNU příchozí výzvu, takže dialog ukáže vždy právě jednu (Přijmout/Odmítnout).
  // Esc ani klik mimo NIC nedělají (žádné listenery) – zavírá se jen tlačítkem, nebo
  // z kódu (spárování/zánik výzvy → `renderIncoming([])`). Znovupoužívá CSP-bezpečné
  // třídy `.modal-overlay`/`.modal-dialog` jako modaly u hry (žádné inline styly).
  const challengeModal = document.createElement('div');
  challengeModal.className = 'modal-overlay hidden';
  const challengeDialog = document.createElement('div');
  challengeDialog.className = 'modal-dialog';
  challengeDialog.setAttribute('role', 'dialog');
  challengeDialog.setAttribute('aria-modal', 'true');
  challengeDialog.setAttribute('aria-label', t('lobby.challengeModalAria'));
  challengeModal.append(challengeDialog);

  // Pohled odpojení (`disconnected`): hláška + ruční znovupřipojení (žádný auto-reconnect).
  const disconnected = document.createElement('div');
  disconnected.className = 'lobby-disconnected hidden';
  const disconnectedMsg = document.createElement('p');
  const reconnectBtn = document.createElement('button');
  reconnectBtn.type = 'button';
  reconnectBtn.className = 'lobby-reconnect-btn';
  reconnectBtn.textContent = t('lobby.reconnectBtn');
  disconnected.append(disconnectedMsg, reconnectBtn);

  // Sólo cesta (proti počítači) – nezávislá na místnosti, bez přezdívky. Vedle
  // tlačítka picker varianty (fáze 102): zvolená varianta se předá do `onPlayVsComputer`.
  const soloVariant = buildVariantPicker();
  const soloBtn = document.createElement('button');
  soloBtn.type = 'button';
  soloBtn.className = 'lobby-solo-btn';
  soloBtn.textContent = t('lobby.soloBtn');
  const soloRow = document.createElement('div');
  soloRow.className = 'lobby-solo';
  soloRow.append(soloVariant.element, soloBtn);

  // MODAL PŘEZDÍVKY (fáze 108) – jediná brána identity. Reuse CSP-bezpečných tříd
  // `.modal-overlay`/`.modal-dialog` (žádné inline styly). Obsahuje: titulek, hlášku
  // (prázdný/obsazený nick), input, VLASTNÍ přepínač jazyka (dosažitelný i přes
  // overlay) a tlačítka Uložit/Zrušit. „Zrušit" je vidět jen když JE modal zavíratelný
  // (změna nicku existující identity); při PRVNÍM načtení (bez identity) chybí a Esc/
  // klik mimo nic nedělají – bez nicku ze stránky neodejdeš (jinak žádná identita a
  // počty se nenačtou).
  const nickModal = document.createElement('div');
  nickModal.className = 'modal-overlay lobby-nick-modal hidden';
  const nickDialog = document.createElement('div');
  nickDialog.className = 'modal-dialog';
  nickDialog.setAttribute('role', 'dialog');
  nickDialog.setAttribute('aria-modal', 'true');
  nickDialog.setAttribute('aria-label', t('lobby.nickModalAria'));
  const nickTitle = document.createElement('h2');
  nickTitle.className = 'modal-msg';
  nickTitle.textContent = t('lobby.nickModalTitle');
  const nickModalMsg = document.createElement('p');
  nickModalMsg.className = 'modal-notice hidden';
  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.className = 'lobby-nick';
  nickInput.setAttribute('aria-label', t('lobby.nickAria'));
  nickInput.placeholder = t('lobby.nickPlaceholder');
  nickInput.maxLength = NICK_MAX_LENGTH;
  const nickModalLang = buildLangSelect('lobby-nick-lang');
  const nickActions = document.createElement('div');
  nickActions.className = 'modal-actions';
  const nickSaveBtn = document.createElement('button');
  nickSaveBtn.type = 'button';
  nickSaveBtn.className = 'lobby-nick-save-btn';
  nickSaveBtn.textContent = t('lobby.nickSaveBtn');
  const nickCancelBtn = document.createElement('button');
  nickCancelBtn.type = 'button';
  nickCancelBtn.className = 'lobby-nick-cancel-btn';
  nickCancelBtn.textContent = t('lobby.nickCancelBtn');
  nickActions.append(nickSaveBtn, nickCancelBtn);
  nickDialog.append(nickTitle, nickModalMsg, nickInput, nickModalLang, nickActions);
  nickModal.append(nickDialog);

  card.append(header, message, room, disconnected, soloRow);
  element.append(card, challengeModal, nickModal);

  // Přezdívka posledního úspěšného/pokusného vstupu – pro „Připojit znovu".
  let lastNick = '';
  // `true`, jakmile connect JEDNOU uspěl (dorazil první snímek/roster). Rozlišuje (a)
  // hlášku odpojení: pád PŘED úspěšným connectem = „nepodařilo se připojit", PO něm =
  // „spojení se přerušilo"; (b) zavíratelnost modalu přezdívky: dokud nemám funkční
  // identitu, modal nejde zavřít bez nicku (jinak bych uvázl bez připojení). Chyby
  // nicku (obsazený/dlouhý) PŘED prvním úspěchem míří do modalu, PO něm jsou to už
  // chyby výzev/vstupu → notice v předsíni.
  let connectedOnce = false;
  // Poslední all-roster snímek všech 4 lobby (fáze 104) – z něj akordeon kreslí
  // obsazení místností. Držíme ho, ať jde překreslit (disabled tlačítka „Vyzvat"
  // při změně odchozí výzvy, přepnutí rozbalené sekce) bez čekání na nový snímek.
  let currentLobbies: LobbyView[] = [];
  // MOJE lobby (varianta, ve které jsem) – odvozená ze snímku (položka s `isSelf`).
  // Řídí, která sekce nabízí „Vyzvat" (jen moje) vs. „Vstoupit" (ostatní).
  let myVariant: VariantId | null = null;
  // Rozbalená sekce akordeonu (nebo `null` = všechny sbalené). Výchozí = moje lobby;
  // uživatel ji přepíná klikem na hlavičku sekce nebo vstupem do jiné lobby.
  let expandedVariant: VariantId | null = null;
  // `true`, jakmile jsme JEDNOU nastavili výchozí rozbalenou sekci (moje lobby).
  // Bez něj by každý další snímek prezence (join/left/switch KOHOKOLI → broadcast
  // všem) znovu rozbalil moji sekci, i když ji uživatel právě vědomě sbalil.
  let hasAutoExpanded = false;
  // Moje přezdívka pro řádek nad akordeonem (z rosteru / snímku, fallback `lastNick`).
  let myNick = '';
  // `true` mezi kliknutím na „Vstoupit" a odpovědí serveru (roster = úspěch / error =
  // odmítnutí). Uzavírá závod: kliknu Vstoupit, ale soupeř mezitím přijme MOU výzvu →
  // vznikne partie a `switch-lobby` server odmítne („během partie"). Ta chyba by jinak
  // v `onError` propadla do herní obrazovky (activeGameErrorHandler) a ukázala matoucí
  // hlášku u desky. Flag ji označí jako přechodovou → spolkne se / jde do notice, ne do hry.
  let pendingSwitch = false;
  // `true`, dokud čeká MOJE odchozí výzva – tehdy nejdou vyzývat další (max-1).
  let outgoingPending = false;
  // `true`, dokud mám ŽIVÉ spojení do místnosti (dorazil snímek, ještě nespadlo). Řídí,
  // jestli „Vstoupit" v akordeonu rovnou vstoupí, nebo napřed otevře modal přezdívky
  // (bez připojení nemá `enter` kam jít). Mění se s connectem/pádem, ne jen jednou.
  let connected = false;
  // Aktuální pohled (fáze 108): `connecting` po odeslání connectu, `connected` v
  // předsíni/místnosti, `disconnected` po pádu. Rozhoduje i směr serverové chyby
  // (viz `onError`). Startuje `connecting`, protože při načtení buď rovnou auto-
  // connectneme uloženým nickem, nebo čekáme na nick z modalu (bez živé chyby).
  let currentView: View = 'connecting';
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
        // Roster = vstup do konkrétní lobby (enter/switch uspěl, fáze 106). Jsem člen.
        connectedOnce = true;
        connected = true;
        pendingSwitch = false; // úspěšný přechod dorazí jako roster cílové lobby
        // Přezdívku vezmi z rosteru (položka `isSelf`), fallback poslední zadaná.
        myNick = roster.find((r) => r.isSelf)?.nick ?? lastNick;
        setView('connected');
        renderRoom(); // skeleton akordeonu; obsah rosterů dorovná onLobbies (přijde hned po)
      },
      onLobbies: (lobbies) => {
        // All-roster snímek všech 4 lobby (fáze 104) – jediný zdroj obsazení pro akordeon.
        // Přijde i jako PRVNÍ odpověď na connect (fáze 106): tehdy nejsem v žádném
        // rosteru → `selfLobby` undefined → `myVariant=null` (předsíň).
        // ZÁMĚRNĚ tu NEzavírám modal přezdívky: `submitNick` ho zavírá optimisticky už
        // při Uložit, takže při úspěchu je stejně zavřený. Naopak DOBROVOLNĚ otevřený
        // modal změny nicku (jsem připojen) by tenhle broadcast (kdokoli join/left →
        // `lobbies` všem) jinak zavíral uprostřed psaní.
        connectedOnce = true; // první snímek = connect uspěl (i pro předsíň bez vstupu)
        connected = true;
        currentLobbies = lobbies;
        const selfLobby = lobbies.find((l) => l.players.some((p) => p.isSelf));
        myVariant = selfLobby?.variant ?? null;
        if (selfLobby !== undefined) {
          myNick = selfLobby.players.find((p) => p.isSelf)?.nick ?? myNick;
        }
        // Výchozí rozbalená sekce = MOJE lobby, ale JEN poprvé (po vstupu) – pak už
        // respektuj uživatelovu volbu (sbalení/rozbalení se nesmí resetovat snímkem).
        // V předsíni (`myVariant=null`) nic nerozbaluj: obsazenost je vidět z počtů
        // v hlavičkách sekcí, uživatel si sekci otevře sám.
        if (!hasAutoExpanded && myVariant !== null) {
          expandedVariant = myVariant;
          hasAutoExpanded = true;
        }
        // Connect uspěl (nebo přišel snímek prezence) → jsem v pohledu místnosti.
        if (currentView !== 'connected') {
          setView('connected');
        }
        renderRoom();
      },
      onIncomingChallenges: (challenges) => {
        renderIncoming(challenges);
      },
      onOutgoingChallenge: (pending) => {
        renderOutgoing(pending);
      },
      onChallengeAccepted: (info) => {
        // Přechod do hry: zavři případný otevřený modal přezdívky, ať se s odpojeným
        // lobby.element nepřenese do hry a zpět (jsem připojen → jen skrýt, bez resetu).
        closeNickModal();
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
        // Obsazená přezdívka (i při AUTO-connectu z LocalStorage – např. dvě záložky
        // se stejným nickem). Řeší se V MODALU (fáze 108): otevři ho s návrhem a hláškou.
        // `suggestion` posílá server jako DATA – lokalizuje se jen okolní věta. Modal je
        // tu VŽDY nezavíratelný: nick-taken znamená, že aktuální pokus o connect NEuspěl,
        // takže NEMÁM živou identitu (u změny nicku jsme starou při Uložit už odpojili).
        // „Zrušit" ji zavře → padnu na nepřipojenou stránku se sólem a „Přihlásit se ke
        // hře s lidmi" (žádná past), takže modal je zavíratelný jako všude jinde.
        openNickModal();
        nickInput.value = suggestion;
        setNickModalMsg(t('lobby.nickTaken', { suggestion }));
        nickInput.focus();
        nickInput.select();
      },
      onError: (text) => {
        // Odmítnutí PŘECHODU do jiné lobby (`switch-lobby`) – typicky závod „soupeř
        // přijal mou výzvu dřív, než dorazil switch → jsem busy". NESMÍ propadnout do
        // herní obrazovky jako odmítnutý tah (matoucí hláška u desky). Spolkni ho: za
        // běhu partie je pohled místnosti stejně odpojený (notice by nikdo neviděl),
        // mimo partii ho ukaž jako neutrální notice. Konzumuje se právě jednou.
        if (pendingSwitch) {
          pendingSwitch = false;
          if (activeGameErrorHandler === null) {
            showNotice(text);
          }
          return;
        }
        // Za běhu PvP partie je chyba z room WS odmítnutá herní operace – tah, vzdání
        // nebo příkaz remízy (roster ani výzvy se z herní obrazovky neposílají). Doruč ji
        // herní obrazovce; pohled místnosti je mezitím odpojený z DOM, notice by nikdo neviděl.
        if (activeGameErrorHandler !== null) {
          activeGameErrorHandler(text);
          return;
        }
        // Server posílá `error` i pro CHYBY VÝZEV (vyzvaný už hraje, dvojitá/křížová
        // výzva, „výzva už neplatí") a chyby vstupu do lobby (`enter`). Když mám ŽIVÉ
        // spojení (`connected`), je to provozní chyba → jen hláška v předsíni (notice),
        // zůstaň připojený. Když spojení NEmám (probíhal connect – první, změna nicku
        // i reconnect), je to chyba přezdívky (moc dlouhá apod.) → do MODALU přezdívky,
        // ať uživatel neuvázne v „Připojuji…" bez cesty ven.
        if (connected) {
          showNotice(text);
          return;
        }
        openNickModal();
        setNickModalMsg(text);
        nickInput.focus();
      },
      onDisconnected: () => {
        connected = false;
        disconnectedMsg.textContent = connectedOnce
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

  /**
   * Přepne viditelné sekce podle stavu obrazovky (fáze 108). `room` (jedna vstupní
   * stránka) je vidět v `connecting` i `connected`; skryje ho jen `disconnected`
   * pohled. `connecting` ukáže hlášku „Připojuji…" a vyčistí stav výzev z případného
   * padlého spojení; `connected`/`disconnected` hlášku smažou. Přepínač jazyka je
   * teď VŽDY vidět (viz `buildLangSelect`) – po rebuildu se auto-connectne.
   */
  function setView(view: View): void {
    currentView = view;
    room.classList.toggle('hidden', view === 'disconnected');
    disconnected.classList.toggle('hidden', view !== 'disconnected');
    if (view === 'connecting') {
      setMessage(t('lobby.connecting'));
      // Nový pokus o připojení: zahoď stav výzev z předchozího (padlého) spojení –
      // room-client ho interně taky vyčistil, ale prázdné seznamy sám neposílá.
      renderIncoming([]);
      renderOutgoing(null);
      showNotice('');
    } else {
      setMessage('');
    }
  }

  /**
   * Vykreslí AKORDEON 4 varianta-lobby (fáze 104): nahoře přezdívka, pod ní sekce
   * z registru `VARIANT_IDS`. Každá sekce má hlavičku (název varianty + počet hráčů)
   * a po rozbalení tělo s rosterem té lobby. MOJE lobby nabízí u cizích hráčů „Vyzvat"
   * a mě označí „Jsi tady"; ostatní lobby jsou jen ke čtení + tlačítko „Vstoupit"
   * (přechod přes `switchLobby`). Přebuduje se celé z `currentLobbies` – žádný
   * inkrementální diff (rostery jsou malé, jednoduchost > úspora).
   */
  function renderRoom(): void {
    // Tlačítko nad akordeonem, VŽDY viditelné (klik = otevřít modal přezdívky): mám-li
    // nick, „Jsi přihlášen jako X" (změna nicku); bez nicku „Přihlásit se ke hře s
    // lidmi" (přihlášení). Je to jediná cesta, jak modal znovu otevřít po jeho zavření –
    // proto se neschovává (jinak by se solo-hráč po zavření modalu k PvP už nedostal).
    nickLine.textContent = myNick === '' ? t('lobby.signIn') : t('lobby.loggedInAs', { nick: myNick });
    accordion.replaceChildren(...VARIANT_IDS.map((id) => buildSection(id)));
  }

  /** Postaví jednu sekci akordeonu pro variantu `id` (hlavička + volitelně tělo). */
  function buildSection(id: VariantId): HTMLElement {
    const players = currentLobbies.find((l) => l.variant === id)?.players ?? [];
    const expanded = expandedVariant === id;
    const isMine = myVariant === id;

    const section = document.createElement('div');
    section.className = 'lobby-section';
    section.classList.toggle('is-mine', isMine);
    section.classList.toggle('is-expanded', expanded);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'lobby-section-header';
    header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const name = document.createElement('span');
    name.className = 'lobby-section-name';
    name.textContent = variantLabel(id);
    const count = document.createElement('span');
    count.className = 'lobby-section-count';
    count.textContent = String(players.length);
    header.append(name, count);
    // Klik na hlavičku rozbalí/sbalí sekci (jen jedna otevřená – akordeon).
    header.addEventListener('click', () => {
      expandedVariant = expanded ? null : id;
      renderRoom();
    });
    section.append(header);

    if (expanded) {
      section.append(buildSectionBody(id, players, isMine));
    }
    return section;
  }

  /** Tělo rozbalené sekce: roster té lobby + akce (Vyzvat v mé lobby / Vstoupit v cizí). */
  function buildSectionBody(id: VariantId, players: RosterEntry[], isMine: boolean): HTMLElement {
    const body = document.createElement('div');
    body.className = 'lobby-section-body';
    const list = document.createElement('ul');
    list.className = 'lobby-roster';
    if (players.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'lobby-empty';
      empty.textContent = t('lobby.emptyLobby');
      list.append(empty);
    } else {
      for (const p of players) {
        list.append(buildRosterItem(p, isMine));
      }
    }
    body.append(list);
    // Ne-MOJE sekce = tlačítko Vstoupit. „Vstoupit" má DVĚ serverové operace podle
    // stavu (fáze 106): z PŘEDSÍNĚ (`myVariant=null`) je to `enter` (první vstup),
    // z JINÉ lobby (člen) `switch-lobby` (přechod). Splést je nesmím – server by
    // `switch-lobby` v předsíni odmítl a UX by se zaseklo.
    if (!isMine) {
      const enterBtn = document.createElement('button');
      enterBtn.type = 'button';
      enterBtn.className = 'lobby-enter-btn';
      enterBtn.textContent = t('lobby.enterLobbyBtn');
      enterBtn.addEventListener('click', () => {
        // Nepřipojen (solo-hráč zavřel modal přezdívky) → „Vstoupit" nemá kam jít
        // (`enter` guarduje na připojení). Místo mrtvého tlačítka otevři modal
        // přihlášení; po připojení už vstup funguje běžně.
        if (!connected) {
          nickInput.value = myNick;
          openNickModal();
          return;
        }
        // Po vstupu ať sekce zůstane rozbalená (ukáže Vyzvat). Server přesune členství
        // a pošle nový snímek (onLobbies), který myVariant přepočítá.
        expandedVariant = id;
        if (myVariant === null) {
          // Předsíň → PRVNÍ vstup. Ne-člena nejde vyzvat (server guard), takže tu
          // není závod s přijetím výzvy – žádný `pendingSwitch`.
          room_client.enter(id);
        } else {
          // Člen jiné lobby → přechod. `pendingSwitch` hlídá závod „soupeř přijal mou
          // výzvu dřív, než dorazil switch" (viz `onError`).
          pendingSwitch = true;
          room_client.switchLobby(id);
        }
      });
      body.append(enterBtn);
    }
    return body;
  }

  /**
   * Jedna položka rosteru. V MÉ lobby: vlastní záznam zvýrazní a označí „Jsi tady",
   * u cizích přidá „Vyzvat" (zamčené, dokud čeká moje odchozí výzva – max-1). V cizí
   * lobby jsou položky jen ke čtení (žádné Vyzvat – výzva jen v téže lobby, fáze 103).
   */
  function buildRosterItem(entry: RosterEntry, isMine: boolean): HTMLElement {
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
      you.textContent = t('lobby.hereBadge');
      name.append(you);
    } else if (isMine) {
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
  }

  /**
   * Řídí MODAL příchozí výzvy (fáze 106). Otevře ho při neprázdném seznamu (ukáže
   * PRVNÍ výzvu – server garantuje nejvýš jednu), zavře při prázdném. Zavření řídí
   * VÝHRADNĚ tenhle stav: prázdný seznam přijde po přijetí/odmítnutí, po spárování
   * (`challenge-accepted` → room-client pošle prázdný seznam) i po zániku výzvy
   * (`challenge-cancelled`). Esc ani klik mimo se nevěší – jen tlačítka v dialogu.
   * V předsíni (ne-člen) sem nikdy nedorazí neprázdný seznam (server výzvu ne-členu
   * nepošle), takže se modal neobjeví.
   */
  function renderIncoming(challenges: IncomingChallenge[]): void {
    const c = challenges[0];
    if (c === undefined) {
      challengeModal.classList.add('hidden');
      return;
    }
    const title = document.createElement('h2');
    title.className = 'modal-msg';
    title.textContent = t('lobby.challengeModalTitle');
    const label = document.createElement('p');
    label.className = 'modal-notice';
    label.textContent = t('lobby.challengeFrom', { nick: c.challengerNick });
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
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
    actions.append(accept, reject);
    challengeDialog.replaceChildren(title, label, actions);
    challengeModal.classList.remove('hidden');
    accept.focus();
  }

  /** Ukáže/skryje stav odchozí výzvy a přepočítá zámek tlačítek „Vyzvat". */
  function renderOutgoing(pending: OutgoingChallenge | null): void {
    outgoingPending = pending !== null;
    outgoing.textContent = pending === null ? '' : t('lobby.waitingFor', { nick: pending.targetNick });
    outgoing.classList.toggle('hidden', pending === null);
    // Překresli akordeon, ať se u tlačítek „Vyzvat" projeví nový disabled stav.
    renderRoom();
  }

  /** Krátká neutrální hláška k výzvám (odmítnutí / odchod soupeře); prázdná ji skryje. */
  function showNotice(text: string): void {
    notice.textContent = text;
    notice.classList.toggle('hidden', text === '');
  }

  /** Vyresetuje lokální stav předsíně/členství před (re)connectem, ať se snímky nemíchají. */
  function resetPresence(): void {
    myVariant = null;
    currentLobbies = [];
    hasAutoExpanded = false;
    renderIncoming([]); // zavři případný modal příchozí výzvy
    renderOutgoing(null);
    showNotice('');
  }

  /**
   * (RE)connect s přezdívkou `nick`: zapamatuj ji, ukaž hned v labelu, ulož do
   * LocalStorage (příště AUTO-connect), zahoď starou identitu i stav předsíně a otevři
   * čerstvé spojení. Sdílené prvním připojením, ZMĚNOU nicku i reconnectem po pádu.
   * `disconnect()` před `connect()` zavře případný starý socket (u změny nicku); bez
   * socketu (první connect) je to neškodný no-op.
   */
  function startConnect(nick: string): void {
    lastNick = nick;
    myNick = nick;
    saveNick(nick);
    connected = false; // stará identita padá; `connected` naskočí až s prvním snímkem
    room_client.disconnect();
    resetPresence();
    setView('connecting');
    renderRoom(); // ukaž „Jsi přihlášen jako X" hned (label + prázdný akordeon)
    room_client.connect(nick);
  }

  /** Text hlášky uvnitř modalu přezdívky (obsazený/dlouhý nick); prázdná ji skryje. */
  function setNickModalMsg(text: string): void {
    nickModalMsg.textContent = text;
    nickModalMsg.classList.toggle('hidden', text === '');
  }

  /**
   * Otevře modal přezdívky. VŽDY zavíratelný (Zrušit/Esc/klik mimo): „Hrát proti
   * počítači" jde i bez přihlášení, takže modal nesmí být past – po zavření zůstane
   * stránka použitelná (solo + „Přihlásit se ke hře s lidmi" pro pozdější PvP). Nezmění
   * už vyplněný input (volající si ho nastaví: návrh serveru / aktuální nick).
   */
  function openNickModal(): void {
    setNickModalMsg('');
    if (nickInput.value.trim() === '') {
      nickInput.value = myNick !== '' ? myNick : loadSavedNick();
    }
    nickModal.classList.remove('hidden');
    nickInput.focus();
    nickInput.select();
  }

  /** Zavře modal přezdívky (a vyčistí jeho hlášku). Nesahá na stav spojení – používá
   *  ho i `submitNick` těsně PŘED `startConnect` (optimistické zavření při Uložit). */
  function closeNickModal(): void {
    nickModal.classList.add('hidden');
    setNickModalMsg('');
  }

  /**
   * UŽIVATELSKÉ zavření modalu (Zrušit/Esc/klik mimo). Když jsem u toho NEBYL připojený
   * (dismiss na prvním načtení nebo na NEZDAŘENÉM connectu – nick-taken/chyba, kde
   * room-client drží půlotevřený socket), zahoď rozdělaný pokus a vrať stránku do
   * čistého NEPŘIHLÁŠENÉHO stavu: žádné lživé „Jsi přihlášen jako X" a žádné zaseklé
   * „Připojuji…". Jinak (změna nicku za živa) jen zavře.
   */
  function dismissNickModal(): void {
    closeNickModal();
    if (!connected) {
      room_client.disconnect(); // zavři půlotevřený socket nezdařeného connectu
      myNick = '';
      setMessage('');
      renderRoom(); // label zpět na „Přihlásit se ke hře s lidmi"
    }
  }

  /**
   * Uloží nick z modalu a připojí. Prázdný odmítne (hláška v modalu, nezavírá).
   * Změna na TÝŽ nick (a už jsem připojen) jen zavře – žádný zbytečný reconnect.
   * Jinak zavři OPTIMISTICKY a připoj; `nick-taken`/chyba modal zase otevře.
   */
  function submitNick(): void {
    const nick = nickInput.value.trim();
    if (nick === '') {
      setNickModalMsg(t('lobby.enterNick'));
      nickInput.focus();
      return;
    }
    if (connected && nick === myNick) {
      closeNickModal(); // připojen pod týmž nickem → nic neměň, jen zavři
      return;
    }
    closeNickModal();
    startConnect(nick);
  }

  nickSaveBtn.addEventListener('click', submitNick);
  // Input je mimo `<form>` (celý modal je CSP-safe overlay) → Enter obsloužíme ručně.
  nickInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitNick();
    }
  });
  nickCancelBtn.addEventListener('click', dismissNickModal);
  // Klik na ztmavené pozadí i Esc zavřou modal (vždy – viz `openNickModal`).
  nickModal.addEventListener('click', (event) => {
    if (event.target === nickModal) {
      dismissNickModal();
    }
  });
  const onNickModalKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !nickModal.classList.contains('hidden')) {
      dismissNickModal();
    }
  };
  document.addEventListener('keydown', onNickModalKeydown);

  // Tlačítko nad akordeonem → otevři modal přezdívky (přihlášení / změna nicku).
  // Předvyplň aktuální nick, ať uživatel jen upraví (prázdný u nepřihlášeného).
  nickLine.addEventListener('click', () => {
    nickInput.value = myNick;
    openNickModal();
  });

  reconnectBtn.addEventListener('click', () => {
    // Znovupřipojení po pádu: connect posledním/uloženým nickem zpět do PŘEDSÍNĚ.
    startConnect(lastNick !== '' ? lastNick : loadSavedNick());
  });
  soloBtn.addEventListener('click', () => {
    // Jediný zdroj varianty = picker; LocalStorage je jen jeho odraz (ulož TEĎ, ať
    // se příště předvyplní), a hodnota jde rovnou do hry přes onPlayVsComputer.
    const variant = soloVariant.read();
    saveVariant(variant);
    options.onPlayVsComputer(variant);
  });

  // Init (fáze 108): uložená přezdívka → rovnou AUTO-connect (žádný modal, předsíň
  // s živými počty). Bez ní → rovnou nabídni modal přezdívky (zavíratelný – kdo chce
  // hrát jen proti počítači, ho zavře a stránku dál používá; PvP si otevře přes
  // „Přihlásit se ke hře s lidmi").
  renderRoom(); // podklad: „Přihlásit se…" + prázdný akordeon (počty dorovná první snímek)
  const savedNick = loadSavedNick();
  if (savedNick !== '') {
    startConnect(savedNick);
  } else {
    openNickModal();
  }

  return {
    element,
    dispose: () => {
      document.removeEventListener('keydown', onNickModalKeydown); // globální listener nesmí přežít lobby
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

  // Sólo cesta (proti počítači) – shodná s místností: picker varianty + tlačítko,
  // řídí ji caller přes `onPlayVsComputer(variant)`.
  const soloVariant = buildVariantPicker();
  const soloBtn = document.createElement('button');
  soloBtn.type = 'button';
  soloBtn.className = 'lobby-solo-btn';
  soloBtn.textContent = t('lobby.soloBtn');
  const soloRow = document.createElement('div');
  soloRow.className = 'lobby-solo';
  soloRow.append(soloVariant.element, soloBtn);

  card.append(header, humanBtn, soloRow);
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
    const variant = soloVariant.read();
    saveVariant(variant);
    options.onPlayVsComputer(variant);
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

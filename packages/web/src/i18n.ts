/**
 * Lokalizační jádro webového klienta (cs/en).
 *
 * Jazyk se detekuje z nastavení prohlížeče (`navigator.languages`, s fallbackem na
 * `navigator.language`): vybere se PRVNÍ podporovaný jazyk podle prefixu („cs-CZ" →
 * cs, „en-US" → en), a když prohlížeč nehlásí žádný podporovaný, spadne se na
 * angličtinu (`FALLBACK`). Detekce je čistá funkce ({@link detectLocale}), aktivní
 * jazyk drží modul jako jedináček – nastaví se jednou při startu appky
 * ({@link initLocale} z `main.ts`) a čte se přes {@link getLocale} uvnitř `t()`.
 *
 * Překlady jsou dva ploché slovníky se STEJNOU sadou klíčů; `en` je přes `satisfies`
 * přibitý na klíče `cs`, takže když někde klíč chybí, neprojde to typovou kontrolou.
 * `t(key, params?)` vrátí text aktivního jazyka a dosadí `{jméno}` placeholdery.
 *
 * HRANICE FÁZE 81: lokalizují se jen řetězce, které skládá KLIENT. Hlášky, které
 * posílá server jako hotový text (provozní notice, chyby, návrh náhradní přezdívky),
 * zůstávají v jazyce serveru – klient je nemá z čeho přeložit a server je autorita.
 */

import { APP_TITLE } from './index.js';
import type { VariantId } from '@checkers/rules';

/** Podporované jazyky UI. Rozšíření = přidat klíč do obou slovníků níž. */
export type Locale = 'cs' | 'en';

/**
 * JEDINÝ zdroj pravdy o podporovaných jazycích: pořadí = pořadí v přepínači jazyka.
 * `label` je ENDONYM (jazyk zapsaný sám v sobě), aby ho uživatel našel bez ohledu na
 * aktuální jazyk UI. Přidání jazyka = přidat sem položku a doplnit oba slovníky níž
 * (typová kontrola `en satisfies` pak vynutí kompletní sadu klíčů). Detekce prohlížeče
 * i validace uložené volby čtou podporované jazyky odsud přes {@link isLocale}, ne z
 * natvrdo psaného seznamu.
 */
export const LOCALES: readonly { readonly locale: Locale; readonly label: string }[] = [
  { locale: 'cs', label: 'Čeština' },
  { locale: 'en', label: 'English' },
];

/** Je `value` podporovaný jazyk? Guard odvozený z {@link LOCALES} (ne natvrdo cs/en). */
export function isLocale(value: string): value is Locale {
  return LOCALES.some((entry) => entry.locale === value);
}

/** Jazyk, na který se spadne, když prohlížeč nehlásí žádný podporovaný (dle vize). */
const FALLBACK: Locale = 'en';

/**
 * Vybere jazyk podle seznamu preferencí prohlížeče. Bere PRVNÍ položku, jejíž prefix
 * (část před `-`) je podporovaný – „cs-CZ" i „cs" → `cs`, „en-GB" → `en`. Když žádná
 * položka nesedí (prázdný seznam, jen „de"), vrátí {@link FALLBACK}. Čistá funkce –
 * nesahá na `navigator`, aby šla přímo testovat.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const prefix = lang.toLowerCase().split('-')[0] ?? '';
    if (isLocale(prefix)) {
      return prefix;
    }
  }
  return FALLBACK;
}

/**
 * Aktivní jazyk. `null`, dokud ho nikdo nenastavil – první čtení přes
 * {@link getLocale} ho líně dopočítá z prohlížeče ({@link initLocale}), takže
 * `t()` funguje i bez explicitního bootstrapu (např. v testu, který ho nevolá).
 */
let currentLocale: Locale | null = null;

/** Seznam jazyků z prohlížeče; mimo prohlížeč (node) prázdný. */
function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }
  // `navigator.languages` bývá prázdné (např. privacy režim) a v cizím prostředí může
  // i chybět – proto na něj i na jeho `.length` sáhneme přes `?.`. V obou případech
  // spadneme na jednotné `navigator.language`; když chybí/je prázdné i to, vrátíme [].
  const languages = navigator.languages;
  if (languages?.length) {
    return languages;
  }
  const single: string | undefined = navigator.language;
  return single ? [single] : [];
}

/**
 * Zjistí jazyk z prohlížeče, uloží ho jako aktivní a vrátí. Volá `main.ts` při startu
 * (a nastaví jím `<html lang>`); vrácená hodnota je detekovaný jazyk.
 */
export function initLocale(): Locale {
  currentLocale = detectLocale(browserLanguages());
  return currentLocale;
}

/** Ručně nastaví aktivní jazyk (bootstrap s pevnou volbou, testy). */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/** Aktivní jazyk; při prvním čtení bez předchozího nastavení ho odvodí z prohlížeče. */
export function getLocale(): Locale {
  return currentLocale ?? initLocale();
}

/** Klíč LocalStorage pro RUČNĚ zvolený jazyk (přednost před detekcí prohlížeče). */
const LOCALE_STORAGE_KEY = 'checkers.locale';

/**
 * Načte ručně uloženou volbu jazyka z LocalStorage. Vrací `null`, když nic uloženo
 * není, hodnota je neznámá/poškozená ({@link isLocale} ji odmítne), nebo úložiště
 * není dostupné (privátní režim) – volající pak spadne na detekci prohlížeče. Slepě
 * nedůvěřuje obsahu úložiště (uživatel/rozšíření tam může vrazit cokoli).
 */
export function loadStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return raw !== null && isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Uloží ručně zvolený jazyk. Selhání zápisu (kvóta/privátní režim) je neškodné → spolknout. */
export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Nejde uložit → volba se příště nepředvyplní, appka běží dál v detekovaném jazyce.
  }
}

/**
 * Rozhodne STARTOVNÍ jazyk podle priorit: ručně uložená volba (LocalStorage) →
 * detekce prohlížeče → {@link FALLBACK}. Výsledek nastaví jako aktivní a vrátí ho
 * (volá `main.ts` při startu; hodnota jde i do `<html lang>`). Náhrada za holé
 * {@link initLocale}, které by uloženou volbu ignorovalo.
 */
export function resolveInitialLocale(): Locale {
  const stored = loadStoredLocale();
  if (stored !== null) {
    setLocale(stored);
    return stored;
  }
  return initLocale();
}

/**
 * Český slovník je ZDROJ pravdy o sadě klíčů – anglický se na něj přibíjí přes
 * `satisfies` (chybějící klíč = chyba typu). Klíče jsou ploché `oblast.název`.
 */
const cs = {
  // Titulek stránky (`document.title`, záložka prohlížeče). Český název je zdroj
  // pravdy `APP_TITLE`, ať neexistuje ve dvou kopiích.
  'app.title': APP_TITLE,

  'lobby.title': 'Herní místnosti',
  'lobby.nickAria': 'Přezdívka',
  'lobby.nickPlaceholder': 'Tvoje přezdívka',
  'lobby.rosterTitle': 'Přítomní hráči',
  'lobby.reconnectBtn': 'Připojit znovu',
  // Sekce hry proti počítači (fáze 109): nadpis nad selectem varianty odděluje sólo
  // cestu od místností; tlačítko je krátké („Hrát"), ať se vejde vedle selectu i na
  // mobilu (kontext dodává nadpis). Dřív bylo dlouhé „Hrát proti počítači" na tlačítku.
  'lobby.soloHeading': 'Hrát proti počítači',
  'lobby.soloBtn': 'Hrát',
  'lobby.connecting': 'Připojuji do místnosti…',
  'lobby.you': ' (ty)',
  'lobby.challengeBtn': 'Vyzvat',
  'lobby.challengeFrom': '{nick} tě vyzývá na partii',
  'lobby.acceptBtn': 'Přijmout',
  'lobby.rejectBtn': 'Odmítnout',
  'lobby.waitingFor': 'Čekám na odpověď: {nick}…',
  'lobby.enterNick': 'Zadej přezdívku.',
  'lobby.disconnectedAfter': 'Spojení s místností se přerušilo.',
  'lobby.disconnectedBefore': 'K místnosti se nepodařilo připojit (server neodpovídá).',
  'lobby.nickTaken': 'Přezdívka je obsazená. Zkus třeba „{suggestion}".',
  'lobby.langAria': 'Jazyk',
  'lobby.variantAria': 'Varianta hry proti počítači',

  // Akordeon čtyř varianta-lobby (fáze 104): nahoře přezdívka, pod ní 4 přepínatelné
  // sekce (jedna = jedna varianta). Rozbalená sekce ukáže roster + akci (Vyzvat v MÉ
  // lobby, Vstoupit v ostatních). Názvy místností = názvy variant (`variant.*`, D2).
  'lobby.loggedInAs': 'Jsi přihlášen jako {nick}',
  // Výzva k přihlášení, když ještě nemám přezdívku (klik = otevřít modal přezdívky).
  // „Hrát proti počítači" jde i bez přihlášení – proto modal NENÍ past (fáze 108).
  'lobby.signIn': 'Přihlásit se ke hře s lidmi',
  'lobby.enterLobbyBtn': 'Vstoupit',
  'lobby.hereBadge': 'Jsi tady',
  'lobby.emptyLobby': 'Zatím tu nikdo není',

  // Modal přezdívky (fáze 108): jediná brána identity. Při prvním načtení (bez uložené
  // přezdívky) vyskočí a nejde zavřít bez nicku; klik na „Jsi přihlášen jako X" ho
  // reotevře (změna přezdívky – tehdy jde Storno = nechat starou). Uložení = connect.
  'lobby.nickModalTitle': 'Zvol si přezdívku',
  'lobby.nickModalAria': 'Zadání přezdívky',
  'lobby.nickSaveBtn': 'Uložit',
  'lobby.nickCancelBtn': 'Zrušit',
  'lobby.changeNick': 'Změnit přezdívku',

  // Modal příchozí výzvy (fáze 106): nahradil řádek v seznamu. Server garantuje
  // nejvýš JEDNU příchozí výzvu, takže modal ukáže vždy právě jednu; jen Přijmout/
  // Odmítnout (Esc ani klik mimo nic nedělají). Zavře se přijetím/odmítnutím,
  // spárováním (přechod do hry) nebo zánikem výzvy.
  'lobby.challengeModalTitle': 'Výzva na partii',
  'lobby.challengeModalAria': 'Příchozí výzva na partii',

  // Názvy variant pravidel (fáze 102, dovětek „dáma"/„checkers" fáze 109) – zobrazovací
  // popisky pickeru v lobby, názvů místností i názvu varianty nad deskou (fáze 107, přes
  // `variantLabel`). Dovětek dělá jasným, že jde o DRUH hry (dáma), ne o jazyk. Interní id
  // (american/pool/russian/czech) jde po drátě/kódu anglicky, tady je JEN překlad. Pool
  // nemá zavedený český přívlastek → zůstává „Pool" + dovětek („Pool dáma").
  'variant.american': 'Americká dáma',
  'variant.pool': 'Pool dáma',
  'variant.russian': 'Ruská dáma',
  'variant.czech': 'Česká dáma',

  // Itch build (fáze 89): AI-only publikace. Hra s člověkem tady neběží (server je
  // cross-origin, mrtvý WS) → tlačítko místo místnosti otevře modal s odkazem na
  // živou verzi. Text vysvětluje, proč tu PvP není a kam pro něj jít.
  'itch.humanBtn': 'Hrát s člověkem',
  'itch.modalTitle': 'Hra s člověkem je na plné verzi',
  'itch.modalMsg':
    'Tady na itch.io běží jen hra proti počítači. Hra dvou lidí proti sobě potřebuje herní server, který itch nemá – najdeš ji na plné verzi hry.',
  'itch.modalLink': 'Otevřít plnou verzi',
  'itch.modalAria': 'Hra s člověkem je na plné verzi',
  'itch.close': 'Zavřít',

  // Herní obrazovka PvP (fáze 82): stavový pruh, panel, modaly (vzdání, remíza,
  // odveta, ztráta spojení), aria-popisky a výsledek/důvod konce z pohledu hráče.
  'game.connecting': 'Připojuji k partii…',
  // Popisek „Varianta:" před názvem místnosti nad deskou v PvP (fáze 107) – běžný řez
  // (ztlumený), samotný název varianty je tučně vedle (jako „Soupeř:" + přezdívka).
  'game.variantLabel': 'Varianta:',
  'game.opponentLabel': 'Soupeř:',
  'game.offerDraw': 'Remíza',
  'game.resign': 'Vzdát se',
  'game.turnYou': 'Na tahu: ty',
  'game.turnOpponent': 'Na tahu: soupeř',
  'game.connUnavailable': 'Spojení není dostupné – zkus to znovu.',
  'game.drawOfferedWaiting': 'Nabídl jsi remízu, čekám na odpověď soupeře…',
  'game.drawRejectedByYou': 'Nabídku remízy jsi odmítl.',
  'game.drawRejectedByOpponent': 'Soupeř nabídku remízy odmítl.',
  'game.rematchDeclinedByOpponent': 'Soupeř odvetu odmítl.',
  'game.connLost': 'Spojení s partií se přerušilo.',
  // Výsledek z pohledu hráče (párování iWin × reason v outcomeText).
  'game.resultDrawAgreement': 'Remíza dohodou.',
  'game.resultDrawRules': 'Remíza podle pravidel.',
  'game.resultDraw': 'Remíza.',
  'game.resultResignWin': 'Soupeř se vzdal – vyhrál jsi!',
  'game.resultResignLoss': 'Vzdal ses – prohrál jsi.',
  'game.resultWin': 'Vyhrál jsi!',
  'game.resultLoss': 'Prohrál jsi.',
  // Modal: potvrzení vzdání.
  'game.resignConfirmMsg': 'Opravdu se vzdát? Partii tím prohráváš.',
  'game.resignConfirmAria': 'Opravdu se vzdát?',
  'game.resignYes': 'Ano, vzdát se',
  'game.cancel': 'Zrušit',
  // Modal: příchozí nabídka remízy.
  'game.drawOfferMsg': 'Soupeř nabízí remízu.',
  'game.drawOfferAria': 'Soupeř nabízí remízu',
  'game.acceptDraw': 'Přijmout remízu',
  'game.decline': 'Odmítnout',
  // Modal: výsledek (Odveta/Konec).
  'game.rematch': 'Odveta',
  'game.end': 'Konec',
  // Modal: čekání na odpověď na odvetu.
  'game.rematchWaitMsg': 'Nabídl jsi odvetu. Čekám na odpověď soupeře…',
  'game.rematchWaitAria': 'Čekám na odpověď soupeře na odvetu',
  // Modal: ztráta herního spojení (nouzový východ).
  'game.disconnectedMsg': 'Spojení s partií se přerušilo. Pro novou hru může být potřeba obnovit stránku.',
  'game.disconnectedAria': 'Spojení s partií se přerušilo',
  'game.backToRoom': 'Zpět do místnosti',
  // Modal: příchozí nabídka odvety.
  'game.rematchIncomingMsg': 'Soupeř chce odvetu. Barvy se prohodí.',
  'game.rematchIncomingAria': 'Soupeř nabízí odvetu',
  'game.acceptRematch': 'Přijmout odvetu',

  // Obrazovka hry proti počítači (fáze 83): úrovně soupeře, ovládání, modal vzdání,
  // výsledek/chyba do modalu, reakce počítače na nabídku remízy, hlášky zakládání.
  // Interní hodnoty úrovní (professional atd.) jdou po drátě anglicky – tady je JEN
  // zobrazovací popisek.
  'ai.level.professional': 'Profesionál',
  'ai.level.championship': 'Mistrovství',
  'ai.level.intermediate': 'Pokročilý',
  'ai.level.beginner': 'Začátečník',
  'ai.level.education': 'Výuka',
  'ai.levelAria': 'Úroveň soupeře pro novou hru',
  'ai.offerDraw': 'Remíza',
  'ai.resign': 'Vzdát se',
  'ai.newGame': 'Nová hra',
  'ai.toRoom': 'Místnosti',
  'ai.confirmResign': 'Opravdu vzdát?',
  'ai.yes': 'Ano',
  'ai.cancel': 'Zrušit',
  'ai.close': 'Zavřít',
  // Výsledek z pohledu člověka (párování humanWon v terminalMessage).
  'ai.resultWin': 'Vyhráli jste.',
  'ai.resultLoss': 'Vyhrál počítač.',
  'ai.resultDraw': 'Remíza.',
  'ai.engineError': 'Počítač hlásí chybu, partie stojí.',
  // Reakce počítače na nabídku remízy (řádek offerMsg).
  'ai.drawThinking': 'Počítač zvažuje nabídku…',
  'ai.drawDeclined': 'Počítač remízu odmítl, hrajete dál.',
  'ai.drawFailed': 'Nabídku se teď nepodařilo vyřídit, zkuste to znovu.',
  // Zakládání partie.
  'ai.loading': 'Načítám partii…',
  'ai.createFailed': 'Partii se nepodařilo založit. Zkuste to znovu tlačítkem Nová hra.',
} as const;

/** Klíč překladu – odvozený z `cs`, takže `t()` napovídá jen existující klíče. */
export type MessageKey = keyof typeof cs;

const en = {
  'app.title': 'American Checkers',

  'lobby.title': 'Game rooms',
  'lobby.nickAria': 'Nickname',
  'lobby.nickPlaceholder': 'Your nickname',
  'lobby.rosterTitle': 'Players present',
  'lobby.reconnectBtn': 'Reconnect',
  'lobby.soloHeading': 'Play against the computer',
  'lobby.soloBtn': 'Play',
  'lobby.connecting': 'Connecting to the room…',
  'lobby.you': ' (you)',
  'lobby.challengeBtn': 'Challenge',
  'lobby.challengeFrom': '{nick} challenges you to a game',
  'lobby.acceptBtn': 'Accept',
  'lobby.rejectBtn': 'Decline',
  'lobby.waitingFor': 'Waiting for a reply: {nick}…',
  'lobby.enterNick': 'Enter a nickname.',
  'lobby.disconnectedAfter': 'The connection to the room was lost.',
  'lobby.disconnectedBefore': 'Could not connect to the room (server not responding).',
  'lobby.nickTaken': 'That nickname is taken. Try “{suggestion}”.',
  'lobby.langAria': 'Language',
  'lobby.variantAria': 'Game variant against the computer',

  'lobby.loggedInAs': 'You are signed in as {nick}',
  'lobby.signIn': 'Sign in to play with people',
  'lobby.enterLobbyBtn': 'Enter',
  'lobby.hereBadge': "You're here",
  'lobby.emptyLobby': 'No one here yet',

  'lobby.nickModalTitle': 'Choose your nickname',
  'lobby.nickModalAria': 'Enter your nickname',
  'lobby.nickSaveBtn': 'Save',
  'lobby.nickCancelBtn': 'Cancel',
  'lobby.changeNick': 'Change nickname',

  'lobby.challengeModalTitle': 'Game challenge',
  'lobby.challengeModalAria': 'Incoming game challenge',

  'variant.american': 'American checkers',
  'variant.pool': 'Pool checkers',
  'variant.russian': 'Russian checkers',
  'variant.czech': 'Czech checkers',

  'itch.humanBtn': 'Play against a human',
  'itch.modalTitle': 'Human vs human is on the full version',
  'itch.modalMsg':
    'Here on itch.io only playing against the computer works. Two people playing against each other need a game server, which itch does not have – you will find it on the full version of the game.',
  'itch.modalLink': 'Open the full version',
  'itch.modalAria': 'Human vs human is on the full version',
  'itch.close': 'Close',

  'game.connecting': 'Connecting to the game…',
  'game.variantLabel': 'Variant:',
  'game.opponentLabel': 'Opponent:',
  'game.offerDraw': 'Draw',
  'game.resign': 'Resign',
  'game.turnYou': 'Your turn',
  'game.turnOpponent': "Opponent's turn",
  'game.connUnavailable': 'Connection unavailable – try again.',
  'game.drawOfferedWaiting': 'You offered a draw, waiting for your opponent…',
  'game.drawRejectedByYou': 'You declined the draw offer.',
  'game.drawRejectedByOpponent': 'Your opponent declined your draw offer.',
  'game.rematchDeclinedByOpponent': 'Your opponent declined the rematch.',
  'game.connLost': 'The connection to the game was lost.',
  'game.resultDrawAgreement': 'Draw by agreement.',
  'game.resultDrawRules': 'Draw by the rules.',
  'game.resultDraw': 'Draw.',
  'game.resultResignWin': 'Your opponent resigned – you win!',
  'game.resultResignLoss': 'You resigned – you lost.',
  'game.resultWin': 'You win!',
  'game.resultLoss': 'You lost.',
  'game.resignConfirmMsg': 'Really resign? You will lose the game.',
  'game.resignConfirmAria': 'Really resign?',
  'game.resignYes': 'Yes, resign',
  'game.cancel': 'Cancel',
  'game.drawOfferMsg': 'Your opponent offers a draw.',
  'game.drawOfferAria': 'Opponent offers a draw',
  'game.acceptDraw': 'Accept the draw',
  'game.decline': 'Decline',
  'game.rematch': 'Rematch',
  'game.end': 'End',
  'game.rematchWaitMsg': 'You offered a rematch. Waiting for your opponent…',
  'game.rematchWaitAria': 'Waiting for the opponent to respond to the rematch',
  'game.disconnectedMsg': 'The connection to the game was lost. You may need to refresh the page to start a new game.',
  'game.disconnectedAria': 'The connection to the game was lost',
  'game.backToRoom': 'Back to the room',
  'game.rematchIncomingMsg': 'Your opponent wants a rematch. Colors will be swapped.',
  'game.rematchIncomingAria': 'Opponent offers a rematch',
  'game.acceptRematch': 'Accept the rematch',

  'ai.level.professional': 'Professional',
  'ai.level.championship': 'Championship',
  'ai.level.intermediate': 'Intermediate',
  'ai.level.beginner': 'Beginner',
  'ai.level.education': 'Tutorial',
  'ai.levelAria': 'Opponent level for a new game',
  'ai.offerDraw': 'Draw',
  'ai.resign': 'Resign',
  'ai.newGame': 'New game',
  'ai.toRoom': 'Rooms',
  'ai.confirmResign': 'Really resign?',
  'ai.yes': 'Yes',
  'ai.cancel': 'Cancel',
  'ai.close': 'Close',
  'ai.resultWin': 'You won.',
  'ai.resultLoss': 'The computer won.',
  'ai.resultDraw': 'Draw.',
  'ai.engineError': 'The computer reports an error, the game is halted.',
  'ai.drawThinking': 'The computer is considering the offer…',
  'ai.drawDeclined': 'The computer declined the draw, play continues.',
  'ai.drawFailed': 'The offer could not be processed right now, please try again.',
  'ai.loading': 'Loading the game…',
  'ai.createFailed': 'The game could not be created. Try again with the New game button.',
} satisfies Record<MessageKey, string>;

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { cs, en };

/**
 * Přeloží klíč do aktivního jazyka a dosadí `{jméno}` placeholdery z `params`.
 * Nedodaný placeholder zůstane v textu doslova (`{jméno}`) – hlasitá stopa chyby,
 * ne tichá prázdná mezera.
 */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const template = MESSAGES[getLocale()][key];
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match: string, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Zobrazovací i18n klíče názvů variant. `Record<VariantId, MessageKey>` vynutí klíč
 * pro KAŽDÉ id – přidání varianty do `VariantId` bez klíče sem shodí typecheck
 * (jediný zdroj id je registr `@checkers/rules`). JEDINÝ zdroj mapy varianta→klíč
 * (dřív žila v `lobby.ts`): čtou ji picker i akordeon v lobby a názvy variant nad
 * herními deskami (fáze 107). Vzor jako `LEVEL_LABEL_KEYS` v `app-shell.ts`.
 */
const VARIANT_LABEL_KEYS: Record<VariantId, MessageKey> = {
  american: 'variant.american',
  pool: 'variant.pool',
  russian: 'variant.russian',
  czech: 'variant.czech',
};

/**
 * Přeloží název varianty do aktivního jazyka – HOLÝ název (bez prefixu), ať se dá
 * použít v pickeru `<option>` i po dosazení do věty (`game.variantLabel`). Sdílený
 * zdroj: lobby, akordeon i herní panely počítají název z JEDNÉ mapy.
 */
export function variantLabel(variant: VariantId): string {
  return t(VARIANT_LABEL_KEYS[variant]);
}

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

/** Podporované jazyky UI. Rozšíření = přidat klíč do obou slovníků níž. */
export type Locale = 'cs' | 'en';

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
    if (prefix === 'cs' || prefix === 'en') {
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

/**
 * Český slovník je ZDROJ pravdy o sadě klíčů – anglický se na něj přibíjí přes
 * `satisfies` (chybějící klíč = chyba typu). Klíče jsou ploché `oblast.název`.
 */
const cs = {
  'lobby.title': 'Herní místnost',
  'lobby.nickAria': 'Přezdívka',
  'lobby.nickPlaceholder': 'Tvoje přezdívka',
  'lobby.joinBtn': 'Vstoupit do místnosti',
  'lobby.rosterTitle': 'Přítomní hráči',
  'lobby.reconnectBtn': 'Připojit znovu',
  'lobby.soloBtn': 'Hrát proti počítači',
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
} as const;

/** Klíč překladu – odvozený z `cs`, takže `t()` napovídá jen existující klíče. */
export type MessageKey = keyof typeof cs;

const en = {
  'lobby.title': 'Game room',
  'lobby.nickAria': 'Nickname',
  'lobby.nickPlaceholder': 'Your nickname',
  'lobby.joinBtn': 'Enter the room',
  'lobby.rosterTitle': 'Players present',
  'lobby.reconnectBtn': 'Reconnect',
  'lobby.soloBtn': 'Play against the computer',
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

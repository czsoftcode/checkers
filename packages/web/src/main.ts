/**
 * Vstupní bod webového klienta a PŘEPÍNAČ obrazovek (lobby ↔ hra ↔ sólo deska).
 *
 * Úvod je MÍSTNOST ({@link createLobby}): hráč zadá přezdívku a vidí přítomné.
 * Odsud vedou dvě cesty:
 *  - „Hrát proti počítači" → dnešní sólo deska ({@link createAppShell}). Sólo je
 *    NEZÁVISLÉ na místnosti, takže se lobby `dispose`ne (a s ním zavře room WS).
 *    Z desky se tlačítkem „Do místnosti" vrátí do čerstvého lobby.
 *  - přijetí výzvy → PvP herní obrazovka ({@link createGameScreen}). Tady lobby
 *    NEsmí `dispose`nout: fáze 70 posílá PvP tahy po ROOM WS a partie je na serveru
 *    navázaná na session id živého spojení. Lobby proto zůstává naživu (jen se
 *    odpojí z DOM); „Zpět do místnosti" ho zas připojí. Room WS žije celou dobu.
 *
 * Vždy je v DOM PRÁVĚ JEDNA obrazovka. Sólo/hra jsou „přechodné" (mají
 * `transientDispose`); lobby je „trvalé" v rámci multiplayer toku (`disposeLobby`).
 */

import { resolveInitialLocale, t } from './i18n.js';
import { createAppShell } from './app-shell.js';
import { createLobby } from './lobby.js';
import { createGameScreen } from './game-screen.js';
import { createLocalClient } from './local-client.js';
import { createWebWorkerEngineWorker } from './local/engine-worker.js';
import type { ServerClient } from './server-client.js';
import type { GameLink, Lobby } from './lobby.js';
import type { ChallengeAcceptedInfo } from './room-client.js';
import './analytics.js';
import './styles.css';

// Jazyk UI: ručně uložená volba (LocalStorage) → detekce prohlížeče → fallback en
// (fáze 84). Nastavíme ho JEŠTĚ PŘED prvním vykreslením obrazovky, ať `t()` v lobby
// čte správný slovník, a přepíšeme jím statické `lang="cs"` z index.html – `<html lang>`
// má hlásit reálný jazyk stránky (přístupnost, čtečky). `resolveInitialLocale()` vrací
// reálně použitý jazyk = hodnotu atributu.
document.documentElement.lang = resolveInitialLocale();

const rootEl = document.querySelector('#app');
if (!(rootEl instanceof HTMLElement)) {
  throw new Error('Kořenový prvek #app nebyl ve stránce nalezen.');
}
// Zúžený const (HTMLElement) do closures přepínače – narrowing z `instanceof` výš
// se do těl níže deklarovaných funkcí sám nepropíše.
const root: HTMLElement = rootEl;

// Sólo deska (hra proti AI) jede CELÁ v prohlížeči přes LocalClient + reálný Web
// Worker (fáze 87/88): server AI nepočítá. JEDNA instance workeru i klienta na
// život stránky (drží se, NE per-mount+dispose), ale vytvořená LÍNĚ až při prvním
// vstupu do sóla: hráč, který jde jen do lobby nebo do PvP (worker nepoužívají),
// tak zbytečně nespouští vlákno enginu ani nenačítá jeho bundle, a kdyby konstrukce
// workeru selhala, neshodí to boot celé appky (lobby/PvP) na prázdnou stránku, jen
// sólo desku. PvP se tohohle klienta NEDOTÝKÁ: jede přes game-screen/game-socket/
// room-client (autoritativní server). `createHttpClient` tím zůstává z webu
// nevolané (jeho odstranění je mimo řez, #52).
let soloClientInstance: ServerClient | null = null;
function soloClient(): ServerClient {
  soloClientInstance ??= createLocalClient(createWebWorkerEngineWorker());
  return soloClientInstance;
}

// Trvalé lobby v rámci multiplayer toku. Přežívá přechod do PvP hry (jen se odpojí
// z DOM, room WS drží dál); `null`, jen když jsme v sólu (tam se lobby zavře).
let lobby: Lobby | null = null;
// `dispose` PŘECHODNÉ obrazovky (sólo deska / herní placeholder) nad/místo lobby.
let transientDispose: (() => void) | null = null;

/** Uklidí přechodnou obrazovku (sólo/hra), pokud nějaká běží. Lobby se netýká. */
function clearTransient(): void {
  transientDispose?.();
  transientDispose = null;
}

/** Zavře lobby (a tím room WS). Volat jen při reálném odchodu z místnosti (sólo). */
function disposeLobby(): void {
  lobby?.dispose();
  lobby = null;
}

/** Namontuje ČERSTVÉ lobby (start appky / návrat ze sóla). Zavře cokoli předchozího. */
function showLobby(): void {
  // Titulek stránky v aktuálním jazyce (fáze 84). Sem to patří, protože `showLobby`
  // je i cíl `onLocaleChange` – po přepnutí jazyka se tak přepíše i záložka prohlížeče,
  // ne jen texty v lobby. Běží i při startu (volání na konci modulu) a návratu ze sóla.
  document.title = t('app.title');
  clearTransient();
  disposeLobby(); // návrat ze sóla: staré lobby (pokud by bylo) zavřít
  const mounted = createLobby({
    onPlayVsComputer: showSolo,
    onGameStart: showGame,
    // Přepnutí jazyka (fáze 84): jazyk je už uložený + nastavený, znovupostav čerstvé
    // lobby, ať se `t()` řetězce přeloží. Bezpečné jen z `entry` view (bez živého WS),
    // proto lobby přepínač mimo `entry` skrývá.
    onLocaleChange: showLobby,
  });
  lobby = mounted;
  root.replaceChildren(mounted.element);
}

/** Namontuje sólo desku proti počítači. Odchod z místnosti → zavřít room WS. */
function showSolo(): void {
  clearTransient();
  disposeLobby(); // sólo je mimo místnost → zavři room WS
  const shell = createAppShell(soloClient(), { onExit: showLobby });
  transientDispose = () => {
    shell.dispose();
  };
  root.replaceChildren(shell.element);
}

/**
 * Přejde na PvP herní obrazovku po přijetí výzvy. Lobby ZŮSTÁVÁ naživu (room WS
 * drží PvP session i tahy – fáze 70); jen se odpojí z DOM tím, že `replaceChildren`
 * vloží herní obrazovku. „Zpět do místnosti" lobby zas připojí. `link` je most z
 * lobby k živému room WS (odeslání tahu + příjem chyb tahu); herní obrazovka ho
 * ve `dispose` odregistruje, room WS ale NEzavírá (drží ho lobby).
 */
function showGame(info: ChallengeAcceptedInfo, link: GameLink): void {
  clearTransient();
  const game = createGameScreen(info, { onBackToRoom: backToRoom, link });
  transientDispose = () => {
    game.dispose();
  };
  root.replaceChildren(game.element); // odpojí lobby.element z DOM, lobby žije dál
}

/** Návrat z herní obrazovky do místnosti: znovu připojí živé lobby (WS se nezavírá). */
function backToRoom(): void {
  clearTransient();
  if (lobby === null) {
    showLobby(); // pojistka: kdyby lobby chybělo, postav čerstvé
    return;
  }
  root.replaceChildren(lobby.element);
}

showLobby();

/**
 * Přehrávání krátkých zvukových efektů hry – zatím jen pohyb/dopad kamene, do
 * budoucna sem přibudou další (braní, proměna, konec hry). Samostatná vrstva bez
 * herní logiky a bez znalosti desky; `board-view` si ji injektuje.
 *
 * Autoplay policy: prohlížeč nepustí zvuk, dokud uživatel se stránkou
 * neinteragoval. Kámen se přitom hýbe i po tazích AI (bez bezprostředního
 * kliknutí), proto `unlock()` na PRVNÍM uživatelském gestu (klik na desku) audio
 * jednou „probudí" – od té chvíle smí hrát i po tazích enginu.
 *
 * Překrývání: `play` pokaždé vytvoří NOVÝ audio uzel, takže rychlý řetěz dopadů
 * (vícenásobný skok) předchozí zvuk nezařízne – instance se překryjí.
 */

import moveUrl from './assets/pohyb_kamene.mp3?url';
import landUrl from './assets/dopad_kamene.mp3?url';
import winUrl from './assets/vitezne_fanfary.mp3?url';
import lossUrl from './assets/zvuk_prohry.mp3?url';
import drawUrl from './assets/zvuk_remizy.mp3?url';

/**
 * Události, které umí přehrávač ozvučit.
 * - `move` – rozjezd kamene (jednou na začátku tahu),
 * - `land` – dopad kamene (na každém dopadu, i mezidopadu vícenásobného skoku),
 * - `win` – hráč vyhrál partii,
 * - `loss` – hráč prohrál partii,
 * - `draw` – partie skončila remízou.
 */
export type SoundEvent = 'move' | 'land' | 'win' | 'loss' | 'draw';

/**
 * Mapa událost → URL zvuku. Přidání dalšího zvuku je jeden řádek (a rozšíření
 * `SoundEvent`). `?url` dá díky Vite rovnou hashovanou cestu k souboru.
 */
const SOURCES: Record<SoundEvent, string> = {
  move: moveUrl,
  land: landUrl,
  win: winUrl,
  loss: lossUrl,
  draw: drawUrl,
};

/**
 * Minimální rozhraní audio uzlu, které přehrávač potřebuje. Reálně ho plní
 * `HTMLAudioElement`; v testu se injektuje fake, ať netřeba reálný zvuk.
 */
export interface SoundNode {
  volume: number;
  play(): Promise<void> | void;
}

/** Vytvoří audio uzel pro danou URL. `null` = prostředí bez `Audio` (no-op). */
export type AudioFactory = ((src: string) => SoundNode) | null;

/** Přehrávač zvuků. `unlock` odemyká autoplay, `play` přehraje událost. */
export interface SoundPlayer {
  /** Jednorázově „probudí" audio na prvním uživatelském gestu. Idempotentní. */
  unlock(): void;
  /** Přehraje zvuk dané události. No-op, když audio v prostředí není. */
  play(event: SoundEvent): void;
}

/** Výchozí továrna: reálný `Audio` uzel, nebo `null` (SSR/prostředí bez Audio). */
const defaultAudioFactory: AudioFactory =
  typeof Audio === 'function' ? (src: string): SoundNode => new Audio(src) : null;

/**
 * Zkusí přehrát a spolkne selhání: zamítnutý autoplay ani chybějící implementace
 * `play()` (jsdom) NENÍ chyba programu – zvuk je jen kosmetika. `play()` vrací
 * příslib i synchronně háže podle prostředí, proto ošetřujeme obojí.
 */
function safePlay(node: SoundNode): void {
  try {
    const result = node.play();
    if (result !== undefined && typeof result.catch === 'function') {
      result.catch(() => undefined);
    }
  } catch {
    // Prostředí bez funkčního play() – tiše ignoruj.
  }
}

/**
 * Vytvoří přehrávač. Bez dostupného `Audio` (`audioFactory === null`) jsou
 * `play` i `unlock` bezpečné no-opy. `audioFactory` jde injektovat kvůli testu.
 */
export function createSoundPlayer(
  audioFactory: AudioFactory = defaultAudioFactory,
): SoundPlayer {
  if (audioFactory === null) {
    return { unlock: () => undefined, play: () => undefined };
  }
  const factory = audioFactory;

  let unlocked = false;

  return {
    unlock: () => {
      if (unlocked) {
        return;
      }
      unlocked = true;
      // Probuď audio ještě v rámci gestu: přehraj ztlumeně. Prohlížeč si tím
      // „zapamatuje" povolení a další (i AI) tahy už smějí znít.
      const node = factory(SOURCES.move);
      node.volume = 0;
      safePlay(node);
    },
    play: (event) => {
      const src = SOURCES[event];
      if (src === undefined) {
        return; // neznámá událost – nic nepřehrávej (obrana proti rozšíření typu)
      }
      // Nový uzel pokaždé → překrývající se dopady se navzájem nezaříznou.
      safePlay(factory(src));
    },
  };
}

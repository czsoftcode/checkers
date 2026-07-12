// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { initLocale } from '../src/i18n.js';
import { createLobby } from '../src/lobby.js';
import type { RoomWebSocket } from '../src/room-client.js';

/**
 * Svislý průřez: jazyk z `navigator.languages` → REÁLNÝ `createLobby` vykreslí
 * příslušný slovník. Nejde o mock `t()`, ale o skutečnou cestu detekce → render.
 * Zuby: kdyby lobby ukazovalo na špatný klíč nebo chyběl anglický překlad,
 * anglický (resp. fallback) assert spadne.
 *
 * Testujeme jen VSTUPNÍ pohled (`entry`) – ten nevyžaduje připojení, takže mount se
 * spokojí s neúčinným fake socketem, který se nikdy neotevře (žádný join → žádný
 * connect-timer k úklidu).
 */

/** Fake socketu, který nic nedělá – vstupní pohled se nepřipojuje. */
class InertSocket implements RoomWebSocket {
  readonly readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send(): void {
    // no-op
  }
  close(): void {
    // no-op
  }
}

/** Podvrhne prohlížeči seznam jazyků (vlastní property zastíní getter jsdom). */
function setBrowserLanguages(languages: readonly string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
}

const mounted: { dispose(): void }[] = [];

/** Namontuje lobby POTÉ, co je nastavený jazyk – tak, jak to dělá bootstrap. */
function mountEntry() {
  const lobby = createLobby({
    onPlayVsComputer: () => undefined,
    onGameStart: () => undefined,
    onLocaleChange: () => undefined,
    roomUrl: 'ws://test/room/ws',
    socketFactory: () => new InertSocket(),
  });
  mounted.push(lobby);
  const el = lobby.element;
  const text = (sel: string): string => el.querySelector(sel)?.textContent ?? '';
  const placeholder = (sel: string): string =>
    el.querySelector<HTMLInputElement>(sel)?.placeholder ?? '';
  return { text, placeholder };
}

afterEach(() => {
  for (const l of mounted) {
    l.dispose();
  }
  mounted.length = 0;
  // Přepočti aktivní jazyk z aktuálního `navigator` (mezi soubory izoluje vitest;
  // uvnitř souboru si každý test stejně nastaví `languages` sám před initLocale).
  initLocale();
});

describe('lobby – jazyk podle prohlížeče', () => {
  it('navigator.languages=[cs] → česky', () => {
    setBrowserLanguages(['cs-CZ']);
    initLocale();
    const h = mountEntry();
    expect(h.text('.lobby-title')).toBe('Herní místnosti');
    // Tlačítko „Uložit" v modalu přezdívky (fáze 108, dřív „Vstoupit do místnosti").
    expect(h.text('.lobby-nick-save-btn')).toBe('Uložit');
    expect(h.text('.lobby-solo-btn')).toBe('Hrát proti počítači');
    expect(h.placeholder('.lobby-nick')).toBe('Tvoje přezdívka');
  });

  it('navigator.languages=[en] → anglicky', () => {
    setBrowserLanguages(['en-US']);
    initLocale();
    const h = mountEntry();
    expect(h.text('.lobby-title')).toBe('Game rooms');
    expect(h.text('.lobby-nick-save-btn')).toBe('Save');
    expect(h.text('.lobby-solo-btn')).toBe('Play against the computer');
    expect(h.placeholder('.lobby-nick')).toBe('Your nickname');
  });

  it('navigator.languages=[de] → fallback anglicky', () => {
    setBrowserLanguages(['de-DE']);
    initLocale();
    const h = mountEntry();
    expect(h.text('.lobby-title')).toBe('Game rooms');
    expect(h.text('.lobby-solo-btn')).toBe('Play against the computer');
  });
});

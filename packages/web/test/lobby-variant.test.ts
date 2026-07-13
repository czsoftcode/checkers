// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '../src/i18n.js';
import { createLobby } from '../src/lobby.js';
import type { RoomWebSocket } from '../src/room-client.js';

/** Minimální fake socketu, ať se nesahá na reálný WS (lobby jede přes room-client). */
class FakeSocket implements RoomWebSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(): void {
    // no-op: picker testy neposílají po WS, jen ověřují výběr varianty
  }
  close(): void {
    this.readyState = 3;
  }
}

const active: { dispose(): void }[] = [];

function mount() {
  const onPlayVsComputer = vi.fn<(variant: string) => void>();
  const lobby = createLobby({
    onPlayVsComputer,
    onGameStart: vi.fn(),
    onLocaleChange: vi.fn(),
    roomUrl: 'ws://test/room/ws',
    socketFactory: (url) => new FakeSocket(url),
  });
  active.push(lobby);
  document.body.append(lobby.element);
  const picker = lobby.element.querySelector<HTMLSelectElement>('.lobby-variant');
  const solo = lobby.element.querySelector<HTMLButtonElement>('.lobby-solo-btn');
  if (picker === null || solo === null) {
    throw new Error('picker nebo solo tlačítko nenalezeno');
  }
  return { onPlayVsComputer, picker, solo };
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  setLocale('cs');
});
afterEach(() => {
  for (const l of active) {
    l.dispose();
  }
  active.length = 0;
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('lobby – picker varianty sólo hry', () => {
  it('nabízí pět variant registru (vč. italské), výchozí americká', () => {
    const { picker } = mount();
    expect(Array.from(picker.options).map((o) => o.value)).toEqual([
      'american',
      'pool',
      'russian',
      'czech',
      'italian',
    ]);
    expect(picker.value).toBe('american');
  });

  it('popisky option odpovídají SPRÁVNÉ variantě (chytí prohozený i18n klíč v lobby mapě)', () => {
    // cs (beforeEach). Teeth pro cross-module i18n mapování: kdyby VARIANT_LABEL_KEYS
    // v lobby.ts mapovalo např. russian → 'variant.czech' (oba platné MessageKey,
    // typecheck projde), tenhle assert to chytí – testuje reálné popisky z lobby.
    const labels = Object.fromEntries(
      Array.from(mount().picker.options).map((o) => [o.value, o.textContent]),
    );
    expect(labels.american).toBe('Americká dáma');
    expect(labels.pool).toBe('Pool dáma');
    expect(labels.russian).toBe('Ruská dáma');
    expect(labels.czech).toBe('Česká dáma');
    expect(labels.italian).toBe('Italská dáma');
  });

  it('předvyplní naposledy uloženou variantu z LocalStorage', () => {
    localStorage.setItem('checkers.variant', 'russian');
    const { picker } = mount();
    expect(picker.value).toBe('russian');
  });

  it('klik na sólo předá ZVOLENOU variantu a uloží ji do LocalStorage', () => {
    const { onPlayVsComputer, picker, solo } = mount();
    picker.value = 'czech';
    click(solo);
    expect(onPlayVsComputer).toHaveBeenCalledWith('czech');
    expect(localStorage.getItem('checkers.variant')).toBe('czech');
  });

  it('neznámá uložená hodnota spadne na americkou (nedůvěřuje úložišti)', () => {
    localStorage.setItem('checkers.variant', 'brazilian');
    const { picker } = mount();
    expect(picker.value).toBe('american');
  });
});

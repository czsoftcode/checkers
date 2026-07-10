// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '../src/i18n.js';
import { createLobby } from '../src/lobby.js';
import type { GameLink } from '../src/lobby.js';
import type { ChallengeAcceptedInfo } from '../src/room-client.js';

/**
 * Itch větev lobby (fáze 89): AI-only. Klíčový kontrakt – v itch módu se ROOM WS
 * NIKDY neotevře (server je na itch mrtvý), místo formuláře přezdívky je tlačítko
 * „hrát s člověkem" → modal s odkazem ven; „hrát proti počítači" funguje dál.
 *
 * Room WS test hlídá přes `socketFactory` spy: v itch módu se createRoomClient vůbec
 * nevolá, takže tovární funkce socketu NESMÍ padnout ani po interakci s tlačítky.
 */

const active: { dispose(): void }[] = [];

function mountItch(overrides?: { itchMode?: boolean; siteUrl?: string }) {
  const onPlayVsComputer = vi.fn();
  const onGameStart = vi.fn<(info: ChallengeAcceptedInfo, link: GameLink) => void>();
  const onLocaleChange = vi.fn();
  const socketFactory = vi.fn(() => {
    throw new Error('socketFactory nesmí být v itch módu vůbec zavolána (žádný room WS)');
  });
  const lobby = createLobby({
    onPlayVsComputer,
    onGameStart,
    onLocaleChange,
    itchMode: overrides?.itchMode ?? true,
    siteUrl: overrides?.siteUrl ?? 'dama.softcode.cz',
    roomUrl: 'ws://test/room/ws',
    socketFactory,
  });
  active.push(lobby);
  document.body.append(lobby.element);
  const el = lobby.element;
  const q = <T extends HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
  return { onPlayVsComputer, onLocaleChange, socketFactory, lobby, el, q };
}

beforeEach(() => {
  setLocale('cs');
});
afterEach(() => {
  while (active.length > 0) {
    active.pop()!.dispose();
  }
  document.body.replaceChildren();
});

describe('lobby – itch mód', () => {
  it('nerenderuje formulář přezdívky ani room seznam, jen tlačítka', () => {
    const h = mountItch();
    expect(h.q('.lobby-join')).toBeNull();
    expect(h.q('.lobby-nick')).toBeNull();
    expect(h.q('.lobby-room')).toBeNull();
    expect(h.q<HTMLButtonElement>('.lobby-human-btn')).not.toBeNull();
    expect(h.q<HTMLButtonElement>('.lobby-solo-btn')).not.toBeNull();
  });

  it('NIKDY neotevře room WS (socketFactory se nevolá ani po kliku na tlačítka)', () => {
    const h = mountItch();
    h.q<HTMLButtonElement>('.lobby-human-btn')!.click();
    h.q<HTMLButtonElement>('.lobby-solo-btn')!.click();
    expect(h.socketFactory).not.toHaveBeenCalled();
  });

  it('„hrát s člověkem" otevře modal s odkazem na živou verzi (se schématem https)', () => {
    const h = mountItch({ siteUrl: 'dama.softcode.cz' });
    const modal = h.q<HTMLElement>('.modal-overlay')!;
    expect(modal.classList.contains('hidden')).toBe(true);
    h.q<HTMLButtonElement>('.lobby-human-btn')!.click();
    expect(modal.classList.contains('hidden')).toBe(false);
    const link = h.q<HTMLAnchorElement>('.modal-link')!;
    expect(link.getAttribute('href')).toBe('https://dama.softcode.cz');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  it('adresu se schématem nechá být', () => {
    const h = mountItch({ siteUrl: 'https://example.test/hra' });
    h.q<HTMLButtonElement>('.lobby-human-btn')!.click();
    expect(h.q<HTMLAnchorElement>('.modal-link')!.getAttribute('href')).toBe(
      'https://example.test/hra',
    );
  });

  it('bez nastavené URL modal odkaz vůbec nevykreslí (raději žádný než mrtvý)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = mountItch({ siteUrl: '' });
    h.q<HTMLButtonElement>('.lobby-human-btn')!.click();
    expect(h.q('.modal-link')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('modal jde zavřít tlačítkem Zavřít', () => {
    const h = mountItch();
    const modal = h.q<HTMLElement>('.modal-overlay')!;
    h.q<HTMLButtonElement>('.lobby-human-btn')!.click();
    expect(modal.classList.contains('hidden')).toBe(false);
    h.q<HTMLButtonElement>('.modal-close-btn')!.click();
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('modal jde zavřít klávesou Esc', () => {
    const h = mountItch();
    const modal = h.q<HTMLElement>('.modal-overlay')!;
    h.q<HTMLButtonElement>('.lobby-human-btn')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('„hrát proti počítači" zavolá onPlayVsComputer (sólo cesta funguje dál)', () => {
    const h = mountItch();
    h.q<HTMLButtonElement>('.lobby-solo-btn')!.click();
    expect(h.onPlayVsComputer).toHaveBeenCalledTimes(1);
  });
});

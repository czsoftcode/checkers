// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '../src/i18n.js';
import { createLobby } from '../src/lobby.js';
import type { RoomWebSocket } from '../src/room-client.js';
import { createInProcessEngineWorker } from '../src/local/engine-worker.js';
import { createLocalClient } from '../src/local-client.js';
import { mulberry32 } from '../src/local/prng.js';
import { makeClock, pollUntilSettled } from './local/helpers.js';

/**
 * IT-11 verify: přepnutí varianty NA/Z italské je GENERICKÝ mechanismus (fáze 102),
 * ne italsky-specifická cesta. Doplňuje italskou hodnotu do dvou generických os:
 *  1) volba varianty v LocalStorage (`checkers.variant`) přežije „restart" (remount
 *     lobby), default american;
 *  2) „přepnutí zahodí rozehranou partii a začne novou" plyne z VÝMĚNY LocalClienta
 *     v `main.ts` (nový klient = nový obchod partií), ne z přepínání varianty za běhu.
 */

// Minimální fake socketu, ať se nesahá na reálný WS (lobby jede přes room-client).
class FakeSocket implements RoomWebSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(): void {
    // no-op
  }
  close(): void {
    this.readyState = 3;
  }
}

const active: { dispose(): void }[] = [];

function mountLobby() {
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

describe('italská – volba varianty v LocalStorage (přežije restart)', () => {
  it('klik na sólo s italskou ji předá a uloží do checkers.variant', () => {
    const { onPlayVsComputer, picker, solo } = mountLobby();
    picker.value = 'italian';
    click(solo);
    expect(onPlayVsComputer).toHaveBeenCalledWith('italian');
    expect(localStorage.getItem('checkers.variant')).toBe('italian');
  });

  it('uložená italská se po „restartu" (nové lobby) předvybere – reálný round-trip', () => {
    // 1. sezení: hráč zvolí italskou a spustí sólo → volba se uloží.
    const first = mountLobby();
    first.picker.value = 'italian';
    click(first.solo);
    expect(localStorage.getItem('checkers.variant')).toBe('italian');
    // 2. sezení: čerstvé lobby (simulace restartu stránky) předvybere volbu z úložiště.
    const second = mountLobby();
    expect(second.picker.value).toBe('italian');
  });

  it('bez uložené volby je default american (ne italská)', () => {
    const { picker } = mountLobby();
    expect(picker.value).toBe('american');
  });
});

describe('italská – nový LocalClient = nezávislý obchod partií (invariant, na kterém stojí zahození)', () => {
  // ROZSAH TOHOTO BLOKU (poctivě): NEtestuje wiring `main.ts showSolo` (ten při
  // přepnutí varianty zakládá čerstvý klient + disposne starou obrazovku) – main.ts
  // je vstupní bod (běží při importu, `soloWorker()` napevno volá Web Worker), a žádný
  // test ho neimportuje. Zde ověřujeme jen INVARIANT, na kterém to zahození stojí:
  // dva klienti různých variant mají oddělené obchody partií, takže „přepnout variantu
  // = založit nový klient" nutně znamená novou partii (stará je nedosažitelná). Že
  // showSolo tenhle invariant opravdu uplatní (přepnutí v reálné appce zahodí partii),
  // patří do ŽIVÉ kontroly v prohlížeči (human-eye) – viz report `verify`.
  function makeClient(variant: 'american' | 'italian') {
    return createLocalClient(createInProcessEngineWorker({ now: makeClock() }), {
      rng: mulberry32(0x5151_0101),
      seed: () => 0x1234_abcd,
      timeMs: 1,
      now: makeClock(),
      variant,
    });
  }

  it('přepnutí Z italské na americkou: nový klient nezná starou italskou partii a začne čerstvou', async () => {
    // Rozehraná italská partie.
    const italian = makeClient('italian');
    let it = await italian.createGame('beginner', 'black');
    const itMove = it.legalMoves[0];
    if (itMove === undefined) {
      throw new Error('výchozí italská pozice nemá legální tah');
    }
    it = await italian.postMove(it.id, itMove.from, itMove.path);
    await pollUntilSettled(italian, it.id);
    const oldId = it.id;

    // Model přepnutí: založ ČERSTVÝ LocalClient druhé varianty (co dělá showSolo).
    const american = makeClient('american');
    // Invariant: stará italská partie je pro nový klient nedosažitelná (oddělený obchod).
    // (Že showSolo tenhle nový klient při přepnutí opravdu založí, ověří live kontrola.)
    await expect(american.getGame(oldId)).rejects.toMatchObject({ code: 'game_not_found' });
    // Nová partie startuje čerstvá a v nové variantě.
    const fresh = await american.createGame('beginner', 'black');
    expect(fresh.variant).toBe('american');
    expect(fresh.result).toBe('ongoing');
    expect(fresh.id).not.toBe(oldId);
  });

  it('přepnutí NA italskou z americké: nová partie je italská a čerstvá, stará zahozená', async () => {
    const american = makeClient('american');
    let us = await american.createGame('beginner', 'black');
    const usMove = us.legalMoves[0];
    if (usMove === undefined) {
      throw new Error('výchozí americká pozice nemá legální tah');
    }
    us = await american.postMove(us.id, usMove.from, usMove.path);
    await pollUntilSettled(american, us.id);
    const oldId = us.id;

    const italian = makeClient('italian');
    await expect(italian.getGame(oldId)).rejects.toMatchObject({ code: 'game_not_found' });
    const fresh = await italian.createGame('beginner', 'black');
    expect(fresh.variant).toBe('italian');
    expect(fresh.result).toBe('ongoing');
  });
});

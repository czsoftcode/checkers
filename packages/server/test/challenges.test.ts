/**
 * Unit testy registru výzev (fáze 68) – čistá logika životního cyklu výzvy BEZ
 * WS. Fixuje pravidla z diskuse: sebe-výzva, busy na obou stranách, jedna výzva
 * na dvojici (dvojitá i křížová), přijetí spáruje a zruší ostatní výzvy obou,
 * odchod uvolní busy a zruší výzvy hráče.
 *
 * Zuby: každý test popisuje vstup, který větev spustí; kdyby pravidlo zmizelo
 * (např. dedup dvojice), vznikly by dvě výzvy / dvě partie a assert padne.
 */

import { describe, expect, it } from 'vitest';
import { ChallengeRegistry } from '../src/index.js';

describe('ChallengeRegistry – vytvoření výzvy', () => {
  it('platná výzva se zapíše a nese oba hráče', () => {
    const reg = new ChallengeRegistry();
    const r = reg.create('A', 'B');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.challenge.challengerId).toBe('A');
    expect(r.challenge.challengedId).toBe('B');
    expect(reg.pendingCount()).toBe(1);
  });

  it('sebe-výzva → rejected, nic se nezapíše', () => {
    const reg = new ChallengeRegistry();
    const r = reg.create('A', 'A');
    expect(r.status).toBe('rejected');
    expect(reg.pendingCount()).toBe(0);
  });

  it('výzva na busy hráče → rejected (vyzvaný už hraje)', () => {
    const reg = new ChallengeRegistry();
    // A a B se spárují → oba busy.
    const first = reg.create('A', 'B');
    if (first.status !== 'ok') throw new Error('setup');
    reg.accept('B', first.challenge.id);
    // C zkusí vyzvat B (busy) → rejected.
    expect(reg.create('C', 'B').status).toBe('rejected');
    // A busy zkusí vyzvat C → rejected (vyzyvatel už hraje).
    expect(reg.create('A', 'C').status).toBe('rejected');
  });

  it('dvojitá výzva (A→B dvakrát) → druhá rejected', () => {
    const reg = new ChallengeRegistry();
    expect(reg.create('A', 'B').status).toBe('ok');
    expect(reg.create('A', 'B').status).toBe('rejected');
    expect(reg.pendingCount()).toBe(1);
  });

  it('křížová výzva (A→B a zároveň B→A) → druhá rejected', () => {
    const reg = new ChallengeRegistry();
    expect(reg.create('A', 'B').status).toBe('ok');
    expect(reg.create('B', 'A').status).toBe('rejected');
    expect(reg.pendingCount()).toBe(1);
  });

  it('A smí mít výzvy na různé hráče současně', () => {
    const reg = new ChallengeRegistry();
    expect(reg.create('A', 'B').status).toBe('ok');
    expect(reg.create('A', 'C').status).toBe('ok');
    expect(reg.pendingCount()).toBe(2);
  });
});

describe('ChallengeRegistry – přijetí', () => {
  it('přijetí vyzvaným spáruje dvojici, oba busy, výzva zmizí', () => {
    const reg = new ChallengeRegistry();
    const c = reg.create('A', 'B');
    if (c.status !== 'ok') throw new Error('setup');
    const r = reg.accept('B', c.challenge.id);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.challenge.challengerId).toBe('A');
    expect(reg.isBusy('A')).toBe(true);
    expect(reg.isBusy('B')).toBe(true);
    expect(reg.pendingCount()).toBe(0);
  });

  it('přijmout smí JEN vyzvaný – vyzyvatel dostane gone', () => {
    const reg = new ChallengeRegistry();
    const c = reg.create('A', 'B');
    if (c.status !== 'ok') throw new Error('setup');
    expect(reg.accept('A', c.challenge.id).status).toBe('gone'); // A je vyzyvatel
    expect(reg.pendingCount()).toBe(1); // výzva pořád čeká
  });

  it('přijetí neznámé výzvy → gone', () => {
    const reg = new ChallengeRegistry();
    expect(reg.accept('B', 'neexistuje').status).toBe('gone');
  });

  it('spárování zruší VEDLEJŠÍ výzvy obou hráčů a vrátí je (protějšky se uvědomí)', () => {
    const reg = new ChallengeRegistry();
    // A→B (bude přijata), A→C a D→B (vedlejší, mají zaniknout).
    const ab = reg.create('A', 'B');
    reg.create('A', 'C');
    reg.create('D', 'B');
    if (ab.status !== 'ok') throw new Error('setup');
    const r = reg.accept('B', ab.challenge.id);
    if (r.status !== 'ok') throw new Error('accept měl uspět');
    // Zrušené vedlejší výzvy: A→C a D→B.
    const pairs = r.cancelled.map((c) => `${c.challengerId}->${c.challengedId}`).sort();
    expect(pairs).toEqual(['A->C', 'D->B']);
    expect(reg.pendingCount()).toBe(0); // nic nezůstalo viset
  });
});

describe('ChallengeRegistry – odmítnutí', () => {
  it('odmítnutí vyzvaným výzvu zruší a vrátí ji (vyzyvatel se uvědomí)', () => {
    const reg = new ChallengeRegistry();
    const c = reg.create('A', 'B');
    if (c.status !== 'ok') throw new Error('setup');
    const r = reg.reject('B', c.challenge.id);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.challenge.challengerId).toBe('A');
    expect(reg.pendingCount()).toBe(0);
    expect(reg.isBusy('A')).toBe(false); // odmítnutí NEdělá busy
    expect(reg.isBusy('B')).toBe(false);
  });

  it('odmítnout smí jen vyzvaný; cizí/neznámé → gone', () => {
    const reg = new ChallengeRegistry();
    const c = reg.create('A', 'B');
    if (c.status !== 'ok') throw new Error('setup');
    expect(reg.reject('A', c.challenge.id).status).toBe('gone'); // A je vyzyvatel
    expect(reg.reject('B', 'neexistuje').status).toBe('gone');
    expect(reg.pendingCount()).toBe(1);
  });
});

describe('ChallengeRegistry – odchod hráče', () => {
  it('odchod zruší všechny výzvy hráče (vyzyvatele i vyzvaného) a vrátí je', () => {
    const reg = new ChallengeRegistry();
    reg.create('A', 'B'); // A vyzyvatel
    reg.create('C', 'A'); // A vyzvaný
    reg.create('C', 'D'); // A se netýká
    const cancelled = reg.removePlayer('A');
    const pairs = cancelled.map((c) => `${c.challengerId}->${c.challengedId}`).sort();
    expect(pairs).toEqual(['A->B', 'C->A']);
    expect(reg.pendingCount()).toBe(1); // C→D zůstalo
  });

  it('odchod uvolní busy stav (jediné místo, kde se v tomto řezu ruší)', () => {
    const reg = new ChallengeRegistry();
    const c = reg.create('A', 'B');
    if (c.status !== 'ok') throw new Error('setup');
    reg.accept('B', c.challenge.id);
    expect(reg.isBusy('A')).toBe(true);
    reg.removePlayer('A');
    expect(reg.isBusy('A')).toBe(false);
    // Po odchodu A ho lze zas vyzvat (B je pořád busy, ale C→A projde).
    expect(reg.create('C', 'A').status).toBe('ok');
  });

  it('odchod neznámého hráče je no-op (idempotence na close)', () => {
    const reg = new ChallengeRegistry();
    expect(reg.removePlayer('nikdo')).toEqual([]);
  });
});

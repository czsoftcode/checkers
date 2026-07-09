/**
 * Unit testy úložiště: evidence odehraných tahů a příznak `archived`.
 * Bez těchhle dvou věcí nejde sestavit archivní PDN (fáze 23), proto se
 * fixují přímo na reálném `GameStore`, ne na mocku.
 */

import { describe, expect, it } from 'vitest';

import { legalMoves } from '@checkers/rules';
import type { Move } from '@checkers/rules';
import { GameStore, effectiveResult } from '../src/index.js';

/** Odehraje na store první legální tah aktuální pozice a vrátí ho. */
function playFirstLegal(store: GameStore, id: string): Move {
  const record = store.get(id);
  if (record === undefined) {
    throw new Error('partie zmizela');
  }
  const move = legalMoves(record.state.position)[0];
  if (move === undefined) {
    throw new Error('žádný legální tah');
  }
  store.applyMove(id, move);
  return move;
}

describe('GameStore – úroveň partie', () => {
  it('create() bez argumentu → výchozí Profesionál', () => {
    const store = new GameStore();
    expect(store.create().level).toBe('professional');
  });

  it('create("beginner") uloží úroveň a ta přežije applyMove i get', () => {
    const store = new GameStore();
    const { id, level } = store.create('beginner');
    expect(level).toBe('beginner');
    playFirstLegal(store, id);
    // get() vrací union (engine | pvp); zúžení přes `mode` je nutné, ať se čte
    // `level` jen na engine variantě (PvP partie žádnou úroveň nemá).
    const rec = store.get(id);
    if (rec?.mode !== 'engine') {
      throw new Error('čekal jsem engine partii');
    }
    expect(rec.level).toBe('beginner');
  });
});

describe('GameStore – historie tahů', () => {
  it('nová partie nemá žádné tahy a není archivovaná', () => {
    const store = new GameStore();
    const rec = store.create();
    expect(rec.moves).toEqual([]);
    expect(rec.archived).toBe(false);
  });

  it('applyMove ukládá tahy v pořadí, jak byly zahrány', () => {
    const store = new GameStore();
    const { id } = store.create();
    const m1 = playFirstLegal(store, id);
    const m2 = playFirstLegal(store, id);
    const m3 = playFirstLegal(store, id);

    const rec = store.get(id);
    expect(rec?.moves).toEqual([m1, m2, m3]);
  });

  it('applyMove neexistující partie nic nepřidá (vrací undefined)', () => {
    const store = new GameStore();
    const move: Move = { from: 11, path: [15], captures: [] };
    expect(store.applyMove('neexistuje', move)).toBeUndefined();
  });
});

describe('GameStore – markArchived (právě jednou)', () => {
  it('poprvé překlopí na true, podruhé už vrací false', () => {
    const store = new GameStore();
    const { id } = store.create();
    expect(store.markArchived(id)).toBe(true);
    expect(store.markArchived(id)).toBe(false);
    expect(store.get(id)?.archived).toBe(true);
  });

  it('neexistující partie → false', () => {
    const store = new GameStore();
    expect(store.markArchived('neexistuje')).toBe(false);
  });
});

describe('GameStore – vzdání (forcedResult)', () => {
  it('nová partie nemá vynucený výsledek a je ongoing', () => {
    const store = new GameStore();
    const rec = store.create();
    expect(rec.forcedResult).toBeNull();
    expect(effectiveResult(rec)).toBe('ongoing');
  });

  it('resign nastaví white-wins a efektivní výsledek se překlopí', () => {
    const store = new GameStore();
    const { id } = store.create();
    const rec = store.resign(id);
    expect(rec).not.toBe('not-found');
    expect(rec).not.toBe('already-over');
    if (rec === 'not-found' || rec === 'already-over') {
      throw new Error('resign měl uspět');
    }
    expect(rec.forcedResult).toBe('white-wins');
    expect(effectiveResult(rec)).toBe('white-wins');
    // vynucený výsledek nemění stav pravidel – pozice zůstává rozehraná
    expect(rec.state.position.turn).toBe('black');
  });

  it('resign u obrácené barvy (člověk bílý) → black-wins, ne white-wins', () => {
    // Zuby: kdyby resign zůstal natvrdo na white-wins, tenhle test padne –
    // člověk bílý se vzdá → vyhrává engine (černý) → black-wins.
    const store = new GameStore();
    const { id } = store.create('professional', 'white');
    const rec = store.resign(id);
    if (rec === 'not-found' || rec === 'already-over') {
      throw new Error('resign měl uspět');
    }
    expect(rec.humanColor).toBe('white');
    expect(rec.forcedResult).toBe('black-wins');
    expect(effectiveResult(rec)).toBe('black-wins');
  });

  it('resign u výchozí barvy (člověk černý) → white-wins', () => {
    const store = new GameStore();
    const { id } = store.create('professional', 'black');
    const rec = store.resign(id);
    if (rec === 'not-found' || rec === 'already-over') {
      throw new Error('resign měl uspět');
    }
    expect(rec.forcedResult).toBe('white-wins');
  });

  it('create() bez barvy → humanColor "black" (zpětná kompatibilita)', () => {
    const store = new GameStore();
    expect(store.create().humanColor).toBe('black');
  });

  it('druhé vzdání už vrací "already-over" a výsledek se nemění', () => {
    const store = new GameStore();
    const { id } = store.create();
    store.resign(id);
    expect(store.resign(id)).toBe('already-over');
    expect(store.get(id)?.forcedResult).toBe('white-wins');
  });

  it('vzdání neexistující partie → "not-found"', () => {
    const store = new GameStore();
    expect(store.resign('neexistuje')).toBe('not-found');
  });

  it('effectiveResult bez vynuceného výsledku plyne z pozice (ongoing)', () => {
    const store = new GameStore();
    const rec = store.create();
    // forcedResult === null → efektivní výsledek = gameResultFromState
    expect(effectiveResult({ forcedResult: null, state: rec.state })).toBe('ongoing');
  });
});

describe('GameStore – přijetí remízy (acceptDraw)', () => {
  it('acceptDraw nastaví draw a efektivní výsledek se překlopí', () => {
    const store = new GameStore();
    const { id } = store.create();
    const rec = store.acceptDraw(id);
    if (rec === 'not-found' || rec === 'already-over') {
      throw new Error('acceptDraw měl uspět');
    }
    expect(rec.forcedResult).toBe('draw');
    expect(effectiveResult(rec)).toBe('draw');
    // vynucený výsledek nemění stav pravidel – pozice zůstává rozehraná
    expect(rec.state.position.turn).toBe('black');
  });

  it('druhé přijetí už vrací "already-over" a výsledek se nemění', () => {
    const store = new GameStore();
    const { id } = store.create();
    store.acceptDraw(id);
    expect(store.acceptDraw(id)).toBe('already-over');
    expect(store.get(id)?.forcedResult).toBe('draw');
  });

  it('přijetí už vzdané partie → "already-over" (draw nepřepíše white-wins)', () => {
    const store = new GameStore();
    const { id } = store.create();
    store.resign(id);
    expect(store.acceptDraw(id)).toBe('already-over');
    expect(store.get(id)?.forcedResult).toBe('white-wins');
  });

  it('přijetí neexistující partie → "not-found"', () => {
    const store = new GameStore();
    expect(store.acceptDraw('neexistuje')).toBe('not-found');
  });
});

describe('GameStore – PvP partie (createPvp, fáze 68)', () => {
  it('createPvp naváže oba hráče: vyzyvatel černá, vyzvaný bílá, výchozí pozice', () => {
    const store = new GameStore();
    const rec = store.createPvp('vyzyvatel-id', 'vyzvany-id');
    expect(rec.mode).toBe('pvp');
    expect(rec.players).toEqual({ black: 'vyzyvatel-id', white: 'vyzvany-id' });
    // Americká dáma: černý (= vyzyvatel) táhne první, výchozí rozestavění.
    expect(rec.state.position.turn).toBe('black');
    expect(rec.moves).toEqual([]);
    expect(rec.forcedResult).toBeNull();
    expect(effectiveResult(rec)).toBe('ongoing');
  });

  it('get() vrátí založenou PvP partii se stejnou vazbou hráčů', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    const got = store.get(id);
    if (got?.mode !== 'pvp') {
      throw new Error('čekal jsem PvP partii z get()');
    }
    expect(got.players).toEqual({ black: 'A', white: 'B' });
  });

  it('dvě createPvp mají různá id (nezávislé partie)', () => {
    const store = new GameStore();
    const a = store.createPvp('A', 'B');
    const b = store.createPvp('C', 'D');
    expect(a.id).not.toBe(b.id);
  });

  it('resign/acceptDraw (engine cesta) na PvP partii hlasitě throwuje', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    // Engine cesty vzdání/remízy nesmí tiše obsloužit PvP partii; PvP má vlastní
    // metody (resignPvp/…). Zub: kdyby guard zmizel, opposite(undefined) by dal nesmysl.
    expect(() => store.resign(id)).toThrow(/PvP/);
    expect(() => store.acceptDraw(id)).toThrow(/PvP/);
  });
});

describe('GameStore – PvP vzdání (resignPvp, fáze 77)', () => {
  it('neexistující partie → not-found', () => {
    const store = new GameStore();
    expect(store.resignPvp('neni', 'A')).toBe('not-found');
  });

  it('session mimo hráče → not-participant (stav se nemění)', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    expect(store.resignPvp(id, 'cizi')).toBe('not-participant');
    const rec = store.get(id);
    expect(rec && effectiveResult(rec)).toBe('ongoing');
  });

  it('vzdá se černý (vyzyvatel) → vyhrává bílý', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    const rec = store.resignPvp(id, 'A');
    if (rec === 'not-found' || rec === 'not-participant' || rec === 'already-over') {
      throw new Error(`čekal jsem záznam, dostal ${rec}`);
    }
    expect(rec.forcedResult).toBe('white-wins');
    expect(effectiveResult(rec)).toBe('white-wins');
  });

  it('vzdá se bílý (vyzvaný) → vyhrává černý (barva se bere z players, ne natvrdo)', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    const rec = store.resignPvp(id, 'B');
    if (typeof rec === 'string') {
      throw new Error(`čekal jsem záznam, dostal ${rec}`);
    }
    expect(rec.forcedResult).toBe('black-wins');
  });

  it('vzdát už skončenou partii nejde → already-over', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    store.resignPvp(id, 'A');
    expect(store.resignPvp(id, 'B')).toBe('already-over');
  });

  it('resignPvp na engine partii hlasitě throwuje', () => {
    const store = new GameStore();
    const { id } = store.create();
    expect(() => store.resignPvp(id, 'A')).toThrow(/není PvP/);
  });
});

describe('GameStore – PvP nabídka remízy (offer/accept/reject, fáze 77)', () => {
  it('offerDrawPvp: neexistující/cizí/skončená → not-found/not-participant/already-over', () => {
    const store = new GameStore();
    expect(store.offerDrawPvp('neni', 'A')).toBe('not-found');
    const { id } = store.createPvp('A', 'B');
    expect(store.offerDrawPvp(id, 'cizi')).toBe('not-participant');
    store.resignPvp(id, 'A');
    expect(store.offerDrawPvp(id, 'B')).toBe('already-over');
  });

  it('nabídka nemění stav partie (běží dál)', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    const rec = store.offerDrawPvp(id, 'A');
    if (typeof rec === 'string') {
      throw new Error(`čekal jsem záznam, dostal ${rec}`);
    }
    expect(rec.forcedResult).toBeNull();
    expect(effectiveResult(rec)).toBe('ongoing');
  });

  it('dvojí nabídka (i od druhého hráče) → offer-exists', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    expect(typeof store.offerDrawPvp(id, 'A')).not.toBe('string');
    expect(store.offerDrawPvp(id, 'A')).toBe('offer-exists');
    expect(store.offerDrawPvp(id, 'B')).toBe('offer-exists');
  });

  it('soupeř přijme nabídku → draw; nabídka zmizí', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    store.offerDrawPvp(id, 'A');
    const rec = store.acceptDrawPvp(id, 'B');
    if (typeof rec === 'string') {
      throw new Error(`čekal jsem záznam, dostal ${rec}`);
    }
    expect(effectiveResult(rec)).toBe('draw');
    // Druhé přijetí už není co (partie skončila).
    expect(store.acceptDrawPvp(id, 'B')).toBe('already-over');
  });

  it('vlastní nabídku nelze přijmout ani odmítnout → no-offer', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    store.offerDrawPvp(id, 'A');
    expect(store.acceptDrawPvp(id, 'A')).toBe('no-offer');
    expect(store.rejectDrawPvp(id, 'A')).toBe('no-offer');
  });

  it('přijmout/odmítnout bez visící nabídky → no-offer', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    expect(store.acceptDrawPvp(id, 'B')).toBe('no-offer');
    expect(store.rejectDrawPvp(id, 'B')).toBe('no-offer');
  });

  it('soupeř odmítne nabídku → partie běží, nabídka zmizí (nelze pak přijmout)', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    store.offerDrawPvp(id, 'A');
    const rec = store.rejectDrawPvp(id, 'B');
    if (typeof rec === 'string') {
      throw new Error(`čekal jsem záznam, dostal ${rec}`);
    }
    expect(effectiveResult(rec)).toBe('ongoing');
    expect(store.acceptDrawPvp(id, 'B')).toBe('no-offer');
    // Po odmítnutí lze nabídnout znovu.
    expect(typeof store.offerDrawPvp(id, 'A')).not.toBe('string');
  });

  it('tah zruší visící nabídku (implicitní odmítnutí)', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    store.offerDrawPvp(id, 'A');
    playFirstLegal(store, id); // černý (A) táhne → nabídka padá
    expect(store.acceptDrawPvp(id, 'B')).toBe('no-offer');
  });

  it('vzdání zruší visící nabídku', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    store.offerDrawPvp(id, 'A');
    store.resignPvp(id, 'A'); // A se vzdá → white-wins, nabídka padá spolu s koncem
    // Partie skončila → accept vrací already-over (ne draw).
    expect(store.acceptDrawPvp(id, 'B')).toBe('already-over');
  });

  it('accept/reject/offer na engine partii hlasitě throwují', () => {
    const store = new GameStore();
    const { id } = store.create();
    expect(() => store.offerDrawPvp(id, 'A')).toThrow(/není PvP/);
    expect(() => store.acceptDrawPvp(id, 'A')).toThrow(/není PvP/);
    expect(() => store.rejectDrawPvp(id, 'A')).toThrow(/není PvP/);
  });
});

describe('GameStore – opuštění dohrané partie (markPvpLeft, fáze 77)', () => {
  it('markPvpLeft poprvé vrátí true, podruhé false (uvolnění nejvýš jednou)', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    expect(store.markPvpLeft(id)).toBe(true);
    expect(store.markPvpLeft(id)).toBe(false);
  });

  it('markPvpLeft na neexistující/engine partii vrátí false (bez throwu)', () => {
    const store = new GameStore();
    expect(store.markPvpLeft('neni')).toBe(false);
    const { id } = store.create(); // engine partie
    expect(store.markPvpLeft(id)).toBe(false);
  });
});

describe('GameStore – nabídka odvety (rematch, fáze 77)', () => {
  /** Dovede PvP partii do terminálního stavu (A se vzdá → vyhraje B). */
  function endedPvp(): { store: GameStore; id: string } {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    store.resignPvp(id, 'A'); // A se vzdá → terminální
    return { store, id };
  }

  it('offerRematchPvp na BĚŽÍCÍ partii → not-over (odveta až po konci)', () => {
    const store = new GameStore();
    const { id } = store.createPvp('A', 'B');
    expect(store.offerRematchPvp(id, 'A')).toBe('not-over');
  });

  it('nabídka po konci projde; druhá naráz → offer-exists; neúčastník → not-participant', () => {
    const { store, id } = endedPvp();
    expect(typeof store.offerRematchPvp(id, 'A')).not.toBe('string');
    expect(store.offerRematchPvp(id, 'A')).toBe('offer-exists');
    expect(store.offerRematchPvp('neni', 'A')).toBe('not-found');
    const fresh = endedPvp();
    expect(fresh.store.offerRematchPvp(fresh.id, 'cizi')).toBe('not-participant');
  });

  it('soupeř přijme odvetu → záznam; vlastní / chybějící nabídku nelze přijmout → no-offer', () => {
    const { store, id } = endedPvp();
    store.offerRematchPvp(id, 'A');
    expect(store.acceptRematchPvp(id, 'A')).toBe('no-offer'); // vlastní nabídka
    const rec = store.acceptRematchPvp(id, 'B');
    if (typeof rec === 'string') {
      throw new Error(`čekal jsem záznam, dostal ${rec}`);
    }
    expect(rec.players).toEqual({ black: 'A', white: 'B' }); // vrací STAROU partii (app z ní odvodí novou)
    // Po přijetí nabídka zmizela.
    expect(store.acceptRematchPvp(id, 'B')).toBe('no-offer');
  });

  it('odmítnutí zruší nabídku (pak nelze přijmout)', () => {
    const { store, id } = endedPvp();
    store.offerRematchPvp(id, 'A');
    expect(typeof store.declineRematchPvp(id, 'B')).not.toBe('string');
    expect(store.acceptRematchPvp(id, 'B')).toBe('no-offer');
  });

  it('rematch metody na engine partii hlasitě throwují', () => {
    const store = new GameStore();
    const { id } = store.create();
    expect(() => store.offerRematchPvp(id, 'A')).toThrow(/není PvP/);
    expect(() => store.acceptRematchPvp(id, 'A')).toThrow(/není PvP/);
    expect(() => store.declineRematchPvp(id, 'A')).toThrow(/není PvP/);
  });

  it('po opuštění partie (markPvpLeft) je odveta MRTVÁ → offer/accept/decline vrací gone', () => {
    const { store, id } = endedPvp();
    store.offerRematchPvp(id, 'A'); // visící nabídka
    store.markPvpLeft(id); // někdo dal Konec
    // I s visící nabídkou už nejde nic: partie je opuštěná (jinak dvojité spárování).
    expect(store.acceptRematchPvp(id, 'B')).toBe('gone');
    expect(store.declineRematchPvp(id, 'B')).toBe('gone');
    expect(store.offerRematchPvp(id, 'B')).toBe('gone');
  });
});

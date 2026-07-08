// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMove, initialPosition, legalMoves } from '@checkers/rules';
import type { Cell, Color, Move, Position } from '@checkers/rules';

import { createPvpController } from '../src/pvp-controller.js';
import type { PvpStatus } from '../src/pvp-controller.js';
import type { PvpGameDto } from '../src/server-client.js';
import type { GameResult } from '@checkers/rules';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) {
    d();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** PvP stav v drátovém tvaru z libovolné pozice (legalMoves dopočítá z pravidel). */
function pvpDto(position: Position, result: GameResult = 'ongoing'): PvpGameDto {
  return {
    mode: 'pvp',
    id: 'g1',
    position,
    result,
    legalMoves: legalMoves(position).map((m) => ({
      from: m.from,
      path: [...m.path],
      captures: [...m.captures],
    })),
  };
}

/** Deska s kameny na daných polích (1–32); zbytek prázdný. */
function board(pieces: [number, Color, ('man' | 'king')?][]): Cell[] {
  const b: Cell[] = Array.from({ length: 32 }, () => null);
  for (const [sq, color, kind] of pieces) {
    b[sq - 1] = { color, kind: kind ?? 'man' };
  }
  return b;
}

function squareEl(root: HTMLElement, square: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} nenalezeno`);
  }
  return el;
}
function click(root: HTMLElement, square: number): void {
  squareEl(root, square).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
function hasPiece(root: HTMLElement, square: number): boolean {
  return squareEl(root, square).querySelector('.piece') !== null;
}

/** Pointer událost (jsdom neumí spolehlivě PointerEvent konstruktor). Výchozí myš. */
function pointer(type: string, x: number, y: number, pointerType = 'mouse'): Event {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, { pointerId: 1, isPrimary: true, pointerType, button: 0, clientX: x, clientY: y });
  return e;
}

/**
 * Odsimuluje tažení kamene z pole `from` na `to` (`to=null` = mimo desku). Pole pod
 * bodem puštění dodá mock `elementFromPoint` (jsdom nemá layout). `pointerType='touch'`
 * ověří, že dotyk NEtáhne. Threshold překročíme skokem o 20 px.
 */
function drag(root: HTMLElement, from: number, to: number | null, pointerType = 'mouse'): void {
  const toEl = to === null ? null : squareEl(root, to);
  const doc = document as unknown as { elementFromPoint: (x: number, y: number) => Element | null };
  const original = doc.elementFromPoint;
  doc.elementFromPoint = () => toEl;
  try {
    squareEl(root, from).dispatchEvent(pointer('pointerdown', 0, 0, pointerType));
    root.dispatchEvent(pointer('pointermove', 20, 20, pointerType));
    root.dispatchEvent(pointer('pointerup', 40, 40, pointerType));
  } finally {
    doc.elementFromPoint = original;
  }
}

/**
 * Realistické myší ťuknutí: pointerdown + pointerup (bez pohybu) + click. Ťuknutí na
 * kámen ho vybere (přes drag cestu, výběr zůstane); `click` na konci srovná
 * `suppressNextClick`, takže navazující samostatný klik se nespolkne.
 */
function tap(root: HTMLElement, square: number): void {
  const el = squareEl(root, square);
  el.dispatchEvent(pointer('pointerdown', 0, 0));
  el.dispatchEvent(pointer('pointerup', 0, 0));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** Pozice s černým JEDNODUCHÝM braním (path délky 1, jeden sebraný kámen). */
function findSingleCapture(): { position: Position; move: Move } {
  const candidates: [number, Color, ('man' | 'king')?][][] = [
    [[14, 'black'], [18, 'white']],
    [[14, 'black'], [17, 'white']],
    [[10, 'black'], [15, 'white']],
    [[11, 'black'], [15, 'white']],
    [[9, 'black'], [14, 'white']],
    [[22, 'black'], [18, 'white']],
  ];
  for (const pieces of candidates) {
    const position: Position = { board: board(pieces), turn: 'black' };
    const move = legalMoves(position).find((m) => m.path.length === 1 && m.captures.length === 1);
    if (move !== undefined) {
      return { position, move };
    }
  }
  throw new Error('Nenašla se pozice s jednoduchým braním – kandidáti neplatí.');
}

interface Sent {
  from: number;
  path: number[];
}
function mount(myColor: Color, opts: { sendResult?: boolean } = {}) {
  const sendResult = opts.sendResult ?? true;
  const sent: Sent[] = [];
  const statuses: PvpStatus[] = [];
  const errors: string[] = [];
  const controller = createPvpController({
    myColor,
    sendMove: (from, path) => {
      sent.push({ from, path: [...path] });
      return sendResult; // false = spojení pryč (tah neodešel)
    },
    onStatus: (s) => statuses.push(s),
    onError: (m) => errors.push(m),
  });
  disposers.push(() => controller.dispose());
  document.body.append(controller.element);
  return { controller, sent, statuses, errors };
}

/** Najde mezi kandidáty pozici s černým vícenásobným skokem (path délky ≥ 2). */
function findDoubleJump(): { position: Position; move: Move } {
  const candidates: [number, Color, ('man' | 'king')?][][] = [
    [[14, 'black'], [18, 'white'], [26, 'white']],
    [[14, 'black'], [17, 'white'], [25, 'white']],
    [[10, 'black'], [14, 'white'], [22, 'white']],
    [[10, 'black'], [15, 'white'], [23, 'white']],
    [[11, 'black'], [15, 'white'], [23, 'white']],
    [[9, 'black'], [14, 'white'], [22, 'white']],
    [[15, 'black'], [18, 'white'], [26, 'white']],
    [[6, 'black'], [10, 'white'], [18, 'white']],
    [[7, 'black'], [11, 'white'], [19, 'white']],
  ];
  for (const pieces of candidates) {
    const position: Position = { board: board(pieces), turn: 'black' };
    const move = legalMoves(position).find((m) => m.path.length >= 2);
    if (move !== undefined) {
      return { position, move };
    }
  }
  throw new Error('Nenašla se pozice s vícenásobným skokem – kandidáti neplatí.');
}

describe('createPvpController', () => {
  it('applyState ohlásí stav – na tahu jsem, když je má barva a partie běží', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition())); // výchozí = černý na tahu
    expect(h.statuses.at(-1)).toEqual({ result: 'ongoing', turn: 'black', myTurn: true });
  });

  it('legální klik-sekvence (výběr → cíl) pošle správné {from, path} a zamkne vstup', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    // Prostý tah černého: najdi z pravidel (jednodopadový, path délky 1).
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1);
    if (simple === undefined) {
      throw new Error('Výchozí pozice nemá prostý tah – rozestavění se změnilo.');
    }
    click(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!);
    expect(h.sent).toEqual([{ from: simple.from, path: [simple.path[0]] }]);
    // Po odeslání je vstup zamčený (čeká se na server) → další klik nic nepošle.
    const other = legalMoves(initialPosition()).find((m) => m.from !== simple.from);
    if (other !== undefined) {
      click(h.controller.element, other.from);
      click(h.controller.element, other.path[0]!);
    }
    expect(h.sent).toHaveLength(1);
    // A stav hlásí, že už nejsem na tahu (čekám na potvrzení).
    expect(h.statuses.at(-1)!.myTurn).toBe(false);
  });

  it('vícenásobný skok: naklikání všech dopadů pošle CELOU cestu jako jeden tah', () => {
    const { position, move } = findDoubleJump();
    const h = mount('black');
    h.controller.applyState(pvpDto(position));
    click(h.controller.element, move.from);
    for (const hop of move.path) {
      click(h.controller.element, hop);
    }
    expect(h.sent).toEqual([{ from: move.from, path: [...move.path] }]);
  });

  it('klik mimo tah (na tahu soupeř) nic nepošle', () => {
    const h = mount('black');
    // Na tahu bílý (soupeř) – černý nesmí táhnout.
    h.controller.applyState(pvpDto({ board: initialPosition().board, turn: 'white' }));
    const anyBlack = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    click(h.controller.element, anyBlack.from);
    click(h.controller.element, anyBlack.path[0]!);
    expect(h.sent).toEqual([]);
    expect(h.statuses.at(-1)!.myTurn).toBe(false);
  });

  it('klik na soupeřův kámen nevybere a nepošle tah', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition())); // černý na tahu
    click(h.controller.element, 21); // bílý kámen (21–32)
    click(h.controller.element, 17); // kamkoli
    expect(h.sent).toEqual([]);
  });

  it('showError odemkne vstup, ohlásí hlášku a nechá desku na posledním stavu', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    click(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!);
    expect(h.sent).toHaveLength(1); // odesláno, teď zamčeno

    h.controller.showError('Nelegální tah.');
    expect(h.errors).toEqual(['Nelegální tah.']);

    // Po odemčení jde zahrát znovu (jiný legální tah) → druhý sendMove.
    const again = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    click(h.controller.element, again.from);
    click(h.controller.element, again.path[0]!);
    expect(h.sent).toHaveLength(2);
  });

  it('když se tah neodešle (spojení pryč), deska se NEZAMKNE a ohlásí se hláška', () => {
    const h = mount('black', { sendResult: false });
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    click(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!);
    expect(h.sent).toHaveLength(1); // pokus o odeslání proběhl
    expect(h.errors.at(-1)).toContain('Spojení není dostupné');
    // NEzamčeno → jde zkusit znovu (druhý pokus se taky odešle).
    click(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!);
    expect(h.sent).toHaveLength(2);
    expect(h.statuses.at(-1)!.myTurn).toBe(true); // pořád na tahu
  });

  it('setConnectionLost zamkne desku – klik nic nepošle a myTurn je false', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition())); // na tahu, myTurn true
    h.controller.setConnectionLost();
    expect(h.statuses.at(-1)!.myTurn).toBe(false);
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    click(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!);
    expect(h.sent).toEqual([]);
  });

  it('setConnectionLost uvolní čekající tah (pendingMove) – deska nezamrzne v zámku', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    click(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!); // odesláno → pendingMove=true
    h.controller.setConnectionLost(); // uvolní pendingMove i když zamkne connectionLost
    // Deska je zamčená kvůli connectionLost (ne kvůli visícímu pendingMove) – ověřeno
    // tím, že myTurn je false a další klik nic nepošle.
    expect(h.statuses.at(-1)!.myTurn).toBe(false);
  });

  it('showError srovná řádek stavu zpět na „na tahu" (myTurn true)', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    click(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!); // pendingMove → myTurn false
    expect(h.statuses.at(-1)!.myTurn).toBe(false);
    h.controller.showError('Nelegální tah.');
    expect(h.statuses.at(-1)!.myTurn).toBe(true); // zpět na tahu
  });

  it('terminální výsledek zamkne desku – klik nic nepošle', () => {
    const h = mount('black');
    // Pozice, kde je černý nominálně na tahu, ale partie je rozhodnutá (výhra bílého).
    h.controller.applyState(pvpDto(initialPosition(), 'white-wins'));
    expect(h.statuses.at(-1)).toEqual({ result: 'white-wins', turn: 'black', myTurn: false });
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    click(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!);
    expect(h.sent).toEqual([]);
  });
});

describe('createPvpController – tažení myší (drag & drop)', () => {
  it('prosté tažení na legální pole odešle {from, path} a zamkne vstup', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    drag(h.controller.element, simple.from, simple.path[0]!);
    expect(h.sent).toEqual([{ from: simple.from, path: [simple.path[0]!] }]);
    expect(h.statuses.at(-1)!.myTurn).toBe(false); // odesláno → čeká na server (zamčeno)
  });

  it('po potvrzeném tahu se deska usadí – kámen je na cíli, výchozí prázdné', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    drag(h.controller.element, simple.from, simple.path[0]!);
    // Server potvrdí (pošle nový stav po tahu).
    h.controller.applyState(pvpDto(applyMove(initialPosition(), simple)));
    expect(hasPiece(h.controller.element, simple.path[0]!)).toBe(true);
    expect(hasPiece(h.controller.element, simple.from)).toBe(false);
  });

  it('vícenásobný skok tažením na KONCOVÉ pole odešle celý řetěz', () => {
    const { position, move } = findDoubleJump();
    const h = mount('black');
    h.controller.applyState(pvpDto(position));
    drag(h.controller.element, move.from, move.path[move.path.length - 1]!);
    expect(h.sent).toEqual([{ from: move.from, path: [...move.path] }]);
  });

  it('dopad na MEZIpole vícenásobného skoku se vrátí (nic neodešle)', () => {
    const { position, move } = findDoubleJump();
    const h = mount('black');
    h.controller.applyState(pvpDto(position));
    drag(h.controller.element, move.from, move.path[0]!); // první (mezi)dopad, ne konec
    expect(h.sent).toEqual([]); // nedokončený řetěz → žádné odeslání
    expect(hasPiece(h.controller.element, move.from)).toBe(true); // kámen zpět na výchozí
  });

  it('odmítnutí serverem po tažení vrátí kámen na potvrzenou pozici', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    drag(h.controller.element, simple.from, simple.path[0]!);
    expect(hasPiece(h.controller.element, simple.path[0]!)).toBe(true); // rukou na cíli
    h.controller.showError('Nelegální tah.');
    // Usazeno zpět: kámen na výchozím poli, cíl prázdný, vstup zas odemčen.
    expect(hasPiece(h.controller.element, simple.from)).toBe(true);
    expect(hasPiece(h.controller.element, simple.path[0]!)).toBe(false);
    expect(h.errors).toEqual(['Nelegální tah.']);
    expect(h.statuses.at(-1)!.myTurn).toBe(true);
  });

  it('odmítnutí po BRANÍ tažením obnoví i optimisticky sebraný kámen', () => {
    const { position, move } = findSingleCapture();
    const captured = move.captures[0]!;
    const h = mount('black');
    h.controller.applyState(pvpDto(position));
    drag(h.controller.element, move.from, move.path[0]!);
    expect(hasPiece(h.controller.element, captured)).toBe(false); // sebrán (optimisticky)
    h.controller.showError('Nelegální tah.');
    expect(hasPiece(h.controller.element, captured)).toBe(true); // obnoven
    expect(hasPiece(h.controller.element, move.from)).toBe(true); // kámen zpět
  });

  it('ztráta spojení po tažení vrátí kámen na potvrzenou pozici', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    drag(h.controller.element, simple.from, simple.path[0]!);
    h.controller.setConnectionLost();
    expect(hasPiece(h.controller.element, simple.from)).toBe(true);
    expect(hasPiece(h.controller.element, simple.path[0]!)).toBe(false);
  });

  it('když se tah neodešle (spojení pryč), NEZAMKNE se a kámen se vrátí', () => {
    const h = mount('black', { sendResult: false });
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    drag(h.controller.element, simple.from, simple.path[0]!);
    expect(h.sent).toHaveLength(1); // pokus o odeslání proběhl
    expect(h.errors.at(-1)).toContain('Spojení není dostupné');
    expect(h.statuses.at(-1)!.myTurn).toBe(true); // pořád na tahu (nezamčeno)
    expect(hasPiece(h.controller.element, simple.from)).toBe(true); // kámen zpět
  });

  it('zámky: tažení nic nepošle mimo tah, po odeslání, po ztrátě spojení ani po konci', () => {
    // Soupeřův tah (turn = white, já černý).
    const h1 = mount('black');
    h1.controller.applyState(pvpDto({ ...initialPosition(), turn: 'white' }));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    drag(h1.controller.element, simple.from, simple.path[0]!);
    expect(h1.sent).toEqual([]);

    // Po odeslání (pendingMove) další tažení nic nepošle.
    const h2 = mount('black');
    h2.controller.applyState(pvpDto(initialPosition()));
    drag(h2.controller.element, simple.from, simple.path[0]!);
    drag(h2.controller.element, simple.from, simple.path[0]!);
    expect(h2.sent).toHaveLength(1);

    // Po ztrátě spojení.
    const h3 = mount('black');
    h3.controller.applyState(pvpDto(initialPosition()));
    h3.controller.setConnectionLost();
    drag(h3.controller.element, simple.from, simple.path[0]!);
    expect(h3.sent).toEqual([]);

    // Terminální výsledek.
    const h4 = mount('black');
    h4.controller.applyState(pvpDto(initialPosition(), 'white-wins'));
    drag(h4.controller.element, simple.from, simple.path[0]!);
    expect(h4.sent).toEqual([]);
  });

  it('při TAŽENÍ svítí KONCOVÉ pole vícenásobného skoku, ne mezidopad', () => {
    const { position, move } = findDoubleJump();
    const h = mount('black');
    h.controller.applyState(pvpDto(position));
    const root = h.controller.element;
    // Uchop kámen (pointerdown) → zapne tažení a zvýrazní koncová pole (kam se pustí).
    squareEl(root, move.from).dispatchEvent(pointer('pointerdown', 0, 0));
    const endpoint = move.path[move.path.length - 1]!;
    const intermediate = move.path[0]!;
    expect(squareEl(root, endpoint).classList.contains('target')).toBe(true);
    expect(squareEl(root, intermediate).classList.contains('target')).toBe(false);
    root.dispatchEvent(pointer('pointerup', 0, 0)); // ukliď gesto
  });

  it('při KLIKÁNÍ svítí naopak bezprostřední dopad (hop-po-hopu), ne koncové pole', () => {
    const { position, move } = findDoubleJump();
    const h = mount('black');
    h.controller.applyState(pvpDto(position));
    const root = h.controller.element;
    click(root, move.from); // výběr klikem (ne tažení)
    const endpoint = move.path[move.path.length - 1]!;
    const intermediate = move.path[0]!;
    expect(squareEl(root, intermediate).classList.contains('target')).toBe(true);
    expect(squareEl(root, endpoint).classList.contains('target')).toBe(false);
  });

  it('dotyk (pointerType touch) NEtáhne – žádné odeslání', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    drag(h.controller.element, simple.from, simple.path[0]!, 'touch');
    expect(h.sent).toEqual([]);
  });

  it('klik dál funguje i po zapojení tažení (výběr myší + cíl)', () => {
    const h = mount('black');
    h.controller.applyState(pvpDto(initialPosition()));
    const simple = legalMoves(initialPosition()).find((m) => m.path.length === 1)!;
    // Myší ťuknutí na kámen ho VYBERE (přes drag cestu, výběr zůstane), pak klik na cíl.
    tap(h.controller.element, simple.from);
    click(h.controller.element, simple.path[0]!);
    expect(h.sent).toEqual([{ from: simple.from, path: [simple.path[0]!] }]);
  });
});

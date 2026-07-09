// @vitest-environment jsdom
import { applyMove, initialPosition, legalMoves } from '@checkers/rules';
import type { GameResult, Move, Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import type { GameDto, MoveDto, ServerClient } from '../src/server-client.js';

/**
 * Fáze 80 – tap na kámen v AIvP nesmí padnout kvůli PASIVNÍMU dotazu na server
 * (poll stavu à 250 ms + jednorázová nápověda Výuky). Na mobilu drží takový dotaz
 * `busy` po dobu síťového RTT a dřív spolknul výběr kamene; PvP to netrápí (nepolluje).
 * Testy jedou přes reálný controller + board-view (jsdom), reálnou cestou `handleClick`.
 */

const HUGE = 1_000_000;
const disposers: (() => void)[] = [];

function gameDto(
  position: Position,
  level: GameDto['level'],
  result: GameResult = 'ongoing',
): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle', level, ballotMoves: null };
}

/** Legální (prosté) tahy černého ve výchozí pozici – černý je na tahu = člověk. */
const moves: Move[] = legalMoves(initialPosition());
const opening: Move = moves[0]!;
const openingTo = opening.path[opening.path.length - 1]!;
/** Druhý selektovatelný kámen s JINÝM výchozím polem (na test zámku během akce). */
const otherFrom: number = (() => {
  const m = moves.find((x) => x.from !== opening.from);
  if (m === undefined) {
    throw new Error('výchozí pozice musí mít aspoň dva různé tahové kameny');
  }
  return m.from;
})();
/** Pozice po zahrání `opening` – na tahu je pak bílý = engine. */
const afterOpening = applyMove(initialPosition(), opening);

function makeClient(overrides: Partial<ServerClient> = {}, level: GameDto['level'] = 'professional'): ServerClient {
  return {
    createGame: () => Promise.resolve(gameDto(initialPosition(), level)),
    getGame: () => Promise.resolve(gameDto(afterOpening, level)),
    postMove: () => Promise.resolve(gameDto(afterOpening, level)),
    resign: () => Promise.resolve(gameDto(initialPosition(), level, 'white-wins')),
    offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(initialPosition(), level) }),
    ...overrides,
  };
}

function mount(game: GameDto, client: ServerClient, pollIntervalMs = HUGE): HTMLElement {
  const controller = createBoardController(client, game, { pollIntervalMs });
  disposers.push(() => {
    controller.dispose();
  });
  document.body.append(controller.element);
  return controller.element;
}

function sq(root: HTMLElement, square: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} nenalezeno`);
  }
  return el;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('AIvP: pasivní dotaz nesmí spolknout tap', () => {
  it('tap na vlastní kámen během načítání nápovědy (Výuka) kámen vybere', async () => {
    // getHint, který NIKDY nedoběhne → nápověda visí „inflight" (busy=true, passiveInflight=true).
    const getHint = vi.fn(() => new Promise<MoveDto>(() => undefined));
    const board = mount(gameDto(initialPosition(), 'education'), makeClient({ getHint }, 'education'));
    await flush();
    expect(getHint).toHaveBeenCalledTimes(1); // nápověda se opravdu právě načítá

    // Zuby: kdyby handleClick blokoval na holém `busy` (jako dřív), tap by tady padl.
    click(sq(board, opening.from));
    expect(sq(board, opening.from).classList.contains('selected')).toBe(true);
  });

  it('poll se během tahu ČLOVĚKA nespouští a rozjede se až po jeho tahu', async () => {
    const getGame = vi.fn(() => Promise.resolve(gameDto(afterOpening, 'professional')));
    // Malý interval → kdyby se pollovalo, getGame by naskákal mnohokrát.
    const board = mount(gameDto(initialPosition(), 'professional'), makeClient({ getGame }), 5);

    await delay(40); // ~8 tiků; člověk je na tahu → poll se má PŘESKAKOVAT
    expect(getGame).not.toHaveBeenCalled();

    // Člověk potáhne → stav přejde na tah enginu (bílý) → poll se má rozjet.
    click(sq(board, opening.from));
    click(sq(board, openingTo));
    await flush();
    await delay(40);
    expect(getGame).toHaveBeenCalled();
  });

  it('během ODESÍLÁNÍ tahu (akční request) je vstup zamčený – tap kámen nevybere', async () => {
    // postMove, který nedoběhne → akční request visí; input musí zůstat zamčený.
    const postMove = vi.fn(() => new Promise<GameDto>(() => undefined));
    const board = mount(gameDto(initialPosition(), 'professional'), makeClient({ postMove }));

    click(sq(board, opening.from));
    click(sq(board, openingTo)); // spustí submitMove → postMove visí
    await flush();
    expect(postMove).toHaveBeenCalledTimes(1);

    // Tap na jiný vlastní kámen během běžícího odesílání se musí ignorovat.
    click(sq(board, otherFrom));
    expect(sq(board, otherFrom).classList.contains('selected')).toBe(false);
  });

  it('tap během DRAINU odesílaného tahu (čeká na běžící nápovědu) je zamčený', async () => {
    // Okno `submitting`: nápověda (PASIVNÍ) běží → tah se dá naklikat (test 1), ale
    // submitMove před odesláním čeká, až nápověda doběhne. Po tu dobu musí být vstup
    // zamčený PRÁVĚ příznakem `submitting` (busy patří pasivní nápovědě, takže
    // `busy && !passiveInflight` NEblokuje). Zub na tuhle větev guardu.
    let resolveHint: (m: MoveDto) => void = () => undefined;
    const getHint = vi.fn(() => new Promise<MoveDto>((r) => { resolveHint = r; }));
    const board = mount(gameDto(initialPosition(), 'education'), makeClient({ getHint }, 'education'));
    await flush();
    expect(getHint).toHaveBeenCalledTimes(1); // nápověda visí (busy + passiveInflight)

    // Naklikej celý tah: výběr projde (pasivní nápověda neblokuje), cíl spustí
    // submitMove → submitting=true a drain čeká na visící nápovědu.
    click(sq(board, opening.from));
    click(sq(board, openingTo));
    await flush();

    // Během drainu tapni jiný vlastní kámen → musí se ignorovat (blokuje `submitting`).
    click(sq(board, otherFrom));
    expect(sq(board, otherFrom).classList.contains('selected')).toBe(false);

    // Doběhnutí nápovědy uvolní drain (tah se odešle) – ať test nezůstane viset.
    resolveHint({ from: opening.from, path: [...opening.path], captures: [] });
    await flush();
  });
});

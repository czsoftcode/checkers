// @vitest-environment jsdom
import { applyMove, initialPosition, legalMoves } from '@checkers/rules';
import type { Cell, Color, Position } from '@checkers/rules';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBoardController } from '../src/controller.js';
import { resolveMove } from '../src/selection.js';
import type { EngineStatus, GameDto, MoveDto, ServerClient } from '../src/server-client.js';
import type { SoundEvent, SoundPlayer } from '../src/sound.js';

/**
 * Úroveň Mistrovství z pohledu controlleru: partie startuje s BÍLÝM (engine) na
 * tahu (server nasadil vylosované zahájení), takže POČÍTAČ TÁHNE PRVNÍ. Klient na
 * to nemá zvláštní větev – spoléhá, že polling běží od založení BEZPODMÍNEČNĚ
 * (nezávisle na tom, kdo je na tahu). Tenhle test ten předpoklad přibíjí: kdyby se
 * polling gateoval na „na tahu je člověk" (nebo se na startu nespustil), první tah
 * enginu z bílé pozice by se nikdy nenačetl a partie by tiše stála. (Detekce
 * `engineJustMoved` řídí jen rozmýšlecí pauzu AI, ne aplikaci stavu – tu hlídá
 * `controller-ai-pause.test`, ne tenhle test.)
 *
 * jsdom nemá WAAPI → render jde „instant", časování pauzy je deterministické.
 */

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** GameDto s volitelným stavem enginu; úroveň Mistrovství (championship). */
function championshipDto(
  position: Position,
  engineStatus: EngineStatus,
  result: GameDto['result'] = 'ongoing',
  ballotMoves: GameDto['ballotMoves'] = null,
): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus, level: 'championship', ballotMoves };
}

/**
 * Popballotová počáteční pozice: černý odehrál 9→13 (jeden z půltahů zahájení),
 * na tahu je BÍLÝ = engine. Tvar stačí pro controller (jen render + poll), nemusí
 * to být reálný ballot – testujeme mechaniku klienta, ne los serveru.
 */
function whiteToMoveStart(): Position {
  const start = initialPosition();
  const board = start.board.slice();
  board[9 - 1] = null;
  board[13 - 1] = { color: 'black', kind: 'man' };
  return { board, turn: 'white' };
}

/** Pozice po tahu enginu (bílý 22→18); na tahu zpět černý (člověk). */
function afterEngineReply(whiteStart: Position): Position {
  // Pojistka proti tichému chybnému předpokladu o rozestavění.
  if (whiteStart.board[22 - 1]?.color !== 'white' || whiteStart.board[18 - 1] !== null) {
    throw new Error('Test čekal bílý kámen na 22 a prázdné 18 (rozestavění se změnilo).');
  }
  const board = whiteStart.board.slice();
  board[22 - 1] = null;
  board[18 - 1] = { color: 'white', kind: 'man' };
  return { board, turn: 'black' };
}

function squareEl(root: HTMLElement, square: number): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-square="${String(square)}"]`);
  if (el === null) {
    throw new Error(`Pole ${String(square)} nenalezeno`);
  }
  return el;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Mistrovství: počítač táhne první', () => {
  it('první poll aplikuje tah enginu z počáteční bílé pozice (bez tahu člověka)', async () => {
    const start = whiteToMoveStart();
    const afterEngine = afterEngineReply(start);
    // Server nasadil ballot → partie začíná bílým na tahu, engine „přemýšlí".
    // Poll pak vrátí stav PO tahu enginu (na tahu zpět černý). Člověk netáhne.
    const client: ServerClient = {
      createGame: () => Promise.resolve(championshipDto(start, 'thinking')),
      getGame: () => Promise.resolve(championshipDto(afterEngine, 'idle')),
      postMove: () => Promise.reject(new Error('člověk nesmí táhnout, je na tahu engine')),
      resign: () => Promise.resolve(championshipDto(afterEngine, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: championshipDto(afterEngine, 'idle') }),
    };

    const turns: Color[] = [];
    const controller = createBoardController(client, championshipDto(start, 'thinking'), {
      pollIntervalMs: 5,
      aiMovePauseMs: 20,
      onState: (s) => turns.push(s.turn),
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    // Počáteční stav: na tahu bílý (počítač). Tenhle snímek přijde hned při vzniku.
    expect(turns[0]).toBe('white');

    // Bez jediného tahu člověka poll vezme tah enginu → přechod na černého.
    // ZUB: kdyby se polling na startu nespustil (nebo se gateoval na tah člověka),
    // `turns` by zůstalo na 'white' a tohle by vypršelo (chyba testu).
    await delay(80);
    expect(turns.at(-1)).toBe('black');
  });

  it('člověk nemůže táhnout, dokud je na tahu počítač (bílý) – postMove se nezavolá', async () => {
    const start = whiteToMoveStart();
    // Engine „pořád přemýšlí": poll vrací stále bílý na tahu, tah nikdy nedorazí.
    const postMove = vi.fn(() => Promise.resolve(championshipDto(start, 'thinking')));
    const client: ServerClient = {
      createGame: () => Promise.resolve(championshipDto(start, 'thinking')),
      getGame: () => Promise.resolve(championshipDto(start, 'thinking')),
      postMove,
      resign: () => Promise.resolve(championshipDto(start, 'thinking', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: championshipDto(start, 'thinking') }),
    };

    const controller = createBoardController(client, championshipDto(start, 'thinking'), {
      pollIntervalMs: 5,
      aiMovePauseMs: 20,
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    // Člověk (černý) zkusí táhnout svým kamenem, i když je na tahu bílý. Klik na
    // vlastní kámen (11) a cíl (15) nesmí vyústit v tah – autorita barvy drží
    // interakci jen na tahu člověka.
    click(squareEl(controller.element, 11));
    click(squareEl(controller.element, 15));
    await tick();
    await tick();

    // ZUB: kdyby controller pustil výběr/tah i mimo tah člověka, postMove by se
    // zavolalo a autorita barvy klienta by neplatila.
    expect(postMove).not.toHaveBeenCalled();
  });
});

/** Odehraje `ballotMoves` z výchozí pozice reálnou cestou rules → mezipozice. */
function applyBallot(moves: readonly MoveDto[]): Position[] {
  const out: Position[] = [];
  let pos = initialPosition();
  for (const move of moves) {
    const resolved = resolveMove(pos, move.from, move.path);
    if (resolved === null) {
      throw new Error(`ballot tah ${String(move.from)}->${move.path.join(',')} není legální`);
    }
    pos = applyMove(pos, resolved);
    out.push(pos);
  }
  return out;
}

/** Přečte celou desku z DOM (32 polí) do pole Cell – pro srovnání s pozicí. */
function readBoard(root: HTMLElement): Cell[] {
  const board: Cell[] = new Array<Cell>(32).fill(null);
  for (let square = 1; square <= 32; square++) {
    const piece = root.querySelector<HTMLElement>(`[data-square="${String(square)}"] .piece`);
    if (piece === null) {
      continue;
    }
    const color: Color = piece.classList.contains('white') ? 'white' : 'black';
    board[square - 1] = { color, kind: piece.classList.contains('king') ? 'king' : 'man' };
  }
  return board;
}

describe('Mistrovství: animace vylosovaného zahájení (ballot)', () => {
  // Reálný ballot „Double Cross": 9-14 23-18 14x23 (třetí půltah je BRANÍ) – pokryje
  // i braní kamene v intru. Klient captures ignoruje (odvodí je rules), stačí from+path.
  const ballotMoves: MoveDto[] = [
    { from: 9, path: [14], captures: [] },
    { from: 23, path: [18], captures: [] },
    { from: 14, path: [23], captures: [18] },
  ];

  it('animuje tři půltahy ballotu a teprve PAK tah enginu (pořadí + konečná deska)', async () => {
    const [, , postBallot] = applyBallot(ballotMoves);
    if (postBallot === undefined) {
      throw new Error('ballot musí dát popballotovou pozici');
    }
    expect(postBallot.turn).toBe('white'); // po třech půltazích je na tahu bílý = engine

    // Tah enginu = první legální bílý tah z popballotové pozice (reálný, ať diff sedí).
    const engineMove = legalMoves(postBallot)[0];
    if (engineMove === undefined) {
      throw new Error('popballotová pozice musí mít legální tah bílého');
    }
    const afterEngine = applyMove(postBallot, engineMove);
    expect(afterEngine.turn).toBe('black');

    // Časová osa: každý dopad kamene (i v jsdom bez WAAPI) přehraje 'land'; přechod
    // stavu ohlásí onState. Do jednoho pole zapisujeme obojí a hlídáme POŘADÍ.
    const timeline: string[] = [];
    const recorder: SoundPlayer = {
      unlock: () => undefined,
      play: (event: SoundEvent) => {
        if (event === 'land') {
          timeline.push('land');
        }
      },
    };

    const client: ServerClient = {
      createGame: () => Promise.resolve(championshipDto(postBallot, 'thinking', 'ongoing', ballotMoves)),
      getGame: () => Promise.resolve(championshipDto(afterEngine, 'idle')),
      postMove: () => Promise.reject(new Error('člověk nesmí táhnout během intra')),
      resign: () => Promise.resolve(championshipDto(afterEngine, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: championshipDto(afterEngine, 'idle') }),
    };

    const controller = createBoardController(
      client,
      championshipDto(postBallot, 'thinking', 'ongoing', ballotMoves),
      {
        pollIntervalMs: 5,
        aiMovePauseMs: 0,
        ballotIntroGapMs: 10,
        soundPlayer: recorder,
        onState: (s) => timeline.push(`turn:${s.turn}`),
      },
    );
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    await delay(150);

    // Tři půltahy ballotu (3× 'land') + tah enginu (1× 'land') = 4 dopady.
    // ZUB: bez intra by se ballot nepřehrál a 'land' by bylo jen 1 (jen engine tah);
    // první render popballotové pozice je totiž tichý (diffMove==null).
    expect(timeline.filter((e) => e === 'land')).toHaveLength(4);

    // POŘADÍ: engine (přechod na černého) se ohlásí AŽ po třech dopadech ballotu.
    // ZUB gate: kdyby se `await lastRender` na intro nenavázalo, tah enginu by se
    // aplikoval hned a 'turn:black' by přišlo dřív než tři 'land'.
    const firstBlack = timeline.indexOf('turn:black');
    expect(firstBlack).toBeGreaterThan(-1);
    const landsBeforeBlack = timeline.slice(0, firstBlack).filter((e) => e === 'land').length;
    expect(landsBeforeBlack).toBeGreaterThanOrEqual(3);

    // Deska po celém intru + tahu enginu = pozice ze serveru (afterEngine).
    // ZUB: kdyby se ballotMoves a servírovaná pozice rozešly nebo handoff diffnul
    // ze špatné báze, konečná deska by neseděla.
    expect(readBoard(controller.element)).toEqual(afterEngine.board);
  });

  it('polling se během intra PŘESKAKUJE – getGame se nevolá, dokud ballot nedoběhne', async () => {
    // ZUB proti reálné díře: engine na pozadí přemýšlí, takže poll by během intra
    // vracel nezměněnou popballotovou pozici (bílý na tahu) → `engineJustMoved` false
    // → gate `await lastRender` se NEuplatní → `applyServerState → render()` by
    // uprostřed animace ballotu překreslil desku na post-ballot pozici a rozbil ji
    // (v produkci s reálným WAAPI). Fix: `introPlaying` polling po dobu intra pozdrží.
    // Mechanický důkaz fixu: getGame se během intra vůbec nezavolá.
    const [, , postBallot] = applyBallot(ballotMoves);
    if (postBallot === undefined) {
      throw new Error('ballot musí dát popballotovou pozici');
    }
    const engineMove = legalMoves(postBallot)[0];
    if (engineMove === undefined) {
      throw new Error('popballotová pozice musí mít legální tah bílého');
    }
    const afterEngine = applyMove(postBallot, engineMove);
    const silent: SoundPlayer = { unlock: () => undefined, play: () => undefined };

    const getGame = vi.fn(() => Promise.resolve(championshipDto(afterEngine, 'idle')));
    const client: ServerClient = {
      createGame: () => Promise.resolve(championshipDto(postBallot, 'thinking', 'ongoing', ballotMoves)),
      getGame,
      postMove: () => Promise.reject(new Error('člověk nesmí táhnout')),
      resign: () => Promise.resolve(championshipDto(afterEngine, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: championshipDto(afterEngine, 'idle') }),
    };
    const controller = createBoardController(
      client,
      championshipDto(postBallot, 'thinking', 'ongoing', ballotMoves),
      { pollIntervalMs: 5, aiMovePauseMs: 0, ballotIntroGapMs: 40, soundPlayer: silent },
    );
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    // Intro trvá ~2×40 ms = 80 ms. Ve 30 ms poll 6× tiknul, ale introPlaying ho
    // odmítl → server se ještě nedotázal. ZUB: bez gate by getGame už volané bylo.
    await delay(30);
    expect(getGame).not.toHaveBeenCalled();

    // Po doběhnutí intra se polling rozjede a tah enginu dorazí; deska sedne na server.
    await delay(160);
    expect(getGame).toHaveBeenCalled();
    expect(readBoard(controller.element)).toEqual(afterEngine.board);
  });

  it('bez ballotMoves (null) se žádné intro nekoná – první render je tichý, hraje jen tah enginu', async () => {
    // Zpětná kompatibilita / fallback: championship BEZ ballotMoves (nemělo by v
    // produkci nastat, ale klient to nesmí shodit) → chová se jako dřív: popballot
    // pozice se vykreslí rovnou, intro se nespustí.
    const start = whiteToMoveStart();
    const afterEngine = afterEngineReply(start);
    const lands: string[] = [];
    const recorder: SoundPlayer = {
      unlock: () => undefined,
      play: (event: SoundEvent) => {
        if (event === 'land') {
          lands.push('land');
        }
      },
    };
    const client: ServerClient = {
      createGame: () => Promise.resolve(championshipDto(start, 'thinking')),
      getGame: () => Promise.resolve(championshipDto(afterEngine, 'idle')),
      postMove: () => Promise.reject(new Error('člověk nesmí táhnout')),
      resign: () => Promise.resolve(championshipDto(afterEngine, 'idle', 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: championshipDto(afterEngine, 'idle') }),
    };
    const controller = createBoardController(client, championshipDto(start, 'thinking'), {
      pollIntervalMs: 5,
      aiMovePauseMs: 0,
      soundPlayer: recorder,
    });
    disposers.push(() => {
      controller.dispose();
    });
    document.body.append(controller.element);

    await delay(80);

    // Jen tah enginu zazní (1 dopad); žádné intro navíc.
    expect(lands).toHaveLength(1);
    expect(readBoard(controller.element)).toEqual(afterEngine.board);
  });
});

// @vitest-environment jsdom
import { initialPosition } from '@checkers/rules';
import type { Position } from '@checkers/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { createAppShell } from '../src/app-shell.js';
import type {
  BoardController,
  BoardControllerOptions,
  DrawOfferOutcome,
  GameStatus,
} from '../src/controller.js';
import type { GameDto, GameLevel, ServerClient } from '../src/server-client.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  // Úroveň se pamatuje v LocalStorage → čistý start, ať se volba neprolije mezi testy.
  localStorage.clear();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  localStorage.clear();
});

function gameDto(position: Position, result: GameDto['result'] = 'ongoing'): GameDto {
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle', level: 'professional' };
}

/** Fake controller: neřídí desku, jen zaznamenává dispose/resign a umí emitovat stav. */
interface FakeCtl {
  readonly element: HTMLElement;
  readonly resign: Mock<() => void>;
  readonly offerDraw: Mock<() => Promise<DrawOfferOutcome>>;
  readonly dispose: Mock<() => void>;
  emit(status: GameStatus): void;
}

/**
 * Tovární funkce controllerů pro skořápku: každý vytvořený fake si pamatuje a
 * hned (jako reálný controller) ohlásí výchozí stav z `game`. Test tak vidí, co
 * skořápka udělala s dispose/resign a jak reaguje na onState.
 */
function fakeFactory(): {
  factory: (client: ServerClient, game: GameDto, opts: BoardControllerOptions) => BoardController;
  created: FakeCtl[];
} {
  const created: FakeCtl[] = [];
  const factory = (
    _client: ServerClient,
    game: GameDto,
    opts: BoardControllerOptions,
  ): BoardController => {
    const element = document.createElement('div');
    element.className = 'fake-board';
    const ctl: FakeCtl = {
      element,
      resign: vi.fn<() => void>(),
      offerDraw: vi.fn<() => Promise<DrawOfferOutcome>>().mockResolvedValue('declined'),
      dispose: vi.fn<() => void>(),
      emit: (status: GameStatus) => opts.onState?.(status),
    };
    created.push(ctl);
    // Reálný controller po vzniku ohlásí výchozí stav – zopakuj to.
    opts.onState?.({
      result: game.result,
      turn: game.position.turn,
      engineStatus: game.engineStatus,
    });
    return ctl;
  };
  return { factory, created };
}

function fakeClient(dto: GameDto): ServerClient {
  return {
    createGame: () => Promise.resolve(dto),
    getGame: () => Promise.resolve(dto),
    postMove: () => Promise.resolve(dto),
    resign: () => Promise.resolve({ ...dto, result: 'white-wins' }),
    offerDraw: () => Promise.resolve({ accepted: false, game: dto }),
  };
}

/** Fake createGame, které v odpovědi VRÁTÍ zvolenou úroveň (server = autorita). */
function levelEchoClient(): {
  client: ServerClient;
  createGame: Mock<(level: GameLevel) => Promise<GameDto>>;
} {
  const createGame = vi.fn<(level: GameLevel) => Promise<GameDto>>((level) =>
    Promise.resolve({ ...gameDto(initialPosition()), level }),
  );
  return { client: { ...fakeClient(gameDto(initialPosition())), createGame }, createGame };
}

function q(root: HTMLElement, sel: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (el === null) {
    throw new Error(`prvek ${sel} nenalezen`);
  }
  return el;
}

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * Připne skořápku a nechá doběhnout automatickou první hru (appka ji zakládá
 * sama, napoprvé Profesionál). Většina testů potřebuje rozehranou hru.
 */
async function mountRunning(
  client: ServerClient = fakeClient(gameDto(initialPosition())),
): Promise<{ shell: ReturnType<typeof createAppShell>; created: FakeCtl[] }> {
  const { factory, created } = fakeFactory();
  const shell = createAppShell(client, { createController: factory });
  document.body.append(shell.element);
  await tick(); // automatická první hra doběhne, controller ohlásí ongoing
  return { shell, created };
}

/** Odešle na prvku `change` událost (jako když uživatel vybere jinou volbu). */
function change(el: HTMLElement): void {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const OVER: GameStatus = { result: 'white-wins', turn: 'white', engineStatus: 'idle' };

describe('app-shell – stav tlačítek podle výsledku', () => {
  it('za běhu je aktivní jen Vzdávám hru, po konci jen Nová hra', async () => {
    const { shell, created } = await mountRunning();

    const resignBtn = q(shell.element, '.btn-resign') as HTMLButtonElement;
    const newBtn = q(shell.element, '.btn-newgame') as HTMLButtonElement;
    expect(resignBtn.disabled).toBe(false);
    expect(newBtn.disabled).toBe(true);

    // Partie skončí (např. vzdáním / enginem) → tlačítka se prohodí.
    created[0]?.emit(OVER);
    expect(resignBtn.disabled).toBe(true);
    expect(newBtn.disabled).toBe(false);
    expect(q(shell.element, '.status').textContent).toBe('Konec: vyhrál počítač.');
  });
});

describe('app-shell – panel nad deskou: obsah a struktura', () => {
  it('za běhu partie je řádek stavu prázdný (kdo je na tahu = barva kamene), soupeř nikde', async () => {
    const { shell } = await mountRunning();
    // Výchozí ongoing stav (černý na tahu, idle): status nenese žádný text o tahu.
    expect(q(shell.element, '.status').textContent).toBe('');
    // Samostatný řádek se soupeřem (.level-info) jsme zrušili – v DOM není.
    expect(shell.element.querySelector('.level-info')).toBeNull();
  });

  it('konec partie i chyba enginu se v řádku stavu pořád ukazují (status neztratil zuby)', async () => {
    const { shell, created } = await mountRunning();
    created[0]?.emit({ result: 'draw', turn: 'black', engineStatus: 'idle' });
    expect(q(shell.element, '.status').textContent).toBe('Konec: remíza.');
    created[0]?.emit({ result: 'ongoing', turn: 'black', engineStatus: 'error' });
    expect(q(shell.element, '.status').textContent).toContain('chybu');
  });

  it('přepínač úrovně je v řádku ovládání vlevo od „Nabízím remízu", s oddělovačem mezi nimi', async () => {
    const { shell } = await mountRunning();
    const controls = q(shell.element, '.controls');
    const select = q(controls, '.level-select'); // přepínač je UVNITŘ řádku ovládání
    const divider = q(controls, '.controls-divider');
    const offer = q(controls, '.btn-offer-draw');
    // Pořadí v řádku: přepínač PŘED oddělovačem PŘED tlačítkem Nabízím remízu.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(select.compareDocumentPosition(divider) & FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(offer) & FOLLOWING).toBeTruthy();
    // Zrušený samostatný řádek/popisek úrovně („Nová hra proti:") v DOM není.
    expect(shell.element.querySelector('.level-row')).toBeNull();
    expect(shell.element.querySelector('.level-label')).toBeNull();
  });

  it('panel je v toku nad řádkem desky; deska i indikátor žijí uvnitř .board-row', async () => {
    const { shell } = await mountRunning();
    const panel = q(shell.element, '.panel');
    const boardRow = q(shell.element, '.board-row');
    // Panel i řádek desky jsou přímí sourozenci ve .game a panel je PŘED deskou
    // (kdyby byl panel pořád fixed mimo tok / za deskou, tenhle pořádek by padl).
    expect(panel.parentElement).toBe(shell.element);
    expect(boardRow.parentElement).toBe(shell.element);
    expect(panel.compareDocumentPosition(boardRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Deska (board-slot) i indikátor jsou uvnitř .board-row, ne přímo ve .game.
    expect(boardRow.querySelector('.board-slot')).not.toBeNull();
    expect(boardRow.querySelector('.turn-indicator')).not.toBeNull();
  });
});

describe('app-shell – výběr úrovně', () => {
  it('start: automatická hra na Profesionálovi, přepínač ho ukazuje a je ODEMČENÝ (před tahem)', async () => {
    const { factory } = fakeFactory();
    const { client, createGame } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();

    expect(createGame).toHaveBeenCalledWith('professional');
    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    // Soupeř se hlásí přepínačem (samostatný řádek s úrovní partie jsme zrušili).
    expect(select.value).toBe('professional');
    // Deska je hned (ne prázdná obrazovka) a úroveň jde měnit PŘED prvním tahem.
    expect(shell.element.querySelectorAll('.fake-board')).toHaveLength(1);
    expect(select.disabled).toBe(false);
  });

  it('přepnutí PŘED tahem přehraje partii na novou úroveň', async () => {
    // Zuby: kdyby přepnutí před tahem nepřehrálo partii, createGame by podruhé
    // nedostalo 'beginner'.
    const { factory } = fakeFactory();
    const { client, createGame } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();

    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    select.value = 'beginner';
    change(select); // uživatel přepnul úroveň PŘED prvním tahem
    await tick();

    expect(createGame).toHaveBeenLastCalledWith('beginner');
    expect(select.value).toBe('beginner');
  });

  it('první tah zamkne přepínač; konec partie ho zas odemkne', async () => {
    const { factory, created } = fakeFactory();
    const { client } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();

    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    expect(select.disabled).toBe(false); // před tahem volný

    // Tah člověka → stav přestane být výchozí (bílý na tahu / engine přemýšlí).
    created[0]?.emit({ result: 'ongoing', turn: 'white', engineStatus: 'thinking' });
    expect(select.disabled).toBe(true); // po prvním tahu zamčený

    // I když se stav vrátí na černý+idle (po tahu enginu), zůstává zamčený.
    created[0]?.emit({ result: 'ongoing', turn: 'black', engineStatus: 'idle' });
    expect(select.disabled).toBe(true);

    created[0]?.emit(OVER); // konec partie → zas odemčený
    expect(select.disabled).toBe(false);
  });
});

describe('app-shell – úroveň přežije reload (LocalStorage)', () => {
  it('volba úrovně se uloží do LocalStorage při založení partie', async () => {
    const { factory } = fakeFactory();
    const { client } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();

    // Auto-start uložil výchozí (Profesionál).
    expect(localStorage.getItem('checkers.level')).toBe('professional');

    // Uživatel přepne PŘED tahem → přehraje partii → uloží se nová volba.
    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    select.value = 'intermediate';
    change(select);
    await tick();
    expect(localStorage.getItem('checkers.level')).toBe('intermediate');
  });

  it('po reloadu se předvyplní uložená úroveň a partie na ní vznikne (zuby)', async () => {
    // Zuby: kdyby se uložená úroveň při startu nepřečetla, select by zůstal na
    // Profesionálovi a createGame by dostalo 'professional', ne 'intermediate'.
    localStorage.setItem('checkers.level', 'intermediate');
    const { factory } = fakeFactory();
    const { client, createGame } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();

    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    expect(select.value).toBe('intermediate');
    expect(createGame).toHaveBeenCalledWith('intermediate');
  });

  it('neplatná uložená hodnota → fallback na výchozí Profesionál (nepropustí se serveru)', async () => {
    localStorage.setItem('checkers.level', 'grandmaster'); // stará/cizí/poškozená
    const { factory } = fakeFactory();
    const { client, createGame } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();

    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    expect(select.value).toBe('professional');
    expect(createGame).toHaveBeenCalledWith('professional');
  });

  it('nedostupný LocalStorage (getItem hodí) → start nespadne, jede Profesionál', async () => {
    // Privátní režim / vypnuté úložiště: getItem vyhodí. Start appky to NESMÍ shodit.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('LocalStorage blokován');
    });
    const { factory } = fakeFactory();
    const { client, createGame } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();

    // Deska se vykreslila (appka nespadla), partie běží na výchozí úrovni.
    expect(shell.element.querySelectorAll('.fake-board')).toHaveLength(1);
    expect(createGame).toHaveBeenCalledWith('professional');
  });
});

describe('app-shell – inline potvrzení vzdání', () => {
  it('„Vzdávám hru" ukáže potvrzení; „Ano" vzdá, „Zrušit" ne', async () => {
    const { shell, created } = await mountRunning();

    const controls = q(shell.element, '.controls');
    const confirm = q(shell.element, '.confirm');
    expect(confirm.classList.contains('hidden')).toBe(true);

    // Klik na vzdání → potvrzení se ukáže, hlavní tlačítka se schovají.
    click(q(shell.element, '.btn-resign'));
    expect(confirm.classList.contains('hidden')).toBe(false);
    expect(controls.classList.contains('hidden')).toBe(true);

    // „Zrušit" → potvrzení pryč, controller.resign se NEvolal.
    click(q(shell.element, '.btn-confirm-no'));
    expect(confirm.classList.contains('hidden')).toBe(true);
    expect(controls.classList.contains('hidden')).toBe(false);
    expect(created[0]?.resign).not.toHaveBeenCalled();

    // Znovu vzdání → „Ano" → controller.resign se zavolá právě jednou.
    click(q(shell.element, '.btn-resign'));
    click(q(shell.element, '.btn-confirm-yes'));
    expect(created[0]?.resign).toHaveBeenCalledTimes(1);
    expect(confirm.classList.contains('hidden')).toBe(true);
  });
});

describe('app-shell – tlačítko „Nabízím remízu"', () => {
  const ONGOING: GameStatus = { result: 'ongoing', turn: 'black', engineStatus: 'idle' };
  const THINKING: GameStatus = { result: 'ongoing', turn: 'white', engineStatus: 'thinking' };

  const mountShell = mountRunning; // remíza se nabízí v rozehrané hře → start hry

  it('aktivní na tahu člověka (idle), zamčené po konci / když engine přemýšlí', async () => {
    const { shell, created } = await mountShell();
    const offerBtn = q(shell.element, '.btn-offer-draw') as HTMLButtonElement;

    expect(offerBtn.disabled).toBe(false); // výchozí: ongoing, černý na tahu, idle

    created[0]?.emit(THINKING);
    expect(offerBtn.disabled).toBe(true); // engine přemýšlí (bílý na tahu)

    created[0]?.emit(ONGOING);
    expect(offerBtn.disabled).toBe(false); // zpátky na tahu člověka

    created[0]?.emit(OVER);
    expect(offerBtn.disabled).toBe(true); // partie skončila
  });

  it('klik → controller.offerDraw; odmítnutí ukáže hlášku', async () => {
    const { shell, created } = await mountShell();
    created[0]?.offerDraw.mockResolvedValue('declined');

    click(q(shell.element, '.btn-offer-draw'));
    await tick();

    expect(created[0]?.offerDraw).toHaveBeenCalledTimes(1);
    const msg = q(shell.element, '.offer-msg');
    expect(msg.classList.contains('hidden')).toBe(false);
    expect(msg.textContent).toContain('odmítl');
  });

  it('přijetí → hláška o nabídce se schová (o konci mluví řádek stavu)', async () => {
    const { shell, created } = await mountShell();
    created[0]?.offerDraw.mockResolvedValue('accepted');

    click(q(shell.element, '.btn-offer-draw'));
    await tick();

    const msg = q(shell.element, '.offer-msg');
    expect(msg.classList.contains('hidden')).toBe(true);
    expect(msg.textContent).toBe('');
  });

  it('po dobu rozhodování je tlačítko zamčené a ukazuje „zvažuje"', async () => {
    const { shell, created } = await mountShell();
    // Verdikt nikdy nedorazí → nabídka „visí".
    created[0]?.offerDraw.mockReturnValue(new Promise(() => undefined));

    click(q(shell.element, '.btn-offer-draw'));
    await tick();

    const offerBtn = q(shell.element, '.btn-offer-draw') as HTMLButtonElement;
    expect(offerBtn.disabled).toBe(true);
    expect(q(shell.element, '.offer-msg').textContent).toContain('zvažuje');
  });
});

describe('app-shell – Nová hra uklidí starý controller (polling)', () => {
  it('dispose starého controlleru a vytvoření nového', async () => {
    const { shell, created } = await mountRunning();
    expect(created).toHaveLength(1);

    // Partie skončí → Nová hra se povolí.
    created[0]?.emit(OVER);
    const newBtn = q(shell.element, '.btn-newgame') as HTMLButtonElement;
    expect(newBtn.disabled).toBe(false);

    click(newBtn);
    await tick(); // createGame nové partie doběhne

    // Starý controller byl uklizen (dispose = zastavení pollingu) a vznikl nový.
    expect(created[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
    expect(created[1]?.dispose).not.toHaveBeenCalled();
    // V DOM je jen nová deska.
    expect(shell.element.querySelectorAll('.fake-board')).toHaveLength(1);
    expect(shell.element.contains(created[1]?.element ?? null)).toBe(true);
  });
});

describe('app-shell – selhání při zakládání partie', () => {
  it('createGame selže → hláška, Nová hra aktivní, Vzdávám hru zamčené', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client: ServerClient = {
      createGame: () => Promise.reject(new Error('síť dole')),
      getGame: () => Promise.resolve(gameDto(initialPosition())),
      postMove: () => Promise.resolve(gameDto(initialPosition())),
      resign: () => Promise.resolve(gameDto(initialPosition(), 'white-wins')),
      offerDraw: () => Promise.resolve({ accepted: false, game: gameDto(initialPosition()) }),
    };
    const shell = createAppShell(client);
    document.body.append(shell.element);
    await tick(); // automatická první hra → createGame selže

    const resignBtn = q(shell.element, '.btn-resign') as HTMLButtonElement;
    const newBtn = q(shell.element, '.btn-newgame') as HTMLButtonElement;
    expect(q(shell.element, '.status').textContent).toContain('nepodařilo');
    expect(resignBtn.disabled).toBe(true);
    expect(newBtn.disabled).toBe(false);
  });
});

describe('app-shell – indikátor strany na tahu', () => {
  it('svítí barvou strany na tahu za běhu, po konci partie zmizí', async () => {
    const { shell, created } = await mountRunning();
    const ind = q(shell.element, '.turn-indicator');
    const piece = q(ind, '.piece');
    // Výchozí stav: člověk (černý) je na tahu → viditelný černý kámen.
    expect(ind.classList.contains('hidden')).toBe(false);
    expect(piece.classList.contains('black')).toBe(true);
    expect(piece.classList.contains('white')).toBe(false);
    // Počítač na tahu → přebarví na bílý, pořád viditelný.
    created[0]?.emit({ result: 'ongoing', turn: 'white', engineStatus: 'thinking' });
    expect(ind.classList.contains('hidden')).toBe(false);
    expect(piece.classList.contains('white')).toBe(true);
    expect(piece.classList.contains('black')).toBe(false);
    // Konec partie → indikátor zmizí (nesvítí na dohranou partii).
    created[0]?.emit(OVER);
    expect(ind.classList.contains('hidden')).toBe(true);
  });

  it('nová hra skryje indikátor i když založení selže (chybová cesta nevolá render)', async () => {
    // 1. volání createGame projde (mount), 2. selže (nová hra). Ověří, že skrytí
    // indikátoru drží i na chybové cestě, kde se render() nevolá.
    let calls = 0;
    const dto = gameDto(initialPosition());
    const client: ServerClient = {
      ...fakeClient(dto),
      createGame: () => {
        calls += 1;
        return calls === 1 ? Promise.resolve(dto) : Promise.reject(new Error('síť dole'));
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { factory } = fakeFactory();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick(); // první hra běží → indikátor viditelný
    const ind = q(shell.element, '.turn-indicator');
    expect(ind.classList.contains('hidden')).toBe(false);
    // Přepnutí úrovně před prvním tahem spustí novou hru; její createGame selže.
    change(q(shell.element, '.level-select'));
    await tick();
    expect(ind.classList.contains('hidden')).toBe(true);
  });
});

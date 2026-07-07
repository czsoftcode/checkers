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
import type { SoundPlayer } from '../src/sound.js';

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
  return { id: 'g1', position, result, legalMoves: [], engineStatus: 'idle', level: 'professional', ballotMoves: null };
}

/** Fake controller: neřídí desku, jen zaznamenává dispose/resign a umí emitovat stav. */
interface FakeCtl {
  readonly element: HTMLElement;
  readonly resign: Mock<(onResolved?: (didResign: boolean) => void) => void>;
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
      resign: vi.fn<(onResolved?: (didResign: boolean) => void) => void>(),
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
  createGame: Mock<(level: GameLevel, humanColor: 'black' | 'white') => Promise<GameDto>>;
} {
  const createGame = vi.fn<(level: GameLevel, humanColor: 'black' | 'white') => Promise<GameDto>>((level) =>
    Promise.resolve({ ...gameDto(initialPosition()), level }),
  );
  return { client: { ...fakeClient(gameDto(initialPosition())), createGame }, createGame };
}

/**
 * Fake createGame, které v odpovědi VRÁTÍ i zvolenou barvu člověka (server =
 * autorita nad `humanColor`). Slouží k ověření střídání barvy: každá partie
 * skutečně „hraje" barvu, kterou si klient vyžádal, takže překlopení po dohrání
 * vychází z reálné odehrané barvy.
 */
function colorEchoClient(): {
  client: ServerClient;
  createGame: Mock<(level: GameLevel, humanColor: 'black' | 'white') => Promise<GameDto>>;
} {
  const createGame = vi.fn<(level: GameLevel, humanColor: 'black' | 'white') => Promise<GameDto>>(
    (level, humanColor) => Promise.resolve({ ...gameDto(initialPosition()), level, humanColor }),
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
    // Výsledek jde do modalu (bez „Konec:" prefixu), řádek stavu zůstává prázdný.
    const modal = q(shell.element, '.modal-overlay');
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(q(modal, '.modal-msg').textContent).toBe('Vyhrál počítač.');
    expect(q(shell.element, '.status').textContent).toBe('');
  });
});

describe('app-shell – perspektiva bílého (humanColor=white)', () => {
  const whiteDto = (): GameDto => ({ ...gameDto(initialPosition()), humanColor: 'white' });

  it('engine (černý) vyhrál → modal „Vyhrál počítač."', async () => {
    // ZUB obrácené barvy: při člověk=bílý znamená black-wins prohru člověka.
    // Kdyby mapování zůstalo natvrdo (black-wins = výhra člověka), modal by lhal.
    const { shell, created } = await mountRunning(fakeClient(whiteDto()));
    created[0]?.emit({ result: 'black-wins', turn: 'black', engineStatus: 'idle' });
    await tick();
    const modal = q(shell.element, '.modal-overlay');
    expect(q(modal, '.modal-msg').textContent).toBe('Vyhrál počítač.');
  });

  it('člověk (bílý) vyhrál → modal „Vyhráli jste."', async () => {
    const { shell, created } = await mountRunning(fakeClient(whiteDto()));
    created[0]?.emit({ result: 'white-wins', turn: 'white', engineStatus: 'idle' });
    await tick();
    const modal = q(shell.element, '.modal-overlay');
    expect(q(modal, '.modal-msg').textContent).toBe('Vyhráli jste.');
  });

  it('nabídka remízy aktivní jen na tahu bílého (člověka), ne na tahu enginu', async () => {
    const { shell, created } = await mountRunning(fakeClient(whiteDto()));
    const offer = q(shell.element, '.btn-offer-draw') as HTMLButtonElement;

    created[0]?.emit({ result: 'ongoing', turn: 'white', engineStatus: 'idle' });
    expect(offer.disabled).toBe(false); // na tahu člověk (bílý)

    created[0]?.emit({ result: 'ongoing', turn: 'black', engineStatus: 'idle' });
    expect(offer.disabled).toBe(true); // na tahu engine (černý)
  });
});

describe('app-shell – střídání barvy po každé dohrané partii', () => {
  const NEXT_COLOR_KEY = 'checkers.nextColor';

  it('první partie je černá (výchozí), po dohrání pošle příští createGame bílou a uloží ji', async () => {
    const { client, createGame } = colorEchoClient();
    const { shell, created } = await mountRunning(client);

    // Napoprvé nic uloženo → výchozí černý (dnešní chování).
    expect(createGame).toHaveBeenNthCalledWith(1, 'professional', 'black');

    // Partie se DOHRAJE (skutečný výsledek) → barva se překlopí a uloží.
    created[0]?.emit(OVER);
    await tick();
    expect(localStorage.getItem(NEXT_COLOR_KEY)).toBe('white');

    // Nová hra → další createGame dostane opačnou barvu.
    click(q(shell.element, '.btn-newgame'));
    await tick();
    expect(createGame).toHaveBeenLastCalledWith('professional', 'white');

    // A po dohrání DRUHÉ (bílé) partie se překlopí zpět na černou (ping-pong).
    created[1]?.emit(OVER);
    await tick();
    expect(localStorage.getItem(NEXT_COLOR_KEY)).toBe('black');
  });

  it('pád enginu (error) barvu NEpřeklopí – není to dohraná partie; až reálný výsledek', async () => {
    const { client } = colorEchoClient();
    const { created } = await mountRunning(client);

    // Chyba enginu (result ongoing, engineStatus error) – terminální latch se sice
    // zapne, ale barva se překlápět NESMÍ (partie nedohrána).
    created[0]?.emit({ result: 'ongoing', turn: 'black', engineStatus: 'error' });
    await tick();
    expect(localStorage.getItem(NEXT_COLOR_KEY)).toBeNull(); // nikdy nezapsáno

    // Reálný výsledek přijde až teď → TEĎ se překlopí.
    created[0]?.emit(OVER);
    await tick();
    expect(localStorage.getItem(NEXT_COLOR_KEY)).toBe('white');
  });

  it('první partie vezme barvu uloženou v LocalStorage (přežije reload)', async () => {
    // Jako by minulá session skončila s „příště bílý". Nová session (mount) ji vezme.
    localStorage.setItem(NEXT_COLOR_KEY, 'white');
    const { client, createGame } = colorEchoClient();
    await mountRunning(client);

    expect(createGame).toHaveBeenNthCalledWith(1, 'professional', 'white');
  });

  it('starý server bez humanColor: po překlopení na bílou zůstane mapování ČERNÉ (fallback black)', async () => {
    // ZUB regrese: server BEZ fáze 50 pole `humanColor` v požadavku ignoruje a
    // člověka drží černého → v DTO humanColor NIKDY nepošle. Klient sice požádá o
    // bílou, ale MUSÍ padnout na 'black' (ne na poslanou 'white'), jinak by desku
    // orientoval pro bílého proti serveru, co hraje černého. Kdyby fallback byl
    // `?? nextColor`, tenhle test spadne (mapování by bylo invertované).
    const createGame = vi.fn<(level: GameLevel, humanColor: 'black' | 'white') => Promise<GameDto>>(
      (level) => Promise.resolve({ ...gameDto(initialPosition()), level }), // BEZ humanColor
    );
    const client: ServerClient = { ...fakeClient(gameDto(initialPosition())), createGame };
    const { shell, created } = await mountRunning(client);

    // Dohraj hru 1 (výchozí černá) → nextColor se překlopí na 'white'.
    created[0]?.emit(OVER);
    await tick();
    expect(localStorage.getItem(NEXT_COLOR_KEY)).toBe('white');

    // Nová hra: klient pošle 'white', ale starý server ho zahodí → DTO zas bez barvy.
    click(q(shell.element, '.btn-newgame'));
    await tick();
    expect(createGame).toHaveBeenLastCalledWith('professional', 'white');

    // black-wins MUSÍ znamenat výhru člověka (černého) → fallback drží 'black'.
    created[1]?.emit({ result: 'black-wins', turn: 'black', engineStatus: 'idle' });
    await tick();
    expect(q(q(shell.element, '.modal-overlay'), '.modal-msg').textContent).toBe('Vyhráli jste.');
  });
});

describe('app-shell – panel nad deskou: obsah a struktura', () => {
  it('za běhu partie je řádek stavu prázdný a SKRYTÝ (kdo je na tahu = barva kamene), soupeř nikde', async () => {
    const { shell } = await mountRunning();
    // Výchozí ongoing stav (černý na tahu, idle): status nenese žádný text o tahu.
    const status = q(shell.element, '.status');
    expect(status.textContent).toBe('');
    // Prázdný status je .hidden (display:none), ať ve vodorovném stavovém řádku
    // netvoří mezeru ani falešný oddělovač před verdiktem nabídky remízy.
    expect(status.classList.contains('hidden')).toBe(true);
    // Samostatný řádek se soupeřem (.level-info) jsme zrušili – v DOM není.
    expect(shell.element.querySelector('.level-info')).toBeNull();
  });

  it('konec partie i chyba enginu vyskočí jako modal (bez „Konec:" prefixu), status prázdný', async () => {
    // Remíza → modal „Remíza." (žádný „Konec:" prefix), status prázdný.
    const draw = await mountRunning();
    const drawModal = q(draw.shell.element, '.modal-overlay');
    draw.created[0]?.emit({ result: 'draw', turn: 'black', engineStatus: 'idle' });
    expect(drawModal.classList.contains('hidden')).toBe(false);
    expect(q(drawModal, '.modal-msg').textContent).toBe('Remíza.');
    expect(q(draw.shell.element, '.status').textContent).toBe('');

    // Chyba enginu (result ongoing, engineStatus error) → taky modal (samostatný mount).
    const err = await mountRunning();
    const errModal = q(err.shell.element, '.modal-overlay');
    err.created[0]?.emit({ result: 'ongoing', turn: 'black', engineStatus: 'error' });
    expect(errModal.classList.contains('hidden')).toBe(false);
    expect(q(errModal, '.modal-msg').textContent).toContain('chybu');
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

  it('stavový řádek je POD deskou (ve .status-bar), ne v panelu; status i offer-msg tam žijí', async () => {
    const { shell } = await mountRunning();
    const panel = q(shell.element, '.panel');
    const boardRow = q(shell.element, '.board-row');
    const statusBar = q(shell.element, '.status-bar');
    // .status-bar je až ZA řádkem desky (pod ní).
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(boardRow.compareDocumentPosition(statusBar) & FOLLOWING).toBeTruthy();
    // Stavové informace (status + verdikt nabídky remízy) jsou uvnitř .status-bar…
    expect(statusBar.querySelector('.status')).not.toBeNull();
    expect(statusBar.querySelector('.offer-msg')).not.toBeNull();
    // …a UŽ NE v horním panelu (tam zůstalo jen ovládání) – jinak by nad tlačítky
    // zůstal prázdný pás, který jsme schválně odstranili.
    expect(panel.querySelector('.status')).toBeNull();
    expect(panel.querySelector('.offer-msg')).toBeNull();
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

    expect(createGame).toHaveBeenCalledWith('professional', 'black');
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

    expect(createGame).toHaveBeenLastCalledWith('beginner', 'black');
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

  it('nabídka obsahuje „Mistrovství"; Profesionál zůstává první (výchozí)', async () => {
    const { factory } = fakeFactory();
    const { client } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();

    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    const opts = [...select.querySelectorAll('option')];
    const values = opts.map((o) => o.value);
    // Profesionál MUSÍ být první <option> (výchozí soupeř = serverový DEFAULT_LEVEL).
    expect(values[0]).toBe('professional');
    expect(values).toContain('championship');
    // Český popisek.
    const champ = opts.find((o) => o.value === 'championship');
    expect(champ?.textContent).toBe('Mistrovství');
  });

  it('výběr Mistrovství založí championship partii; počítač na tahu → přepínač se zamkne', async () => {
    // Popballotový stav ze serveru: bílý (engine) na tahu, thinking. Fake
    // createGame ho vrátí jen pro championship (jinak běžný černý+idle start).
    const champStart: GameDto = {
      id: 'g1',
      position: { board: Array.from({ length: 32 }, () => null), turn: 'white' },
      result: 'ongoing',
      legalMoves: [],
      engineStatus: 'thinking',
      level: 'championship',
      ballotMoves: null,
    };
    const createGame = vi.fn<(level: GameLevel, humanColor: 'black' | 'white') => Promise<GameDto>>((level) =>
      Promise.resolve(level === 'championship' ? champStart : { ...gameDto(initialPosition()), level }),
    );
    const client: ServerClient = { ...fakeClient(gameDto(initialPosition())), createGame };
    const { factory } = fakeFactory();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick(); // auto první hra (Profesionál)

    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    select.value = 'championship';
    change(select); // výběr Mistrovství PŘED tahem přehraje partii na championship
    await tick();

    expect(createGame).toHaveBeenLastCalledWith('championship', 'black');
    // Po založení Mistrovství je na tahu počítač (bílý + thinking) → latch
    // `firstMoveMade` se zamkne HNED, přepínač se zamkne. Zuby: kdyby se latch u
    // bílý-na-tahu startu nezamkl, select by zůstal odemčený a hráč by mohl
    // rozehranou Mistrovství partii přepnout jinam.
    expect(select.disabled).toBe(true);
  });
});

describe('app-shell – odemknutí zvuku na gestu', () => {
  it('výběr úrovně odemkne SDÍLENÝ přehrávač synchronně a předá ho controlleru', async () => {
    // Fake přehrávač (vi.fn na unlock/play) + lokální factory, která si zapíše,
    // jaký soundPlayer controller dostal. Zub autoplay: bez odemčení na gestu by u
    // Mistrovství ballot i první tah enginu zahrály potichu (hrají dřív, než hráč
    // klikne do desky).
    // Mocky drž v samostatných proměnných (ne `player.unlock`) – reference na
    // metodu objektu spouští eslint `unbound-method`.
    const unlock = vi.fn();
    const player: SoundPlayer = { unlock, play: vi.fn() };
    const receivedPlayers: (SoundPlayer | undefined)[] = [];
    const factory = (
      _client: ServerClient,
      game: GameDto,
      opts: BoardControllerOptions,
    ): BoardController => {
      receivedPlayers.push(opts.soundPlayer);
      opts.onState?.({ result: game.result, turn: game.position.turn, engineStatus: game.engineStatus });
      return {
        element: document.createElement('div'),
        resign: vi.fn(),
        offerDraw: vi.fn().mockResolvedValue('declined'),
        dispose: vi.fn(),
      };
    };
    const { client } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory, soundPlayer: player });
    document.body.append(shell.element);
    await tick(); // automatická první hra (Profesionál) – NENÍ gesto

    // Auto-start bez gesta audio NEODEMYKÁ (browser by to stejně nedovolil).
    expect(unlock).not.toHaveBeenCalled();

    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    select.value = 'championship';
    change(select);
    // SYNCHRONNĚ v obsluze gesta, ještě NEŽ se dořeší createGame (await v startNewGame).
    expect(unlock).toHaveBeenCalledTimes(1);

    await tick(); // championship partie se založí

    // Každý controller dostal TU SAMOU sdílenou instanci → gesto odemklo přesně
    // ten přehrávač, na kterém pak controller přehrává ballot i tah enginu.
    expect(receivedPlayers.length).toBeGreaterThanOrEqual(1);
    expect(receivedPlayers.every((p) => p === player)).toBe(true);
  });

  it('tlačítko „Nová hra" odemkne přehrávač', async () => {
    const unlock = vi.fn();
    const player: SoundPlayer = { unlock, play: vi.fn() };
    const { factory } = fakeFactory();
    const { client } = levelEchoClient();
    const shell = createAppShell(client, { createController: factory, soundPlayer: player });
    document.body.append(shell.element);
    await tick();
    expect(unlock).not.toHaveBeenCalled();

    click(q(shell.element, '.btn-newgame'));
    expect(unlock).toHaveBeenCalledTimes(1);
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
    expect(createGame).toHaveBeenCalledWith('intermediate', 'black');
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
    expect(createGame).toHaveBeenCalledWith('professional', 'black');
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
    expect(createGame).toHaveBeenCalledWith('professional', 'black');
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
    // Hláška o selhání jde do modalu (ne do mizejícího řádku stavu).
    const modal = q(shell.element, '.modal-overlay');
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(q(modal, '.modal-msg').textContent).toContain('nepodařilo');
    expect(q(shell.element, '.status').textContent).toBe('');
    expect(resignBtn.disabled).toBe(true);
    expect(newBtn.disabled).toBe(false);
  });
});

describe('app-shell – modal výsledku partie', () => {
  const hidden = (el: HTMLElement): boolean => el.classList.contains('hidden');

  it('výsledek otevře modal jen JEDNOU – opakovaný stejný stav ho po zavření znovu neotevře', async () => {
    const { shell, created } = await mountRunning();
    const modal = q(shell.element, '.modal-overlay');
    const closeBtn = q(shell.element, '.btn-modal-close');

    created[0]?.emit(OVER); // white-wins → modal
    expect(hidden(modal)).toBe(false);

    // Uživatel zavře modal.
    click(closeBtn);
    expect(hidden(modal)).toBe(true);

    // Další poll se STEJNÝM terminálním stavem (result se nemění, dokud běží polling)
    // NESMÍ modal znovu otevřít – jinak by po každém pollu problikával.
    created[0]?.emit(OVER);
    expect(hidden(modal)).toBe(true);
  });

  it('modal jde zavřít tlačítkem, klávesou Esc i klikem na backdrop; klik do dialogu ne', async () => {
    const { shell, created } = await mountRunning();
    const modal = q(shell.element, '.modal-overlay');
    const dialog = q(shell.element, '.modal-dialog');
    const closeBtn = q(shell.element, '.btn-modal-close');

    // Tlačítko Zavřít.
    created[0]?.emit(OVER);
    expect(hidden(modal)).toBe(false);
    click(closeBtn);
    expect(hidden(modal)).toBe(true);

    // Esc (nová hra by latch resetla, tak přejdeme přes remízu = jiný terminální klíč).
    created[0]?.emit({ result: 'draw', turn: 'black', engineStatus: 'idle' });
    expect(hidden(modal)).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hidden(modal)).toBe(true);

    // Klik DOVNITŘ dialogu modal nezavře; klik na backdrop (overlay) ano.
    created[0]?.emit({ result: 'black-wins', turn: 'black', engineStatus: 'idle' });
    expect(hidden(modal)).toBe(false);
    click(dialog); // e.target = dialog → nezavírá
    expect(hidden(modal)).toBe(false);
    click(modal); // e.target = overlay (backdrop) → zavírá
    expect(hidden(modal)).toBe(true);
  });

  it('nová hra resetuje latch a skryje modal → výsledek další partie zas vyskočí', async () => {
    const { shell, created } = await mountRunning();
    const modal = q(shell.element, '.modal-overlay');

    created[0]?.emit(OVER);
    expect(hidden(modal)).toBe(false);

    // Nová hra: modal se skryje a latch se resetuje.
    click(q(shell.element, '.btn-newgame'));
    await tick();
    expect(hidden(modal)).toBe(true);

    // Nový controller (index 1) ohlásí konec → modal zas vyskočí (latch resetnutý).
    created[1]?.emit(OVER);
    expect(hidden(modal)).toBe(false);
  });

  it('latch se uvolní návratem do běžícího stavu → opětovná chyba enginu zas vyskočí', async () => {
    // Zuby pro defenzivní reset latche při neterminálním stavu (nezávisle na tom,
    // jestli tuhle sekvenci server dnes umí vyrobit).
    const { shell, created } = await mountRunning();
    const modal = q(shell.element, '.modal-overlay');

    created[0]?.emit({ result: 'ongoing', turn: 'black', engineStatus: 'error' });
    expect(hidden(modal)).toBe(false);
    click(q(shell.element, '.btn-modal-close'));
    expect(hidden(modal)).toBe(true);

    // Návrat na běžící (idle) latch uvolní…
    created[0]?.emit({ result: 'ongoing', turn: 'black', engineStatus: 'idle' });
    // …takže další chyba modal zas otevře (nezalatchuje se tiše).
    created[0]?.emit({ result: 'ongoing', turn: 'black', engineStatus: 'error' });
    expect(hidden(modal)).toBe(false);
  });

  it('selhání createGame neukáže „výherní" modal, i když se pod ním nastaví umělé white-wins', async () => {
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
    await tick();

    const modal = q(shell.element, '.modal-overlay');
    // Modal je vidět, ale s CHYBOVOU hláškou – ne „Vyhrál počítač." z umělého white-wins.
    expect(hidden(modal)).toBe(false);
    const msg = q(modal, '.modal-msg').textContent ?? '';
    expect(msg).toContain('nepodařilo');
    expect(msg).not.toContain('Vyhrál');
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

describe('app-shell – dvě kola v Mistrovství', () => {
  const LEVEL_KEY = 'checkers.level';
  const NEXT_COLOR_KEY = 'checkers.nextColor';

  type CreateGameFn = (
    level: GameLevel,
    humanColor: 'black' | 'white',
    ballotIndex?: number,
  ) => Promise<GameDto>;

  /**
   * Fake createGame pro zápas: u championship vrátí DTO s `ballotIndex` (poslaný
   * = 2. kolo, jinak `drawnIndex` = los 1. kola) a pozicí BÍLÝ na tahu (jako po
   * ballotu). Bílý-na-tahu je klíč pro zámek úrovně: v 1. kole (člověk černý) latchne
   * `firstMoveMade`, ve 2. kole (člověk bílý) NElatchne → zámek MUSÍ držet matchActive.
   * U ne-championship vrátí `ballotIndex: null`. Vrací i echo `humanColor` (server = autorita).
   */
  function matchClient(drawnIndex = 42): { client: ServerClient; createGame: Mock<CreateGameFn> } {
    const champPos: Position = { board: Array.from({ length: 32 }, () => null), turn: 'white' };
    const createGame = vi.fn<CreateGameFn>((level, humanColor, ballotIndex) =>
      Promise.resolve(
        level === 'championship'
          ? {
              id: 'g1',
              position: champPos,
              result: 'ongoing',
              legalMoves: [],
              engineStatus: 'idle',
              level,
              humanColor,
              ballotMoves: null,
              ballotIndex: ballotIndex ?? drawnIndex,
            }
          : { ...gameDto(initialPosition()), level, humanColor, ballotIndex: null },
      ),
    );
    return { client: { ...fakeClient(gameDto(initialPosition())), createGame }, createGame };
  }

  /** Připne skořápku s uloženou úrovní Mistrovství → automatická první hra = 1. kolo. */
  async function mountChampionship(client: ServerClient): Promise<{
    shell: ReturnType<typeof createAppShell>;
    created: FakeCtl[];
  }> {
    localStorage.setItem(LEVEL_KEY, 'championship');
    const { factory, created } = fakeFactory();
    const shell = createAppShell(client, { createController: factory });
    document.body.append(shell.element);
    await tick();
    return { shell, created };
  }

  it('1. kolo dohráno → po zavření modalu 2. kolo se STEJNÝM ballotem a člověkem BÍLÝM', async () => {
    const { client, createGame } = matchClient(42);
    const { shell, created } = await mountChampionship(client);
    expect(createGame).toHaveBeenNthCalledWith(1, 'championship', 'black');

    // 1. kolo dohráno (regulérní výsledek). Owed 2. kolo, ale ještě NEspuštěné –
    // modal 1. kola je otevřený (2. kolo naskočí až po jeho zavření).
    created[0]?.emit(OVER);
    await tick();
    expect(createGame).toHaveBeenCalledTimes(1);

    // Zavření modalu uživatelem → auto 2. kolo: stejný index 42, člověk bílý.
    click(q(shell.element, '.btn-modal-close'));
    await tick();
    expect(createGame).toHaveBeenNthCalledWith(2, 'championship', 'white', 42);
  });

  it('2. kolo dohráno → žádné 3. kolo; další partie až na „Nová hra"', async () => {
    const { client, createGame } = matchClient(42);
    const { shell, created } = await mountChampionship(client);

    created[0]?.emit(OVER); // 1. kolo
    await tick();
    click(q(shell.element, '.btn-modal-close')); // → 2. kolo
    await tick();
    expect(createGame).toHaveBeenCalledTimes(2);

    created[1]?.emit(OVER); // 2. kolo dohráno
    await tick();
    click(q(shell.element, '.btn-modal-close'));
    await tick();
    // Žádné 3. kolo se nespustilo.
    expect(createGame).toHaveBeenCalledTimes(2);

    // Nová hra → fresh 1. kolo (černá, BEZ indexu = jen 2 argumenty).
    click(q(shell.element, '.btn-newgame'));
    await tick();
    expect(createGame).toHaveBeenNthCalledWith(3, 'championship', 'black');
  });

  it('vzdání 1. kola ZRUŠÍ zápas → žádné 2. kolo (rozlišení přes příznak, ne výsledek)', async () => {
    // ZUB: emitovaný výsledek (white-wins) je IDENTICKÝ jako regulérní prohra, po
    // které by 2. kolo naskočilo (test výše). Že tady NEnaskočí, dokazuje, že
    // rozlišení jede přes příznak vzdání, ne přes result.
    const { client, createGame } = matchClient(42);
    const { shell, created } = await mountChampionship(client);

    click(q(shell.element, '.btn-resign')); // Vzdávám → inline potvrzení
    click(q(shell.element, '.btn-confirm-yes')); // Ano → resignedThisGame=true + resign()
    created[0]?.emit(OVER); // server ohlásí konec (stejný tvar jako prohra)
    await tick();
    click(q(shell.element, '.btn-modal-close'));
    await tick();

    expect(createGame).toHaveBeenCalledTimes(1); // zápas zrušen, žádné 2. kolo
  });

  it('SELHANÉ vzdání 1. kola zápas NEzruší: příznak se sundá → regulérní konec spustí 2. kolo', async () => {
    // ZUB self-review nálezu: resignedThisGame se nastaví optimisticky (kvůli timingu
    // terminálního onState uvnitř resign()), ale callback ho MUSÍ sundat, když vzdání
    // NEproběhlo (síť selhala → resync na ongoing). Bez toho by pozdější REGULÉRNÍ
    // konec 1. kola spadl do „zrušit zápas" a 2. kolo by nikdy nenaskočilo.
    const { client, createGame } = matchClient(42);
    const { shell, created } = await mountChampionship(client);

    click(q(shell.element, '.btn-resign'));
    click(q(shell.element, '.btn-confirm-yes')); // resignedThisGame=true + resign(cb)
    // Simuluj SELHANÉ vzdání: controller zavolá callback s false (resync na ongoing).
    const cb = created[0]?.resign.mock.calls[0]?.[0];
    cb?.(false);

    // Partie pak skončí REGULÉRNĚ (ne vzdáním) → zápas má pokračovat.
    created[0]?.emit(OVER);
    await tick();
    click(q(shell.element, '.btn-modal-close'));
    await tick();

    expect(createGame).toHaveBeenNthCalledWith(2, 'championship', 'white', 42);
  });

  it('2. kolo (člověk bílý, táhne první) drží zámek úrovně i bez prvního tahu', async () => {
    const { client } = matchClient(42);
    const { shell, created } = await mountChampionship(client);
    created[0]?.emit(OVER);
    await tick();
    click(q(shell.element, '.btn-modal-close')); // 2. kolo běží
    await tick();
    // 2. kolo: člověk bílý, po ballotu na tahu člověk (bílý+idle) → firstMoveMade
    // zůstane false. Select MUSÍ být přesto zamčený (matchActive), jinak by šel
    // rozehraný zápas přepnout na jinou úroveň a fixní ballot by dostal 400.
    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('ne-Mistrovství: žádný zápas, žádný ballotIndex; nextColor se střídá dál', async () => {
    const { client, createGame } = matchClient();
    const { shell, created } = await mountRunning(client); // Profesionál (bez uložené úrovně)
    expect(createGame).toHaveBeenNthCalledWith(1, 'professional', 'black');

    created[0]?.emit(OVER);
    await tick();
    expect(localStorage.getItem(NEXT_COLOR_KEY)).toBe('white'); // alternace beze změny
    click(q(shell.element, '.btn-modal-close'));
    await tick();
    expect(createGame).toHaveBeenCalledTimes(1); // zavření modalu nic nespustí

    click(q(shell.element, '.btn-newgame'));
    await tick();
    expect(createGame).toHaveBeenNthCalledWith(2, 'professional', 'white'); // 2 args, opačná barva
  });

  it('každý championship zápas začíná ČERNOU i po prokládané ne-championship hře', async () => {
    // ZUB fixní barvy: ne-championship hra překlopí nextColor na bílou. Kdyby
    // championship 1. kolo bralo barvu z alternace, začalo by bílou. Musí černou.
    const { client, createGame } = matchClient(42);
    const { shell, created } = await mountRunning(client); // Profesionál černá
    created[0]?.emit(OVER);
    await tick();
    click(q(shell.element, '.btn-modal-close'));
    await tick();
    expect(localStorage.getItem(NEXT_COLOR_KEY)).toBe('white');

    const select = q(shell.element, '.level-select') as HTMLSelectElement;
    select.value = 'championship'; // po konci partie změna úrovně sama nezaloží → Nová hra
    click(q(shell.element, '.btn-newgame'));
    await tick();
    expect(createGame).toHaveBeenLastCalledWith('championship', 'black');
  });

  it('dispose uprostřed owed 2. kola nezaloží zombie controller', async () => {
    const { client } = matchClient(42);
    const { shell, created } = await mountChampionship(client);
    created[0]?.emit(OVER); // owed 2. kolo
    await tick();
    shell.dispose(); // appka pryč PŘED zavřením modalu
    click(q(shell.element, '.btn-modal-close')); // pokus o auto-start
    await tick();
    // startNewGame se sice rozběhne, ale `disposed` guard po awaitu zabrání vzniku
    // controlleru 2. kola → žádný zombie s pollingem.
    expect(created).toHaveLength(1);
  });
});

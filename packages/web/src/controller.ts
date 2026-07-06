/**
 * Spojení modelu výběru (`selection`) s vykreslením (`board-view`) a s
 * autoritativním serverem.
 *
 * Klient UŽ NENÍ druhý rozhodčí: tah neaplikuje lokálně, ale pošle ho serveru
 * (`postMove`) a desku nastaví na `GameDto`, který server vrátí. Tah enginu
 * (bílý) zachytí opakované dotazování (`getGame` à 250 ms). `rules` v klientu
 * zůstávají jen na zvýrazňování legálních tahů (výběr kamene, dopady skoku) –
 * jediným zdrojem pravdy o stavu partie je server.
 *
 * Člověk hraje ČERNÉ (server má napevno engine = bílý). Vybírat a táhnout jde
 * jen když je na tahu člověk (`position.turn === 'black'`). POZOR: „černý táhne
 * první" NEplatí univerzálně – na úrovni Mistrovství server nasadí vylosované
 * zahájení a partie startuje s BÍLÝM na tahu, takže engine táhne první (jeho tah
 * chytí první poll stejně jako každý jiný). Interakce člověka „jen na tahu černého"
 * tím ale zůstává v platnosti.
 *
 * Single-flight: v jednu chvíli běží jen jeden request (POST tahu i GET poll).
 * `GameDto` nenese pořadové číslo, takže dva souběžné snímky nejde spolehlivě
 * seřadit – jediný request naráz ten závod obchází. Kliknutí během běžícího
 * requestu se ignoruje.
 */

import type { Color, GameResult, Position, Square } from '@checkers/rules';

import { createBoardView } from './board-view.js';
import type { DropOutcome, RenderState } from './board-view.js';
import { createSoundPlayer } from './sound.js';
import type { SoundEvent, SoundPlayer } from './sound.js';
import {
  capturedOnHop,
  capturesForPrefix,
  nextTargets,
  resolveChainTo,
  resolveMove,
  selectableAt,
} from './selection.js';
import type { EngineStatus, GameDto, MoveDto, ServerClient } from './server-client.js';

/** Snímek stavu partie pro skořápku (řídí řádek stavu a stav tlačítek). */
export interface GameStatus {
  readonly result: GameResult;
  readonly turn: Color;
  readonly engineStatus: EngineStatus;
}

/**
 * Výsledek nabídky remízy pro skořápku:
 * - `accepted` – engine remízu přijal (partie skončila `draw`),
 * - `declined` – engine odmítl, hra pokračuje,
 * - `error` – nabídku nešlo vyřídit (bez enginu, engine přemýšlí/selhal, síť);
 *   stav se dorovná ze serveru, skořápka jen ukáže hlášku.
 */
export type DrawOfferOutcome = 'accepted' | 'declined' | 'error';

/** Barva, kterou hraje člověk. Server má engine napevno jako bílého. */
const HUMAN_COLOR: Color = 'black';

/** Interval opakovaného dotazu na stav (kvůli tahu enginu na pozadí). */
const POLL_INTERVAL_MS = 250;

/** Prodleva zvuku konce partie po dokončení animace posledního tahu (ms). */
const END_SOUND_DELAY_MS = 500;

/**
 * Nejmenší „rozmýšlecí" pauza AI: od dokončení animace tahu člověka do zobrazení
 * tahu enginu uplyne aspoň tolik ms. Je to PODLAHA, ne přičtení – když engine
 * počítal dlouho (soft budget serveru je ~1 s), pauza už uplynula a nečeká se
 * znovu. Bez ní tah AI „problikne" hned po tahu člověka (u posledního tahu partie
 * nejvíc, protože už nenásleduje tah člověka, který by pauzu vyplnil). Serverová
 * pauza tenhle problém neřeší: běží souběžně s animací tahu člověka na klientu.
 */
const AI_MOVE_PAUSE_MS = 600;

/** Odloží běh o `ms`. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Engine (bílý) právě potáhl: dřív byl na tahu on (`prev.turn !== HUMAN_COLOR`) a
 * teď je zpět člověk (`next.turn === HUMAN_COLOR`). Vzdání během přemýšlení tohle
 * nespustí – mění výsledek, ne pozici, takže `prev.turn` zůstane bílý.
 *
 * Platí i pro PRVNÍ tah enginu u Mistrovství: počáteční pozice je tam bílý-na-tahu
 * (engine táhne první), takže první poll vidí přechod bílý→černý stejně jako
 * kterýkoli pozdější tah enginu. Žádný předchozí tah člověka není potřeba.
 */
function engineJustMoved(prev: Position, next: Position): boolean {
  return prev.turn !== HUMAN_COLOR && next.turn === HUMAN_COLOR;
}

/** Rozpracovaný výběr: výchozí kámen a už naklikané dopady (bez `from`). */
interface Selection {
  readonly from: Square;
  readonly path: readonly Square[];
}

/** Ovládaná deska připravená k vložení do stránky. */
export interface BoardController {
  readonly element: HTMLElement;
  /**
   * Vzdá partii. Počká na doběhnutí právě běžícího requestu (single-flight),
   * pak pošle vzdání serveru. Opakované volání během odesílání se ignoruje.
   */
  resign(): void;
  /**
   * Nabídne enginu remízu. Počká na doběhnutí běžícího requestu (single-flight),
   * pošle nabídku, převezme vrácený stav a vrátí verdikt enginu pro skořápku.
   * Opakované volání během vyřizování se ignoruje (vrátí `error`).
   */
  offerDraw(): Promise<DrawOfferOutcome>;
  /** Zastaví polling (uklidí interval). Volá se před „Nová hra"; slouží i testům. */
  dispose(): void;
}

export interface BoardControllerOptions {
  /** Perioda pollingu v ms (výchozí {@link POLL_INTERVAL_MS}). */
  readonly pollIntervalMs?: number;
  /**
   * Nejmenší rozmýšlecí pauza AI v ms (viz {@link AI_MOVE_PAUSE_MS}). Injektovatelná
   * kvůli testům – ty si dávají 0, ať nečekají skoro sekundu na tah enginu.
   */
  readonly aiMovePauseMs?: number;
  /**
   * Volá se po každém převzetí stavu ze serveru (z pollu i z odpovědí na tah /
   * vzdání) a jednou na začátku s výchozím stavem. Skořápka podle něj kreslí
   * řádek stavu a povoluje/zakazuje tlačítka.
   */
  readonly onState?: (status: GameStatus) => void;
  /**
   * Přehrávač zvuků (rozjezd/dopad kamene v animaci a fanfára/zvuk prohry na
   * konci partie). Injektovatelný kvůli testu; výchozí je reálný přehrávač
   * (no-op v prostředí bez `Audio`).
   */
  readonly soundPlayer?: SoundPlayer;
}

/**
 * Vytvoří desku napojenou na server. `game` je počáteční stav (typicky z
 * `POST /games`); `client` obstarává komunikaci se serverem.
 */
export function createBoardController(
  client: ServerClient,
  game: GameDto,
  options: BoardControllerOptions = {},
): BoardController {
  let position = game.position;
  let selection: Selection | null = null;
  // `true`, dokud běží nějaký request (POST tahu / GET poll / vzdání). Drží
  // single-flight i zámek proti klikání během odesílání tahu.
  let busy = false;
  // Promise právě běžícího requestu (jinak už splněná). `resign()` na ni počká,
  // aby vzdání nikdy nekolidovalo s rozběhnutým tahem/pollem (rozhodnutí 1a).
  let inflight: Promise<void> = Promise.resolve();
  // Zámek proti dvojímu odeslání vzdání (dvojklik / opakované potvrzení).
  let resigning = false;
  // Zámek proti dvojí nabídce remízy (dvojklik / než dorazí verdikt enginu).
  let offering = false;
  // Poslední výsledek viděný ze serveru – aby vzdání zbytečně nešlo do skončené partie.
  let lastResult: GameResult = game.result;
  // `true` po dispose(): rozdělaný request (poll/tah) se může dořešit až potom –
  // nesmí ale překreslit desku ani ohlásit stav (jinak by přepsal stav už
  // vyměněné partie po „Nová hra").
  let disposed = false;
  // Naplánovaný (zpožděný) zvuk konce partie – ruší se při dispose (nová hra).
  let endSoundTimer: ReturnType<typeof setTimeout> | null = null;
  // Promise animace posledního převzatého tahu (vyřeší se po jejím doběhnutí nebo
  // přerušení). Poll na ni počká, než pustí tah enginu, ať neusekne animaci tahu
  // člověka a pauza se měří až od jejího konce.
  let lastRender: Promise<void> = Promise.resolve();
  // `performance.now()` okamžiku, kdy doanimoval poslední tah ČLOVĚKA – od něj se
  // měří rozmýšlecí pauza AI. 0 = ještě žádný tah člověka (pak se nečeká).
  let humanMoveAnimEndAt = 0;
  // `true`, když další stav ze serveru potvrzuje tah, který člověk provedl TAŽENÍM
  // (kámen už je rukou na cíli) → deska se má usadit BEZ animace a bez zvuku
  // rozjezdu (`settle`), ne přehrát sklouznutí podruhé. Jednorázové: po použití se
  // shodí. Klikací (tap) tahy ho nenastavují, ty se dál animují jako dřív.
  let settleNext = false;
  // `true` mezi zvednutím a puštěním kamene (kámen je „v ruce"). Po tuhle dobu se
  // polling přeskočí, ať překreslení nesahá na ručně přesouvaný kámen.
  let dragging = false;
  // Režim Výuka (nese ho úroveň partie ze serveru, fixní po celou partii). Jen
  // tady se hráči na jeho tahu ukazuje nápověda enginu; jinde se hint nedotkne.
  const educationMode = game.level === 'education';
  // Doporučený tah pro AKTUÁLNÍ tah člověka (režim Výuka), nebo null. Ukazuje se jen
  // když člověk zrovna nemá rozpracovaný vlastní výběr (ten má přednost).
  let hintMove: MoveDto | null = null;
  // `true`, když se pro tenhle tah člověka nápověda už načetla / načítá – ať ji poll
  // (à 250 ms) nespouští znovu a znovu. Shazuje se při změně tahu a odeslání tahu.
  let hintRequested = false;

  const aiMovePauseMs = options.aiMovePauseMs ?? AI_MOVE_PAUSE_MS;
  const onState = options.onState;
  const gameId = game.id;
  const player = options.soundPlayer ?? createSoundPlayer();
  const view = createBoardView(handleClick, player, {
    canDrag,
    onDragStart,
    onDrop,
  });
  const timer = setInterval(() => {
    void tickLoop();
  }, options.pollIntervalMs ?? POLL_INTERVAL_MS);

  /**
   * Jeden tik smyčky: nejdřív poll (uvidí tah enginu), pak případně načte nápovědu.
   * Hint se spouští AŽ po pollu (ne uvnitř `applyServerState`), aby se jeho
   * `runRequest` nezanořil do právě běžícího requestu a nerozbil `busy`/`inflight`.
   */
  async function tickLoop(): Promise<void> {
    await poll();
    maybeRequestHint();
  }

  function handleClick(square: Square | null): void {
    // Když běží request nebo není na tahu člověk (engine přemýšlí), klik zahodíme.
    // Bez kontroly barvy by šlo vybrat bílý kámen (selectableAt jen porovnává
    // cell.color === turn), zahrát za engine a dostat 409.
    if (busy || position.turn !== HUMAN_COLOR) {
      return;
    }

    if (square === null) {
      selection = null;
    } else if (selection !== null && isTarget(square)) {
      advance(square);
      return; // advance si řídí render sám (i asynchronně po odeslání tahu)
    } else if (selectableAt(position, square) && !isSelectedFrom(square)) {
      // Nový výběr vlastního kamene (i přepnutí z jiného). Klik na už vybraný
      // výchozí kámen sem nespadne – padá do else a výběr se zruší.
      selection = { from: square, path: [] };
    } else {
      selection = null;
    }
    // Statické překreslení (bez animace): u rozpracovaného braní kámen „doskočí" na
    // poslední dopad, u výběru/zrušení jen srovná zvýraznění a případně kámen vrátí.
    renderStatic();
  }

  /** `true`, pokud `square` je jedním z aktuálně nabízených dalších dopadů. */
  function isTarget(square: Square): boolean {
    return selection !== null && nextTargets(position, selection.from, selection.path).includes(square);
  }

  function isSelectedFrom(square: Square): boolean {
    return selection !== null && selection.from === square;
  }

  /** Prodlouží sekvenci o dopad `square`; když je tah kompletní, odešle ho serveru. */
  function advance(square: Square): void {
    if (selection === null) {
      return;
    }
    const path = [...selection.path, square];
    if (nextTargets(position, selection.from, path).length > 0) {
      selection = { from: selection.from, path }; // ještě pokračuje (další dopad/větvení)
      renderStatic(); // kámen doskočí na tento dopad (bez animace), sebrané zmizí
      return;
    }
    // Žádné pokračování → sekvence je úplná. Server dostane výchozí pole a CELOU
    // naklikanou cestu; `path` smí mít duplicity (kruhový skok dámy), proto se
    // posílá tak, jak je – bez redukce přes Set. Legalitu ověří server. Jednoduchý
    // (jednodopadový) tah se animuje jako dřív; víceskok už kámen „doskákal", takže
    // se jen usadí (settle), aby se nepřehrával podruhé.
    submitMove(selection.from, path, path.length === 1);
  }

  /**
   * Spustí `op` jako JEDINÝ běžící request: nastaví `busy` a uloží promise do
   * `inflight`, ať na ni `resign()` může počkat (1a). `op` si řeší vlastní chyby
   * – runRequest jen garantuje, že se `busy` po dokončení uvolní.
   */
  function runRequest(op: () => Promise<void>): Promise<void> {
    busy = true;
    inflight = (async () => {
      try {
        await op();
      } finally {
        busy = false;
      }
    })();
    return inflight;
  }

  /**
   * Odešle tah serveru a desku nastaví na vrácený stav. Výběr se zruší hned
   * (zvýraznění zmizí bez sáhnutí na kameny). `animate` řídí, jak se potvrzení ze
   * serveru vykreslí:
   * - `true` (jednoduchý jednodopadový tah) – kámen se plynule přesune z výchozího
   *   pole na cíl (animace tahu jako dřív),
   * - `false` (víceskok, který už kámen „doskákal" po dopadech, i tah tažením) –
   *   kámen je už na cíli, potvrzení se jen USADÍ (`settle`) bez animace a bez zvuku
   *   rozjezdu, aby se pohyb nepřehrával podruhé.
   * Selhání (odmítnutí, síť) neshodí desku: `settleNext` se shodí a stav se dorovná
   * z GET (kámen se vrátí na výchozí pole, sebrané se obnoví).
   */
  function submitMove(from: Square, path: readonly Square[], animate: boolean): void {
    settleNext = !animate;
    selection = null;
    // Člověk potáhl → nápověda dosloužila: zhasni ji hned (ne až dorazí stav ze
    // serveru) a povol novou. Když server tah odmítne a člověk zůstane na tahu,
    // `tickLoop` mu nápovědu zase načte (hintRequested=false).
    hintMove = null;
    hintRequested = false;
    view.setHighlights(currentRenderState()); // zhasni zvýraznění; kamenů se nedotýkej
    void runRequest(async () => {
      try {
        applyServerState(await client.postMove(gameId, from, path));
      } catch (error) {
        console.error('Server tah nepřijal, synchronizuji stav ze serveru:', error);
        settleNext = false;
        await resync();
        renderStatic();
      }
    });
  }

  /**
   * Opakovaný dotaz na stav – takhle klient uvidí tah enginu. Single-flight:
   * když už request běží (odesílá se tah / vzdání / běží jiný poll), tik se přeskočí.
   */
  async function poll(): Promise<void> {
    if (busy || dragging) {
      // Jiný request běží (single-flight), nebo má člověk kámen „v ruce" (tažení) –
      // překreslení by sáhlo na ručně přesouvaný kámen. Tik zahodíme.
      return;
    }
    await runRequest(async () => {
      try {
        const dto = await client.getGame(gameId);
        // Detekce tahu enginu stojí na kontraktu serveru: `postMove` vrací stav
        // PO tahu člověka (na tahu bílý = engine), tah enginu dorazí až tímhle
        // pollem jako přechod bílý→černý. (Serverový test „POST vrátí HNED stav …
        // thinking" ten kontrakt přibíjí; kdyby server začal balit tah enginu
        // rovnou do odpovědi na postMove, floor by se tiše přestal aplikovat.)
        if (engineJustMoved(position, dto.position)) {
          // Tah enginu je připravený. Ať ale „neproblikne" hned po tvém tahu:
          // počkej, až doanimuje tvůj tah (`lastRender` – jinak by ho nová animace
          // usekla), a od jeho konce nech uplynout aspoň `aiMovePauseMs`. Podlaha,
          // ne přičtení: když engine počítal dlouho, `elapsed` už práh překročil a
          // nespí se. Během čekání drží `busy` single-flight, další poll se přeskočí.
          // DŮSLEDEK: klik na Vzdát/Nabídnout remízu podaný během téhle pauzy se
          // NEZTRATÍ (resignFlow/offerDraw čeká na `inflight`), ale vyřídí se až po
          // pauze (≤ aiMovePauseMs, u víceskoku + délka animace). Vědomý kompromis
          // za znatelnou pauzu; tah AI je zrovna „na cestě", takže je to krátké.
          await lastRender;
          const elapsed = performance.now() - humanMoveAnimEndAt;
          const remaining = aiMovePauseMs - elapsed;
          if (remaining > 0) {
            await sleep(remaining);
          }
          if (disposed) {
            return; // „Nová hra" během pauzy – stav vyměněné partie nepřepisuj
          }
        }
        applyServerState(dto);
      } catch (error) {
        console.error('Dotaz na stav partie selhal:', error);
      }
    });
  }

  /**
   * Načte nápovědu enginu pro AKTUÁLNÍ tah člověka (režim Výuka) a zvýrazní ji.
   * Jde přes stejný single-flight `runRequest` (busy) jako ostatní dotazy: po dobu
   * ~1 s výpočtu deska nepustí klik/tažení, takže „překryv" nápovědy a tahu vůbec
   * nevznikne. Volá se JEN mimo běžící request (z `tickLoop` po pollu / při startu),
   * ať se `runRequest` nezanoří. Fetchne nejvýš JEDNOU za tah člověka (`hintRequested`).
   *
   * Selhání (`/hint` 503 timeout/pád enginu, síť) se spolkne: nápověda se prostě
   * neukáže, deska se odblokuje (`runRequest` finally) a hraje se bez rady.
   */
  function maybeRequestHint(): void {
    const getHint = client.getHint;
    if (
      !educationMode ||
      getHint === undefined ||
      disposed ||
      busy ||
      dragging ||
      hintRequested ||
      lastResult !== 'ongoing' ||
      position.turn !== HUMAN_COLOR ||
      selection !== null
    ) {
      return;
    }
    hintRequested = true;
    void runRequest(async () => {
      try {
        const move = await getHint(gameId);
        // Po awaitu ověř, že rada pořád platí pro AKTUÁLNÍ stav: nová hra (disposed),
        // změna tahu, konec partie nebo rozjetý vlastní výběr → radu zahoď.
        if (disposed || position.turn !== HUMAN_COLOR || lastResult !== 'ongoing' || selection !== null) {
          return;
        }
        hintMove = move;
        view.setHighlights(currentRenderState());
      } catch (error) {
        console.error('Nápovědu se nepodařilo načíst, hraje se bez ní:', error);
      }
    });
  }

  /**
   * Vzdá partii. Rozhodnutí 1a: nejdřív POČKÁ, až doběhne případný běžící request
   * (tah/poll), teprve pak pošle vzdání – klik nesmí tiše propadnout kvůli
   * single-flightu. `resigning` blokuje dvojí odeslání; skončenou partii nevzdává.
   */
  function resign(): void {
    // Vzdání je uživatelský gest – odemkni audio, ať zvuk prohry zazní i když
    // hráč do desky předtím nikdy neklikl (autoplay policy).
    player.unlock();
    void resignFlow();
  }

  async function resignFlow(): Promise<void> {
    if (resigning || lastResult !== 'ongoing') {
      return;
    }
    resigning = true;
    try {
      while (busy) {
        await inflight; // po doběhnutí requestu je busy=false; pak jsme na řadě my
      }
      // Během čekání mohl poll dorovnat stav na terminální (engine vyhrál /
      // přirozený konec) nebo se controller stihl disposnout – pak už nevzdávej.
      if (disposed || lastResult !== 'ongoing') {
        return;
      }
      await runRequest(async () => {
        try {
          applyServerState(await client.resign(gameId));
        } catch (error) {
          console.error('Vzdání se nepodařilo odeslat, synchronizuji stav:', error);
          await resync();
        } finally {
          void render();
        }
      });
    } finally {
      resigning = false;
    }
  }

  /**
   * Nabídne enginu remízu. Stejná koordinace jako `resign()` (rozhodnutí 1a):
   * počká na běžící request, drží zámek proti dvojkliku, jde single-flightem.
   * Vrací verdikt enginu; `error` když nabídku nešlo vyřídit (guard, síť,
   * serverová chyba). Stav partie se v každém případě dorovná ze serveru.
   */
  function offerDraw(): Promise<DrawOfferOutcome> {
    player.unlock(); // uživatelský gest – viz resign()
    return offerDrawFlow();
  }

  async function offerDrawFlow(): Promise<DrawOfferOutcome> {
    if (offering || lastResult !== 'ongoing') {
      return 'error';
    }
    offering = true;
    try {
      while (busy) {
        await inflight; // po doběhnutí requestu je busy=false; pak jsme na řadě my
      }
      if (disposed || lastResult !== 'ongoing') {
        return 'error';
      }
      let outcome: DrawOfferOutcome = 'error';
      await runRequest(async () => {
        try {
          const offer = await client.offerDraw(gameId);
          applyServerState(offer.game);
          outcome = offer.accepted ? 'accepted' : 'declined';
        } catch (error) {
          console.error('Nabídka remízy se nepodařila, synchronizuji stav:', error);
          await resync();
          outcome = 'error';
        } finally {
          void render();
        }
      });
      return outcome;
    } finally {
      offering = false;
    }
  }

  /** Dorovnání stavu ze serveru po neúspěšném tahu. Nikdy nevyhazuje. */
  async function resync(): Promise<void> {
    try {
      applyServerState(await client.getGame(gameId));
    } catch (error) {
      console.error('Dorovnání stavu selhalo, deska zůstává na poslední pozici:', error);
    }
  }

  /** Přebere plný stav ze serveru, překreslí a ohlásí stav skořápce. */
  function applyServerState(dto: GameDto): void {
    if (disposed) {
      return; // request doběhl až po dispose – stav vyměněné partie nepřepisuj
    }
    const prevTurn = position.turn;
    position = dto.position;
    const prevResult = lastResult;
    lastResult = dto.result;
    if (educationMode && prevTurn !== dto.position.turn) {
      // Tah se změnil (engine potáhl / člověk potáhl) → stará nápověda už neplatí.
      // Zahoď ji a povol načtení nové; samotný fetch spustí `tickLoop` (ne odsud –
      // jsme uvnitř běžícího requestu a `runRequest` by se zanořil).
      hintMove = null;
      hintRequested = false;
    }
    if (dto.engineStatus === 'error') {
      // Engine selhal – partie stojí na tahu člověka nebo čeká; skořápka to podle
      // engineStatus může zobrazit. Tady jen nezaseknout a nechat stopu v konzoli.
      console.error('Engine hlásí chybu (engineStatus=error).');
    }
    // `render()` spustí animaci tohoto tahu; jeho příslib se vyřeší až po jejím
    // dokončení. Zvuk konce partie na něj navážeme, ať fanfára/prohra zazní až
    // PO posledním dopadu vítězného tahu, ne na jeho začátku. USADÍME bez animace
    // (settle), když: (a) tah člověk dokončil tažením / víceskokem (`settleNext`) –
    // kámen je už na cíli, nebo (b) běží rozpracovaná sekvence (poll uprostřed
    // braní) – to by jinak `update` animovalo „doskočení" kamene, který už na
    // dopadu opticky je, a navíc přehrálo zvuk rozjezdu.
    const useSettle = settleNext || (selection !== null && selection.path.length > 0);
    settleNext = false;
    let rendered: Promise<void>;
    if (useSettle) {
      view.settle(currentRenderState());
      rendered = Promise.resolve();
    } else {
      rendered = render();
    }
    lastRender = rendered;
    if (prevTurn === HUMAN_COLOR && dto.position.turn !== HUMAN_COLOR) {
      // Přechod tah ČLOVĚKA → na tahu engine, tj. člověk PRÁVĚ potáhl. Nastav se
      // JEN tady (ne při opakovaných „thinking" pollech, které vrací tutéž pozici
      // s bílým na tahu – jinak by se známka pořád posouvala a pauza by se dlouho
      // počítaným tahům přičítala místo aby byla jen podlaha). Čas bereme po
      // dokončení animace tahu (`rendered`), od něj se měří rozmýšlecí pauza AI.
      void rendered.then(() => {
        humanMoveAnimEndAt = performance.now();
      });
    }
    onState?.({ result: dto.result, turn: dto.position.turn, engineStatus: dto.engineStatus });

    // Zvuk konce partie zazní JEDNOU, na přechodu ongoing → terminální stav (ne
    // při načtení už skončené partie a ne opakovaně dalšími polly). Výhra hraje
    // fanfáru, prohra zvuk prohry, remíza zvuk remízy. Člověk hraje černé
    // (HUMAN_COLOR).
    if (prevResult === 'ongoing' && dto.result !== 'ongoing') {
      // Mapa terminální výsledek → zvuk. `Record<Exclude<…>>` (stejně jako
      // server/CLI) je exhaustivní: kdyby do GameResult přibyla další terminální
      // hodnota, tady se to hlasitě rozbije při kompilaci, ne že by se pro ni
      // tiše zahrál zvuk remízy. Výhra/prohra závisí na tom, kdo je člověk.
      const humanWins: SoundEvent = 'win';
      const humanLoses: SoundEvent = 'loss';
      const soundByResult: Record<Exclude<GameResult, 'ongoing'>, SoundEvent> = {
        'black-wins': HUMAN_COLOR === 'black' ? humanWins : humanLoses,
        'white-wins': HUMAN_COLOR === 'black' ? humanLoses : humanWins,
        draw: 'draw',
      };
      scheduleEndSound(rendered, dto.result, soundByResult[dto.result]);
    }
  }

  /**
   * Přehraje zvuk konce partie AŽ po dokončení animace vítězného/prohrávajícího
   * tahu (`rendered`) a ještě po prodlevě {@link END_SOUND_DELAY_MS}, ať nespadne
   * na poslední dopad. Nezahraje, pokud se mezitím controller disposnul (nová
   * hra) nebo se výsledek změnil.
   */
  function scheduleEndSound(rendered: Promise<void>, result: GameResult, event: SoundEvent): void {
    void rendered.then(() => {
      if (disposed || lastResult !== result) {
        return;
      }
      endSoundTimer = setTimeout(() => {
        endSoundTimer = null;
        if (disposed || lastResult !== result) {
          return;
        }
        player.play(event);
      }, END_SOUND_DELAY_MS);
    });
  }

  /** Pole, na kterém pohyblivý kámen právě opticky STOJÍ (poslední dopad, nebo výchozí). */
  function lastHopOf(sel: Selection): Square {
    return sel.path.length > 0 ? (sel.path[sel.path.length - 1] ?? sel.from) : sel.from;
  }

  /**
   * „Optimistická" pozice pro ZOBRAZENÍ rozpracovaného braní: pohyblivý kámen je
   * přesunutý z výchozího pole na poslední dopad a dosud sebrané kameny jsou
   * schované. Server je potvrdí až s celým tahem, ale klient je ukazuje hned, aby
   * kámen „zůstal" na dopadu a čekal na další skok. Proměna (man→king) se NEřeší –
   * tu potvrdí server na konci tahu. Prázdné výchozí pole (obrana) → beze změny.
   */
  function effectivePosition(sel: Selection): Position {
    const moving = position.board[sel.from - 1] ?? null;
    if (moving === null) {
      return position;
    }
    const captured = capturesForPrefix(position, sel.from, sel.path);
    const landing = lastHopOf(sel);
    const board = position.board.slice();
    board[sel.from - 1] = null;
    for (const c of captured) {
      board[c - 1] = null;
    }
    board[landing - 1] = moving;
    return { board, turn: position.turn };
  }

  /**
   * Stav k vykreslení. Bez výběru = holá pozice. S vybraným kamenem bez dopadů =
   * výběr výchozího kamene (zvýrazní cíle). S rozpracovaným braním = kámen opticky
   * na posledním dopadu (`effectivePosition`), výběr na tom dopadu a trasa (výchozí
   * pole + předchozí dopady) jako `path`; cíle se počítají z REÁLNÉ pozice.
   */
  /**
   * Nápověda k vykreslení (režim Výuka): výchozí pole + poslední dopad doporučeného
   * tahu. Ukáže se JEN když člověk nemá rozpracovaný vlastní výběr (ten má přednost)
   * a nápověda pro tenhle tah existuje. Bez ní `undefined` → deska nic nekreslí.
   */
  function currentHint(): { from: Square; to: Square } | undefined {
    // `lastResult !== 'ongoing'`: na skončené partii radu NEUKAZUJ. Konec bez změny
    // tahu (vzdání, přijatá remíza – mění výsledek, ne pozici) reset v
    // `applyServerState` (jen na změnu tahu) nechytí; guard tady pokryje i takové
    // terminální cesty na jediném místě, kde se o zobrazení rozhoduje.
    if (hintMove === null || selection !== null || lastResult !== 'ongoing') {
      return undefined;
    }
    const to = hintMove.path[hintMove.path.length - 1];
    return to === undefined ? undefined : { from: hintMove.from, to };
  }

  function currentRenderState(): RenderState {
    if (selection === null) {
      const hint = currentHint();
      // exactOptionalPropertyTypes: `hint` se přidá jen když existuje (ne `undefined`).
      return { position, selected: null, path: [], targets: [], ...(hint === undefined ? {} : { hint }) };
    }
    if (selection.path.length === 0) {
      return {
        position,
        selected: selection.from,
        path: [],
        targets: nextTargets(position, selection.from, []),
      };
    }
    return {
      position: effectivePosition(selection),
      selected: lastHopOf(selection),
      path: [selection.from, ...selection.path.slice(0, -1)],
      targets: nextTargets(position, selection.from, selection.path),
    };
  }

  /**
   * Překreslí desku S ANIMACÍ tahu (`view.update`). Vrací příslib, který se vyřeší
   * po dokončení/přerušení animace – využívá ho `applyServerState` pro zvuk konce
   * partie. Pro tahy člověka provedené po dopadech/tažením se místo toho usazuje
   * (`renderStatic`/`settle`), ať se pohyb nepřehrává podruhé.
   */
  function render(): Promise<void> {
    return view.update(currentRenderState());
  }

  /** Statické překreslení bez animace tahu (usadí kameny i zvýraznění na aktuální stav). */
  function renderStatic(): void {
    view.settle(currentRenderState());
  }

  /**
   * Smí se kámen na `square` právě táhnout? Jen na tahu člověka, když neběží
   * request a partie běží. Během rozpracované sekvence je tažitelný jen kámen na
   * POSLEDNÍM dopadu (`lastHopOf`) – tam totiž kámen opticky stojí a odtud skáče
   * dál; jinak libovolný vlastní kámen. `canDrag` je jen UX předfiltr, legalitu
   * drží `onDrop` + server.
   */
  function canDrag(square: Square): boolean {
    if (busy || dragging || position.turn !== HUMAN_COLOR || lastResult !== 'ongoing') {
      return false;
    }
    if (selection !== null && selection.path.length > 0) {
      return square === lastHopOf(selection);
    }
    return selectableAt(position, square);
  }

  /**
   * Tažení začalo na `square`: nastav výběr (nebo pokračuj v rozpracované sekvenci,
   * když se zvedá kámen na posledním dopadu) a zvýrazni cíle. Kameny se nepřekreslují
   * (`setHighlights`, ne `render`) – tažený kámen je zvednutý deskou.
   */
  function onDragStart(square: Square): void {
    if (!canDrag(square)) {
      return;
    }
    dragging = true;
    const continuing =
      selection !== null && selection.path.length > 0 && square === lastHopOf(selection);
    if (!continuing) {
      selection = { from: square, path: [] };
    }
    view.setHighlights(currentRenderState());
  }

  /**
   * Kámen zvednutý na poli `origin` (poslední dopad, nebo výchozí pole) byl puštěn
   * nad polem `to`. Rozhodne, co se stane, a vrátí verdikt desce (viz
   * {@link DropOutcome}). Legalitu čerpá z `rules` (`selection`); dokončený tah
   * rovnou pošle serveru (`submitMove`). Nelegální/mimo puštění vrací kámen beze
   * změny – ověření navíc dělá i server.
   */
  function onDrop(origin: Square, to: Square | null): DropOutcome {
    dragging = false;
    // Konzistenční pojistka: bez odpovídajícího výběru, mimo tah, nebo když se zvedlo
    // z jiného pole než kde kámen opticky stojí → kámen jen vrať.
    if (busy || position.turn !== HUMAN_COLOR || selection === null || origin !== lastHopOf(selection)) {
      return { kind: 'return' };
    }
    if (to === null) {
      return { kind: 'return' };
    }
    const from = selection.from;
    const prefix = selection.path;
    if (nextTargets(position, from, prefix).includes(to)) {
      const newPath = [...prefix, to];
      const captured = capturedOnHop(position, from, prefix, to);
      if (nextTargets(position, from, newPath).length > 0) {
        // Meziskok: kámen ZŮSTANE na `to` a čeká na další skok. Výběr se posune,
        // zvýraznění se srovná; kámen na dopad usadí deska (`hop` níže). Další
        // překreslení (poll/tap) odvodí totéž zobrazení z výběru (effectivePosition),
        // takže se sebraný kámen „nevzkřísí".
        selection = { from, path: newPath };
        view.setHighlights(currentRenderState());
        return { kind: 'hop', landing: to, captured };
      }
      // Tento dopad tah dokončí.
      const move = resolveMove(position, from, newPath);
      if (move === null) {
        return { kind: 'return' }; // obrana: nemělo by nastat (dopad bez pokračování = hotový tah)
      }
      submitMove(move.from, move.path, false); // tažením → usadit bez animace
      return { kind: 'commit', landing: to, captured };
    }
    // `to` není bezprostřední dopad → zkus celý řetěz končící v `to` (souvislé tažení).
    const chain = resolveChainTo(position, from, prefix, to);
    if (chain !== null) {
      submitMove(chain.from, chain.path, false);
      return { kind: 'commit', landing: to, captured: chain.captures.slice(prefix.length) };
    }
    // Nelegální puštění → vrať kámen; rozpracovanou sekvenci nech být (jde zkusit znovu).
    return { kind: 'return' };
  }

  void render();
  // Výchozí stav ohlásíme hned, ať skořápka nakreslí řádek stavu a nastaví
  // tlačítka správně ještě před prvním pollem.
  onState?.({ result: game.result, turn: game.position.turn, engineStatus: game.engineStatus });
  // Ve Výuce s člověkem na tahu (typicky první tah partie – černý začíná) načti
  // nápovědu hned, ať se nečeká až na první tik pollu. Mimo Výuku no-op.
  maybeRequestHint();
  return {
    element: view.element,
    resign,
    offerDraw,
    dispose: () => {
      disposed = true;
      clearInterval(timer);
      if (endSoundTimer !== null) {
        clearTimeout(endSoundTimer); // zahoď naplánovaný zvuk konce (nová hra)
        endSoundTimer = null;
      }
      view.dispose(); // ukonči případnou běžící animaci tahu (WAAPI + časovače)
    },
  };
}

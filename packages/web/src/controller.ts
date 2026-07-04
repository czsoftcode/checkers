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
 * jen když je na tahu člověk (`position.turn === 'black'`).
 *
 * Single-flight: v jednu chvíli běží jen jeden request (POST tahu i GET poll).
 * `GameDto` nenese pořadové číslo, takže dva souběžné snímky nejde spolehlivě
 * seřadit – jediný request naráz ten závod obchází. Kliknutí během běžícího
 * requestu se ignoruje.
 */

import type { Color, GameResult, Square } from '@checkers/rules';

import { createBoardView } from './board-view.js';
import { nextTargets, selectableAt } from './selection.js';
import type { EngineStatus, GameDto, ServerClient } from './server-client.js';

/** Snímek stavu partie pro skořápku (řídí řádek stavu a stav tlačítek). */
export interface GameStatus {
  readonly result: GameResult;
  readonly turn: Color;
  readonly engineStatus: EngineStatus;
}

/** Barva, kterou hraje člověk. Server má engine napevno jako bílého. */
const HUMAN_COLOR: Color = 'black';

/** Interval opakovaného dotazu na stav (kvůli tahu enginu na pozadí). */
const POLL_INTERVAL_MS = 250;

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
  /** Zastaví polling (uklidí interval). Volá se před „Nová hra"; slouží i testům. */
  dispose(): void;
}

export interface BoardControllerOptions {
  /** Perioda pollingu v ms (výchozí {@link POLL_INTERVAL_MS}). */
  readonly pollIntervalMs?: number;
  /**
   * Volá se po každém převzetí stavu ze serveru (z pollu i z odpovědí na tah /
   * vzdání) a jednou na začátku s výchozím stavem. Skořápka podle něj kreslí
   * řádek stavu a povoluje/zakazuje tlačítka.
   */
  readonly onState?: (status: GameStatus) => void;
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
  // Poslední výsledek viděný ze serveru – aby vzdání zbytečně nešlo do skončené partie.
  let lastResult: GameResult = game.result;
  // `true` po dispose(): rozdělaný request (poll/tah) se může dořešit až potom –
  // nesmí ale překreslit desku ani ohlásit stav (jinak by přepsal stav už
  // vyměněné partie po „Nová hra").
  let disposed = false;

  const onState = options.onState;
  const gameId = game.id;
  const view = createBoardView(handleClick);
  const timer = setInterval(() => {
    void poll();
  }, options.pollIntervalMs ?? POLL_INTERVAL_MS);

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
    render();
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
      render();
      return;
    }
    // Žádné pokračování → sekvence je úplná. Server dostane výchozí pole a CELOU
    // naklikanou cestu; `path` smí mít duplicity (kruhový skok dámy), proto se
    // posílá tak, jak je – bez redukce přes Set. Legalitu ověří server.
    sendMove(selection.from, path);
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
   * (zvýraznění zmizí), kámen se přesune až po odpovědi serveru – bez
   * optimistického předběhnutí. Selhání (odmítnutí, síť) neshodí desku: stav se
   * dorovná z GET a klik se zase povolí.
   */
  function sendMove(from: Square, path: readonly Square[]): void {
    selection = null;
    render();
    void runRequest(async () => {
      try {
        applyServerState(await client.postMove(gameId, from, path));
      } catch (error) {
        console.error('Server tah nepřijal, synchronizuji stav ze serveru:', error);
        await resync();
      } finally {
        render();
      }
    });
  }

  /**
   * Opakovaný dotaz na stav – takhle klient uvidí tah enginu. Single-flight:
   * když už request běží (odesílá se tah / vzdání / běží jiný poll), tik se přeskočí.
   */
  async function poll(): Promise<void> {
    if (busy) {
      return; // jiný request běží – tenhle tik zahodíme (single-flight)
    }
    await runRequest(async () => {
      try {
        applyServerState(await client.getGame(gameId));
      } catch (error) {
        console.error('Dotaz na stav partie selhal:', error);
      }
    });
  }

  /**
   * Vzdá partii. Rozhodnutí 1a: nejdřív POČKÁ, až doběhne případný běžící request
   * (tah/poll), teprve pak pošle vzdání – klik nesmí tiše propadnout kvůli
   * single-flightu. `resigning` blokuje dvojí odeslání; skončenou partii nevzdává.
   */
  function resign(): void {
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
          render();
        }
      });
    } finally {
      resigning = false;
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
    position = dto.position;
    lastResult = dto.result;
    if (dto.engineStatus === 'error') {
      // Engine selhal – partie stojí na tahu člověka nebo čeká; skořápka to podle
      // engineStatus může zobrazit. Tady jen nezaseknout a nechat stopu v konzoli.
      console.error('Engine hlásí chybu (engineStatus=error).');
    }
    render();
    onState?.({ result: dto.result, turn: dto.position.turn, engineStatus: dto.engineStatus });
  }

  function render(): void {
    view.update(
      selection === null
        ? { position, selected: null, path: [], targets: [] }
        : {
            position,
            selected: selection.from,
            path: selection.path,
            targets: nextTargets(position, selection.from, selection.path),
          },
    );
  }

  render();
  // Výchozí stav ohlásíme hned, ať skořápka nakreslí řádek stavu a nastaví
  // tlačítka správně ještě před prvním pollem.
  onState?.({ result: game.result, turn: game.position.turn, engineStatus: game.engineStatus });
  return {
    element: view.element,
    resign,
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  };
}

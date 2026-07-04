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

import type { Color, Square } from '@checkers/rules';

import { createBoardView } from './board-view.js';
import { nextTargets, selectableAt } from './selection.js';
import type { GameDto, ServerClient } from './server-client.js';

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
  /** Zastaví polling (uklidí interval). V SPA se běžně nevolá; slouží testům. */
  dispose(): void;
}

export interface BoardControllerOptions {
  /** Perioda pollingu v ms (výchozí {@link POLL_INTERVAL_MS}). */
  readonly pollIntervalMs?: number;
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
  // `true`, dokud běží nějaký request (POST tahu nebo GET poll). Drží single-flight
  // i zámek proti klikání během odesílání tahu.
  let busy = false;

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
    void sendMove(selection.from, path);
  }

  /**
   * Odešle tah serveru a desku nastaví na vrácený stav. Výběr se zruší hned
   * (zvýraznění zmizí), kámen se přesune až po odpovědi serveru – bez
   * optimistického předběhnutí. Selhání (odmítnutí, síť) neshodí desku: stav se
   * dorovná z GET a klik se zase povolí.
   */
  async function sendMove(from: Square, path: readonly Square[]): Promise<void> {
    selection = null;
    busy = true;
    render();
    try {
      applyServerState(await client.postMove(gameId, from, path));
    } catch (error) {
      console.error('Server tah nepřijal, synchronizuji stav ze serveru:', error);
      await resync();
    } finally {
      busy = false;
      render();
    }
  }

  /**
   * Opakovaný dotaz na stav – takhle klient uvidí tah enginu. Single-flight:
   * když už request běží (odesílá se tah / běží jiný poll), tik se přeskočí.
   */
  async function poll(): Promise<void> {
    if (busy) {
      return; // jiný request běží – tenhle tik zahodíme (single-flight)
    }
    busy = true;
    try {
      applyServerState(await client.getGame(gameId));
    } catch (error) {
      console.error('Dotaz na stav partie selhal:', error);
    } finally {
      busy = false;
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

  /** Přebere plný stav ze serveru a překreslí. Deska nikdy nedopočítává sama. */
  function applyServerState(dto: GameDto): void {
    position = dto.position;
    if (dto.engineStatus === 'error') {
      // Engine selhal – partie stojí na tahu člověka nebo čeká; viditelné hlášení
      // řeší až další fáze. Tady jen nezaseknout a nechat stopu v konzoli.
      console.error('Engine hlásí chybu (engineStatus=error).');
    }
    render();
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
  return {
    element: view.element,
    dispose: () => {
      clearInterval(timer);
    },
  };
}

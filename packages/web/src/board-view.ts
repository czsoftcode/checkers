/**
 * Vykreslení desky do DOM – „hloupá" vrstva bez herní logiky.
 *
 * Postaví jednou mřížku 8×8 (32 tmavých hracích polí nese `data-square` = číslo
 * pole 1–32) a hlásí kliknutí ven přes `onSquareClick`; kliknutí na světlé pole
 * nebo mimo desku hlásí `null`. Zvýraznění i kameny překresluje `update`.
 *
 * Animace tahu: `update` porovná předchozí a novou pozici (`diffMove`) a pokud jde
 * o jeden tah, kámen se plynule přesune (Web Animations API) po jednotlivých
 * skocích a sebrané kameny mizí postupně. Prostředí bez WAAPI (jsdom, starý
 * prohlížeč) i redukovaný pohyb spadnou na okamžité překreslení – dnešní chování.
 */

import { BOARD_SIZE, coordsToSquare, isDarkSquare } from '@checkers/rules';
import type { Cell, Position, Square } from '@checkers/rules';

import { diffMove } from './move-diff.js';
import { createSoundPlayer } from './sound.js';
import type { SoundPlayer } from './sound.js';

/** Doba jednoho skoku v ms (trojskok ≈ 3× tolik + prodlevy na mezidopadech). */
const HOP_MS = 300;
/**
 * Prodleva na mezidopadu vícenásobného skoku (kámen čeká na další skok). Záměrně
 * shodná s délkou skoku – čekání i skok jsou u víceskoku stejně dlouhé, ať zvuky
 * rozjezd/dopad drží rytmus.
 */
const DWELL_MS = HOP_MS;
/** Doba plynulého zmizení sebraného kamene v ms. */
const CAPTURE_FADE_MS = 200;

/** Stav k vykreslení: pozice, vybrané pole a cílová pole ke zvýraznění. */
export interface RenderState {
  readonly position: Position;
  readonly selected: Square | null;
  /** Naklikané mezidopady rozpracovaného skoku (bez výchozího pole). */
  readonly path: readonly Square[];
  readonly targets: readonly Square[];
}

/** Deska napojená na DOM. */
export interface BoardView {
  /** Kořenový prvek `.board` k vložení do stránky. */
  readonly element: HTMLElement;
  /**
   * Překreslí kameny a zvýraznění podle stavu (případně s animací tahu). Vrátí
   * příslib, který se vyřeší, AŽ animace tohoto tahu doběhne (nebo hned, když se
   * neanimuje / animace se přeruší). Volající tak může navázat akci na konec
   * pohybu (např. zvuk konce partie až po posledním dopadu vítězného tahu).
   */
  update(state: RenderState): Promise<void>;
  /**
   * Ukončí případnou běžící animaci (zruší WAAPI i časovače). Volá controller
   * při `dispose()` / „Nová hra", ať doběhlá animace nemutuje zahozenou desku a
   * nezůstanou viset časovače – bez spoléhání na to, že volající desku odpojí.
   */
  dispose(): void;
}

/** Právě běžící animace tahu a její násilné dokončení (snap na cílovou pozici). */
interface RunningAnimation {
  /** Pozice, na kterou animace míří (na ni se při přerušení „skočí"). */
  readonly target: Position;
  /** Vyřeší se, až animace doběhne nebo se přeruší (viz `update` → `done`). */
  readonly done: Promise<void>;
  /** Přeruší animaci a dorovná desku na `target`. */
  cancel(): void;
}

/**
 * Vytvoří desku. `onSquareClick` dostane číslo klilknutého hracího pole (1–32),
 * nebo `null` při kliknutí mimo hrací pole. `player` ozvučuje animaci tahu a
 * jde injektovat kvůli testu; výchozí je reálný přehrávač (no-op bez `Audio`).
 */
export function createBoardView(
  onSquareClick: (square: Square | null) => void,
  player: SoundPlayer = createSoundPlayer(),
): BoardView {
  const element = document.createElement('div');
  element.className = 'board';

  const squareEls = new Map<Square, HTMLElement>();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement('div');
      const dark = isDarkSquare(row, col);
      cell.className = dark ? 'square dark' : 'square light';
      if (dark) {
        const square = coordsToSquare(row, col);
        cell.dataset.square = String(square);
        squareEls.set(square, cell);
      }
      element.append(cell);
    }
  }

  element.addEventListener('click', (event) => {
    // První klik na desku je uživatelský gest → odemkni audio (autoplay policy),
    // ať zvuk tahu funguje i po tazích AI, kterým žádné kliknutí nepředchází.
    player.unlock();
    const target = event.target instanceof Element ? event.target.closest('.square') : null;
    const raw = target instanceof HTMLElement ? target.dataset.square : undefined;
    onSquareClick(raw === undefined ? null : Number(raw));
  });

  // Poslední vykreslená pozice – vstup pro diff při dalším update.
  let lastPosition: Position | null = null;
  // Právě běžící animace tahu, nebo null.
  let running: RunningAnimation | null = null;

  function update(state: RenderState): Promise<void> {
    // Opakovaný poll během animace vrací tutéž pozici → animaci nepřerušuj, jen
    // srovnej zvýraznění a nech ji doběhnout (jinak by 250ms poll usekl trojskok).
    // Vrať promise BĚŽÍCÍ animace (ne hned vyřešený): kdyby stejná pozice dorazila
    // podruhé už jako terminální (zvuk konce partie), navěsí se správně na konec
    // animace, ne do jejího průběhu.
    if (running !== null && positionsEqual(state.position, running.target)) {
      applyHighlights(state);
      return running.done;
    }
    // Jiná pozice během animace → dorovnej běžící na její cíl a pokračuj s novou.
    if (running !== null) {
      const previous = running;
      running = null;
      previous.cancel();
    }

    const prev = lastPosition;
    lastPosition = state.position;

    const move = prev === null ? null : diffMove(prev, state.position);
    if (move === null || !canAnimate()) {
      // Reálný tah bez animace (reduced-motion / prostředí bez WAAPI): kámen se
      // jen překreslí (rovnou „dopadne" v cíli), ať hráč neztratí zvukovou
      // zpětnou vazbu, přehraj zvuk dopadu. `move === null` (první render,
      // ne-jeden-tah) zůstává tichý.
      if (move !== null) {
        player.play('land');
      }
      instant(state);
      return Promise.resolve();
    }
    return startAnimation(state, move);
  }

  /** Okamžité překreslení bez animace (dnešní chování). */
  function instant(state: RenderState): void {
    applyHighlights(state);
    applyPieces(state.position, null);
  }

  /** Nastaví jen zvýraznění polí (výběr, cesta, cíle) – nesahá na kameny. */
  function applyHighlights(state: RenderState): void {
    const targetSet = new Set(state.targets);
    const pathSet = new Set(state.path);
    for (const [square, cell] of squareEls) {
      cell.classList.toggle('selected', state.selected === square);
      cell.classList.toggle('path', pathSet.has(square));
      cell.classList.toggle('target', targetSet.has(square));
    }
  }

  /** Srovná kameny s pozicí; pole ve `skip` přeskočí (řeší je animace). */
  function applyPieces(position: Position, skip: ReadonlySet<Square> | null): void {
    for (const [square, cell] of squareEls) {
      if (skip?.has(square) === true) {
        continue;
      }
      renderPiece(cell, position.board[square - 1] ?? null);
    }
  }

  /**
   * Přehraje jeden tah: pohybující se kámen přesune do cílového pole (DOM zůstane
   * tentýž element – neshodí klikání) a vizuálně ho po diagonále „provede" přes
   * mezidopady pomocí WAAPI. Sebrané kameny mizí postupně, jak je kámen míjí.
   */
  function startAnimation(state: RenderState, move: ReturnType<typeof diffMove>): Promise<void> {
    // `done` se vyřeší, až animace skončí (finalize) NEBO se přeruší (cancel) –
    // volající (controller) na něj věší zvuk konce partie až po posledním dopadu.
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    if (move === null) {
      instant(state);
      resolveDone();
      return done;
    }
    const fromCell = squareEls.get(move.from);
    const toCell = squareEls.get(move.to);
    const mover = fromCell?.querySelector<HTMLElement>('.piece') ?? null;
    if (fromCell === undefined || toCell === undefined || mover === null) {
      instant(state); // obranná cesta: chybí očekávaný element → jen překresli
      resolveDone();
      return done;
    }

    applyHighlights(state);

    // Pixelový posun bodu cesty vůči cílovému poli (grid je uniformní, ale rect je
    // robustní i vůči responzivitě). Bereme PŘED přesunem kamene.
    const toRect = toCell.getBoundingClientRect();
    const waypoints = [move.from, ...move.hops];
    const translateOf = (square: Square): string => {
      const rect = (squareEls.get(square) ?? toCell).getBoundingClientRect();
      return `translate(${String(rect.left - toRect.left)}px, ${String(rect.top - toRect.top)}px)`;
    };

    const numHops = move.hops.length;
    // Časová osa: každý skok trvá HOP_MS, na každém MEZIdopadu se kámen zdrží
    // DWELL_MS – v keyframech dvě stejné pozice s časovou mezerou, ať je vidět,
    // kudy skok šel, a ne jen souvislý sklouz od startu k cíli.
    const dwells = Math.max(0, numHops - 1);
    const totalMs = numHops * HOP_MS + dwells * DWELL_MS;
    // Čas příletu na dopad i-tého skoku (0-indexováno): i+1 pohybů + i prodlev.
    const hopArrivalMs = (i: number): number => (i + 1) * HOP_MS + i * DWELL_MS;

    const keyframes: Keyframe[] = [
      { transform: translateOf(move.from), offset: 0, easing: 'ease-in-out' },
    ];
    for (let i = 1; i <= numHops; i++) {
      const transform = translateOf(waypoints[i]!);
      if (i === numHops) {
        keyframes.push({ transform, offset: 1, easing: 'linear' }); // finální dopad
      } else {
        const arrival = hopArrivalMs(i - 1);
        // Přílet na mezidopad → prodleva (stejná pozice) → odlet dál.
        keyframes.push({ transform, offset: arrival / totalMs, easing: 'linear' });
        keyframes.push({ transform, offset: (arrival + DWELL_MS) / totalMs, easing: 'ease-in-out' });
      }
    }

    // Kámen přesuň do cílového pole (DOM move = tentýž element) a vyzdvihni ho.
    // Sebrané kameny NEODEBÍRÁME hned – zmizí skok po skoku. Ostatní pole srovnej.
    toCell.append(mover);
    mover.classList.add('moving');
    const skip = new Set<Square>([move.to, ...move.captured]);
    applyPieces(state.position, skip);

    // Zvuk ROZJEZDU prvního skoku: hned na začátku tahu. Rozjezdy dalších skoků
    // (po mezidopadu) doplní timery níže, ať u víceskoku zní pohyb→dopad→pohyb→…
    player.play('move');

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = (): void => {
      for (const t of timers) {
        clearTimeout(t);
      }
    };

    // Zvuk ROZJEZDU dalších skoků (i ≥ 1): kámen se po mezidopadu znovu rozjede až
    // po prodlevě, tj. v čase `hopArrivalMs(i-1) + DWELL_MS = i*(HOP_MS+DWELL_MS)`.
    // Bez toho by mezi dopadem a dalším dopadem bylo hluché místo.
    for (let i = 1; i < numHops; i++) {
      const at = i * (HOP_MS + DWELL_MS);
      timers.push(
        setTimeout(() => {
          if (cancelled) {
            return;
          }
          player.play('move');
        }, at),
      );
    }

    // Sebrané zarovnané k mezidopadům (i-tý skok bere captured[i]); u fallbacku
    // (rovný posun, hops kratší než captured) je odebereme všechny na konci.
    const aligned = move.captured.length === move.hops.length;
    for (let i = 0; i < numHops; i++) {
      const at = hopArrivalMs(i); // sebraný zmizí, jakmile kámen dopadne za něj
      timers.push(
        setTimeout(() => {
          if (cancelled) {
            return;
          }
          // Zvuk MEZIdopadů (i < poslední) zní zde, zarovnaný na `hopArrivalMs`.
          // Finální dopad NEplánujeme sem: jeho čas = totalMs se kryje s koncem
          // animace, a `finalize`→`clearTimers` by ten timer mohl uklidit dřív,
          // než stihne zaznít (závod). Finální dopad proto hraje `finalize`.
          // Cancel/dispose mezidopady přes `clearTimers` zruší (přerušený skok).
          if (i < numHops - 1) {
            player.play('land');
          }
          const capturedAtHop = move.captured[i];
          if (aligned && capturedAtHop !== undefined) {
            removeCaptured(capturedAtHop);
          } else if (!aligned && i === numHops - 1) {
            for (const c of move.captured) {
              removeCaptured(c);
            }
          }
        }, at),
      );
    }

    const anim = mover.animate(keyframes, { duration: totalMs, fill: 'none' });

    const finalize = (): void => {
      clearTimers();
      // Zvuk FINÁLNÍHO dopadu: hraje se tady, na garantovaném konci animace, ne
      // přes timer na `totalMs` (ten by `clearTimers` výše mohl uklidit dřív, než
      // zazní). Běží jen na úspěšné dokončení – při cancel/dispose finalize
      // neproběhne, takže přerušený tah finální dopad (správně) nezahraje.
      player.play('land');
      // Bezpečně dorovnej cílové pole (proměna man→king, sundá třídu moving)
      // a případné nedomizelé sebrané kameny.
      for (const c of move.captured) {
        removeCaptured(c);
      }
      renderPiece(toCell, state.position.board[move.to - 1] ?? null);
    };

    running = {
      target: state.position,
      done,
      cancel: () => {
        cancelled = true;
        clearTimers();
        anim.cancel();
        // Snap: srovnej VŠECHNA pole na cílovou pozici (odebere zbylé sebrané,
        // kámen dostane finální třídu bez `moving`).
        applyPieces(state.position, null);
        resolveDone(); // přerušení = konec animace pro volajícího
      },
    };

    anim.finished.then(
      () => {
        if (cancelled) {
          return; // cancel() už `done` vyřešil
        }
        finalize();
        running = null;
        resolveDone();
      },
      () => {
        // anim.cancel() zamítne finished promise – úklid i `resolveDone` řeší cancel().
      },
    );
    return done;
  }

  /** Plynule schová a odebere sebraný kámen; bez WAAPI ho odebere hned. */
  function removeCaptured(square: Square): void {
    const cell = squareEls.get(square);
    const piece = cell?.querySelector<HTMLElement>('.piece') ?? null;
    if (piece === null) {
      return;
    }
    if (typeof piece.animate === 'function') {
      const fade = piece.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: CAPTURE_FADE_MS,
        fill: 'forwards',
      });
      fade.finished.then(
        () => {
          piece.remove();
        },
        () => {
          piece.remove();
        },
      );
    } else {
      piece.remove();
    }
  }

  /** Ukončí běžící animaci (WAAPI + časovače) a dorovná desku na její cíl. */
  function dispose(): void {
    if (running !== null) {
      const active = running;
      running = null;
      active.cancel();
    }
  }

  return { element, update, dispose };
}

/** Lze v tomto prostředí animovat? (WAAPI k dispozici a nechce se redukovaný pohyb.) */
function canAnimate(): boolean {
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
    return false;
  }
  const mq = typeof window !== 'undefined' ? window.matchMedia : undefined;
  if (typeof mq === 'function') {
    try {
      if (mq('(prefers-reduced-motion: reduce)').matches) {
        return false;
      }
    } catch {
      // matchMedia bez podpory dané query – ber jako „animovat lze".
    }
  }
  return true;
}

/** Dvě pozice jsou shodné (strana na tahu i obsah všech polí). */
function positionsEqual(a: Position, b: Position): boolean {
  if (a.turn !== b.turn || a.board.length !== b.board.length) {
    return false;
  }
  for (let i = 0; i < a.board.length; i++) {
    const x = a.board[i] ?? null;
    const y = b.board[i] ?? null;
    if (x === null || y === null) {
      if (x !== y) {
        return false;
      }
    } else if (x.color !== y.color || x.kind !== y.kind) {
      return false;
    }
  }
  return true;
}

/**
 * Srovná kámen v jednom poli s jeho obsahem. Idempotentně: pokud kámen zůstává,
 * element se NErecykluje – jen se případně upraví třída (proměna man→king).
 *
 * Recyklace (smazat + znovu vytvořit při každém překreslení) by při pollingu à
 * 250 ms spolkla klik: kdyby se `.piece` vyměnil mezi mousedown a mouseup, klik
 * by na kámen nedopadl. Proto se element mění jen při reálné změně obsahu pole.
 */
function renderPiece(cell: HTMLElement, piece: Cell): void {
  const existing = cell.querySelector('.piece');
  if (piece === null) {
    existing?.remove();
    return;
  }
  const className = piece.kind === 'king' ? `piece ${piece.color} king` : `piece ${piece.color}`;
  if (existing !== null) {
    if (existing.className !== className) {
      existing.className = className; // stejný element, jen jiný stav (proměna)
    }
    return;
  }
  const el = document.createElement('div');
  el.className = className;
  cell.append(el);
}

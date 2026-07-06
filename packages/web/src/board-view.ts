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

/** Doba návratu kamene na výchozí pole při neplatném/mezidopadovém puštění (ms). */
const DRAG_RETURN_MS = 180;
/** Zvětšení zvednutého kamene při tažení (scale). */
const DRAG_LIFT_SCALE = 1.18;

/** Stav k vykreslení: pozice, vybrané pole a cílová pole ke zvýraznění. */
export interface RenderState {
  readonly position: Position;
  readonly selected: Square | null;
  /** Naklikané mezidopady rozpracovaného skoku (bez výchozího pole). */
  readonly path: readonly Square[];
  readonly targets: readonly Square[];
}

/**
 * Výsledek puštění taženého kamene, který vydá controller z {@link DragCallbacks.onDrop}.
 * Deska podle něj dotáhne vizuál (kámen sám nezná pravidla):
 * - `return` – neplatné puštění: kámen se animovaně vrátí na výchozí pole (bez zvuku),
 * - `hop` – potvrzený meziskok: kámen ZŮSTANE na poli `landing` a čeká na další skok,
 *   zazní `land` a sebrané (`captured`) zmizí. Controller drží stav rozpracované
 *   sekvence tak, aby zobrazení kamene na dopadu odvodil i každé další překreslení
 *   (poll/tap) – sebraný kámen se proto „nevzkřísí".
 * - `commit` – dokončený tah: kámen zůstane na poli `landing`, zazní `land`, sebrané
 *   zmizí; controller mezitím posílá tah serveru a potvrzení desku dorovná (`settle`),
 *   takže re-animace ani zvuk rozjezdu se už nepřehrají.
 *
 * `hop` i `commit` mají pro desku STEJNÝ vizuální efekt (usadit kámen na `landing`,
 * `land`, zmizení sebraných); liší se jen tím, co dělá controller (hop pokračuje,
 * commit odesílá tah).
 */
export type DropOutcome =
  | { readonly kind: 'return' }
  | { readonly kind: 'hop'; readonly landing: Square; readonly captured: readonly Square[] }
  | { readonly kind: 'commit'; readonly landing: Square; readonly captured: readonly Square[] };

/**
 * Zpětná volání pro drag & drop. Deska řeší jen mechaniku (zvednutí, sledování
 * ukazatele, trefa pole, návrat); CO je legální a co se stane rozhoduje controller.
 */
export interface DragCallbacks {
  /** Smí se kámen na tomto poli právě teď táhnout? (vlastní kámen, na tahu člověk, ne busy). */
  canDrag(square: Square): boolean;
  /** Tažení začalo na `square` – controller nastaví výběr a zvýrazní cíle. */
  onDragStart(square: Square): void;
  /** Kámen tažený z `from` byl puštěn nad polem `to` (`null` = mimo hrací pole). */
  onDrop(from: Square, to: Square | null): DropOutcome;
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
   * Srovná JEN zvýraznění (výběr, cesta, cíle) podle stavu – nesahá na kameny ani
   * na `lastPosition`, takže nespustí žádnou animaci. Controller ho volá během
   * rozpracované sekvence a při zahájení/potvrzení tažení, ať přepis zvýraznění
   * nepřekreslí ručně přesunutý tažený kámen.
   */
  setHighlights(state: RenderState): void;
  /**
   * Usadí desku na `state.position` BEZ animace tahu a bez zvuku rozjezdu –
   * jen srovná kameny a zvýraznění. Controller ho volá při potvrzení tahu, který
   * člověk provedl tažením (kámen už je rukou na cíli), aby se pohyb nepřehrál
   * podruhé jako sklouznutí. Dorovná i případnou proměnu a doběh sebraných.
   */
  settle(state: RenderState): void;
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
 * nebo `null` při kliknutí mimo hrací pole (ŤUKNUTÍ = tap, beze změny). `player`
 * ozvučuje animaci tahu a jde injektovat kvůli testu; výchozí je reálný přehrávač
 * (no-op bez `Audio`). `drag` (volitelné) zapne tažení kamenů (drag & drop);
 * bez něj deska funguje jen na ťuknutí jako dřív (a testy bez drag callbacků projdou).
 */
export function createBoardView(
  onSquareClick: (square: Square | null) => void,
  player: SoundPlayer = createSoundPlayer(),
  drag?: DragCallbacks,
): BoardView {
  const element = document.createElement('div');
  element.className = 'board';

  const squareEls = new Map<Square, HTMLElement>();
  // Deska je otočená o 180° (řady i sloupce od nejvyššího indexu k nule), aby
  // kameny člověka (černé, pole 1–12) ležely DOLE a soupeř nahoře. Otáčí se jen
  // POŘADÍ vkládání do DOM (grid plní buňky v pořadí appendu); `data-square` i
  // třídy .dark/.light se dál počítají z reálných souřadnic (row, col), takže
  // číslování polí, klikání i validace tahů zůstávají netknuté.
  for (let row = BOARD_SIZE - 1; row >= 0; row--) {
    for (let col = BOARD_SIZE - 1; col >= 0; col--) {
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

  // Ťuknutí (tap) zůstává na `click`: sémantika výběru/tahu je beze změny a
  // stávající testy (i klik po AI tahu) fungují dál. Na dotyku a peru je `click`
  // JEDINÉ ovládání – tažení tam vypnuté (viz `attachDrag`). Tažení MYŠÍ jede přes
  // Pointer Events NÍŽE; když drag proběhl, `suppressNextClick` spolkne `click`,
  // který by prohlížeč po gestu ještě vyslal – jinak by se tažení počítalo i jako tap.
  let suppressNextClick = false;
  element.addEventListener('click', (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return; // tento klik patří právě doběhlému tažení – ignoruj
    }
    // První klik na desku je uživatelský gest → odemkni audio (autoplay policy),
    // ať zvuk tahu funguje i po tazích AI, kterým žádné kliknutí nepředchází.
    player.unlock();
    onSquareClick(squareOf(event.target));
  });

  // Tažení kamene (drag & drop). Jen když volající předal `drag` callbacky.
  if (drag !== undefined) {
    attachDrag(drag);
  }

  /**
   * Napojí Pointer Events pro tažení – JEN MYŠÍ. Na dotyku a peru (`pointerType`
   * ≠ 'mouse') se `pointerdown` hned vrátí a desku ovládá výhradně ťuknutí přes
   * `click` (fáze 43). Kámen se myší UCHOPÍ hned při stisku (`pointerdown`) nad
   * vlastním tažitelným kamenem: zvedne se (zvětší), vybere se a zvýrazní cíle,
   * kurzor se změní na „grabbing" (pěst). Následný pohyb kámen posouvá, `pointerup`
   * ho pustí (drop). Puštění na stejném poli / mimo = kámen se vrátí, ale ZŮSTANE
   * vybraný (jde pak doťukat cíl). Klik po uchopení se spolkne (`suppressNextClick`),
   * ať se výběr neudělá podruhé přes `click`. Nad netažitelným polem se `pointerdown`
   * neplete a ťuknutí (výběr cíle / zrušení) vyřídí `click` jako dřív.
   */
  function attachDrag(cb: DragCallbacks): void {
    // Uchopený kámen (od pointerdown do pointerup/cancel), nebo null.
    let gesture: {
      pointerId: number;
      origin: Square; // pole, kde kámen leží (odkud se zvedl)
      mover: HTMLElement; // zvednutý kámen
      startX: number;
      startY: number;
      lastDx: number; // POSLEDNÍ známý posun (z pointermove) – pro animaci návratu
      lastDy: number;
      anim: Animation | null; // WAAPI animace držící posun kamene (CSP: bez inline stylu)
    } | null = null;

    element.addEventListener('pointerdown', (event) => {
      // Každý nový stisk = nová interakce → zruš případnou uvízlou supresi `click`
      // z předchozího gesta. MUSÍ být PŘED gatem níže: jinak by dotykový/perový
      // stisk (který gatem propadne) reset přeskočil a uvízlé `suppressNextClick`
      // (např. po myším `pointercancel` bez `click` na hybridu) by spolklo nativní tap.
      suppressNextClick = false;
      // Tažení jen MYŠÍ. Dotyk a pero (`pointerType` ≠ 'mouse') desku neovládají
      // tažením – ta se na nich řídí výhradně ťuknutím přes `click` (fáze 43,
      // drag prstem/perem se na mobilu neosvědčil a kolidoval s tapnutím). Bez
      // uchopení tu nesmíme sáhnout na `preventDefault`, jinak bychom potlačili
      // nativní tap. Jen primární ukazatel a levé tlačítko myši; sekundární doteky ignoruj.
      if (event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0) {
        return;
      }
      gesture = null;
      const square = squareOf(event.target);
      if (square === null || !cb.canDrag(square)) {
        return; // netažitelné pole → výběr cíle / zrušení nechá `click` (tap)
      }
      const cell = squareEls.get(square);
      const mover = cell?.querySelector<HTMLElement>('.piece') ?? null;
      if (cell === undefined || mover === null) {
        return;
      }
      // Zabraň NATIVNÍMU tažení prohlížeče / výběru textu na stisku – to jinak
      // vystřelí `pointercancel`, uchopení se přeruší a kámen „odletí". `click` tím
      // není dotčen (stejně ho po uchopení spolkneme přes suppressNextClick).
      event.preventDefault();
      // Uchop: zvedni kámen, vyber ho a zvýrazni cíle, změň kurzor na „grabbing".
      player.unlock(); // uživatelský gest → odemkni audio
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Prostředí bez pointer capture (jsdom) – tažení jede i bez něj.
      }
      element.classList.add('grabbing'); // kurzor „pěst" po celou dobu držení
      mover.classList.add('dragging');
      cb.onDragStart(square); // výběr + zvýraznění cílů
      gesture = {
        pointerId: event.pointerId,
        origin: square,
        mover,
        startX: event.clientX,
        startY: event.clientY,
        lastDx: 0,
        lastDy: 0,
        anim: startLift(mover, 0, 0), // zvednutí v místě (scale), posun přijde v move
      };
    });

    element.addEventListener('pointermove', (event) => {
      if (gesture?.pointerId !== event.pointerId) {
        return;
      }
      gesture.lastDx = event.clientX - gesture.startX;
      gesture.lastDy = event.clientY - gesture.startY;
      updateLift(gesture.anim, gesture.lastDx, gesture.lastDy);
    });

    const endGesture = (event: PointerEvent, dropSquare: Square | null): void => {
      if (gesture?.pointerId !== event.pointerId) {
        return;
      }
      const g = gesture;
      gesture = null;
      element.classList.remove('grabbing');
      suppressNextClick = true; // uchopení už výběr udělalo – následný `click` spolkni
      try {
        element.releasePointerCapture(g.pointerId);
      } catch {
        // viz setPointerCapture výše
      }
      const outcome = cb.onDrop(g.origin, dropSquare);
      // Návrat animuj z POSLEDNÍHO známého posunu tažení, ne ze souřadnic tohoto
      // eventu: `pointercancel` (i některá `pointerup`) chodí s clientX/Y = 0, což by
      // kámen rozletělo z levého horního rohu.
      finishDrag(g.mover, g.anim, g.lastDx, g.lastDy, outcome);
    };

    element.addEventListener('pointerup', (event) => {
      // Pole pod bodem puštění (prst pole zakrývá → hit-test podle bodu, ne target).
      const under = typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(event.clientX, event.clientY)
        : null;
      endGesture(event, squareOf(under));
    });

    // Přerušení (systémové gesto, ztráta capture) = návrat kamene, žádný drop.
    element.addEventListener('pointercancel', (event) => {
      endGesture(event, null);
    });
  }

  /**
   * Dokončí tažení podle verdiktu controlleru. `commit` nechá kámen na cílovém
   * poli (server potvrzení dorovná), `hop`/`return` ho vrátí na výchozí pole;
   * `hop` a `commit` navíc přehrají `land` a nechají zmizet sebrané kameny.
   */
  function finishDrag(
    mover: HTMLElement,
    anim: Animation | null,
    dx: number,
    dy: number,
    outcome: DropOutcome,
  ): void {
    if (outcome.kind === 'commit' || outcome.kind === 'hop') {
      // Meziskok i dokončení: usaď kámen na `landing`, zazní dopad, sebrané zmizí.
      // U meziskoku controller odvodí totéž zobrazení z rozpracovaného výběru, takže
      // se sebraný kámen dalším překreslením „nevzkřísí" (server ho potvrdí až s tahem).
      anim?.cancel();
      const cell = squareEls.get(outcome.landing);
      if (cell !== undefined) {
        cell.append(mover); // přemísti element do cílové buňky
      }
      mover.classList.remove('dragging');
      player.play('land');
      for (const c of outcome.captured) {
        removeCaptured(c);
      }
      return;
    }
    // `return` → neplatné puštění: kámen se beze zvuku vrátí na výchozí pole.
    animateReturn(mover, anim, dx, dy);
  }

  /** Vrátí kámen z posunu `(dx,dy)` zpět do výchozí buňky a sundá „dragging". */
  function animateReturn(mover: HTMLElement, anim: Animation | null, dx: number, dy: number): void {
    const finalize = (): void => {
      mover.classList.remove('dragging');
    };
    anim?.cancel();
    if (typeof mover.animate !== 'function') {
      finalize();
      return;
    }
    const back = mover.animate(
      [{ transform: liftTransform(dx, dy) }, { transform: 'translate(0px, 0px) scale(1)' }],
      { duration: DRAG_RETURN_MS, easing: 'ease-out' },
    );
    back.finished.then(finalize, finalize);
  }

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

  /**
   * Usadí desku na `state.position` bez animace a bez zvuku rozjezdu. Použití:
   * potvrzení tahu, který člověk provedl tažením (kámen už je rukou na cíli).
   * Případnou běžící animaci ukončí (přebíjí ji přímé srovnání) a `lastPosition`
   * nastaví, aby DALŠÍ tah (třeba enginu) diffnul správně od této pozice.
   */
  function settle(state: RenderState): void {
    if (running !== null) {
      const previous = running;
      running = null;
      previous.cancel();
    }
    lastPosition = state.position;
    applyHighlights(state);
    applyPieces(state.position, null);
  }

  /** Srovná jen zvýraznění (výběr/cesta/cíle); nesahá na kameny ani `lastPosition`. */
  function setHighlights(state: RenderState): void {
    applyHighlights(state);
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

  return { element, update, setHighlights, settle, dispose };
}

/** Číslo hracího pole pod prvkem (nejbližší `.square` s `data-square`), nebo `null`. */
function squareOf(target: EventTarget | null): Square | null {
  const cell = target instanceof Element ? target.closest('.square') : null;
  const raw = cell instanceof HTMLElement ? cell.dataset.square : undefined;
  return raw === undefined || raw === '' ? null : Number(raw);
}

/** Transform zvednutého kamene: posun za ukazatelem + zvětšení. */
function liftTransform(dx: number, dy: number): string {
  return `translate(${String(dx)}px, ${String(dy)}px) scale(${String(DRAG_LIFT_SCALE)})`;
}

/**
 * Spustí „držící" animaci posunu kamene přes WAAPI (žádný inline styl kvůli CSP,
 * stejně jako animace tahu). Dva shodné keyframy → výstup je tentýž transform pro
 * jakýkoli čas; animaci pozastavíme, takže drží posun, dokud ji `updateLift`
 * nepřepíše. Bez WAAPI (jsdom) vrací `null` a tažení běží bez vizuálního posunu.
 */
function startLift(mover: HTMLElement, dx: number, dy: number): Animation | null {
  if (typeof mover.animate !== 'function') {
    return null;
  }
  const t = liftTransform(dx, dy);
  const anim = mover.animate([{ transform: t }, { transform: t }], { duration: 1000, fill: 'both' });
  anim.pause();
  return anim;
}

/** Přepíše držící animaci na nový posun (kámen sleduje ukazatel). */
function updateLift(anim: Animation | null, dx: number, dy: number): void {
  // `anim.effect` je obecný AnimationEffect; `setKeyframes` má až KeyframeEffect.
  // `KeyframeEffect` nemusí v prostředí existovat (jsdom) → nejdřív ověř typ.
  const effect = anim?.effect;
  if (typeof KeyframeEffect !== 'function' || !(effect instanceof KeyframeEffect)) {
    return;
  }
  const t = liftTransform(dx, dy);
  effect.setKeyframes([{ transform: t }, { transform: t }]);
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

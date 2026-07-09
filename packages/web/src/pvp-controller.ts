/**
 * Deska PvP partie (člověk vs. člověk přes server). TENKÁ obdoba engine
 * {@link createBoardController} – ZÁMĚRNĚ nesdílí kód: PvP nemá polling, engine,
 * ballot ani nápovědu a jede čistě na server-pushi. Znovupoužívá jen vykreslení
 * (`board-view`) a výběr/skoky (`selection`).
 *
 * Tok:
 *  - stav partie přichází PUSHEM přes herní WS (viz `game-socket`) → `applyState`
 *    ho převezme, překreslí (animace tahu z rozdílu pozic) a odemkne vstup;
 *  - hráč na tahu sestaví legální tah KLIKÁNÍM i TAŽENÍM MYŠÍ (drag & drop; dotyk
 *    jede jen na ťuknutí). Vícenásobný skok jde skládat HOP-PO-HOPU oběma způsoby:
 *    kámen jde pustit/ťuknout i na mezidopad, tam ZŮSTANE a čeká na další skok.
 *    Rozdělaný skok se ukazuje OPTIMISTICKY a shodně u tažení i klikání
 *    (`effectivePosition`): kámen je opticky na posledním dopadu a dosud sebrané
 *    kameny jsou schované. Server je potvrdí až s CELÝM tahem – proto se rozdělaný
 *    (nedokončený) skok NIKDY neposílá; posílá se (`sendMove`) až dokončený řetěz;
 *  - POZOR – oproti dřívějšku se deska během skládání skoku HÝBE OPTIMISTICKY. Je to
 *    bezpečné: dokud se skok neodešle, server o něm neví (jeho potvrzená pozice je
 *    pořád ta před tahem), takže optika je čistě LOKÁLNÍ a plně vratná přes
 *    `view.settle`. Není tu žádný drift, který by šlo se serverem rozejít;
 *  - PvP nemá polling (jen server push), takže si rozdělaný stav neumí sám srovnat.
 *    Proto se místo pollingu použije ZÁMEK: jakmile hráč potvrdí první meziskok
 *    (`selection.path.length > 0`), deska je ZAMČENÁ do dokončení skoku – klik mimo
 *    povinný dopad se ignoruje, přetáhnout jde jen kámen na posledním dopadu (skok se
 *    musí dokončit). Vědomé „zrušení skoku" se ZÁMĚRNĚ nedělá (todo): do řetězu nejde
 *    spadnout omylem (meziskok se potvrdí jen trefou na zvýrazněný povinný dopad).
 *    Jediný únik ze zámku je dokončení skoku, odmítnutí serverem, nebo ztráta spojení;
 *  - po odeslání dokončeného tahu se vstup ZAMKNE (`pendingMove`) a čeká na potvrzený
 *    stav. U víceskoku i u tažení už kámen opticky „doskákal", takže se potvrzení jen
 *    USADÍ (`view.settle` + `settleNext`, ne druhé sklouznutí); prostý jednodopadový
 *    tah kámen na výchozím poli nechal, ten server animuje jako jeden pohyb;
 *  - odmítnutí tahu serverem (`showError`) i ztráta spojení (`setConnectionLost`) vrátí
 *    desku na poslední POTVRZENOU pozici tím, že ji celou USADÍ (`view.settle` – vrátí
 *    kámen z optického dopadu na výchozí pole i obnoví optimisticky sebrané kameny),
 *    ne jen srovnají zvýraznění.
 *
 * Server je JEDINÁ autorita nad legalitou; klientský výběr je jen UX (počítá tahy
 * ze STEJNÉ knihovny `rules` jako server). Vzdání/remíza (todo 40), reconnection
 * (todo 42) i timeout (todo 43) jsou mimo tento řez.
 */

import type { Color, GameResult, Position, Square } from '@checkers/rules';

import { createBoardView } from './board-view.js';
import type { DropOutcome, RenderState } from './board-view.js';
import { capturedOnHop, capturesForPrefix, nextTargets, resolveChainTo, resolveMove, selectableAt } from './selection.js';
import { createSoundPlayer } from './sound.js';
import type { SoundEvent, SoundPlayer } from './sound.js';
import { isEndReason } from './server-client.js';
import type { EndReason, PvpGameDto } from './server-client.js';

/**
 * Prodleva mezi dokončením animace posledního tahu a zvukem konce partie (fáze 78),
 * ať fanfára/prohra/remíza nespadne na poslední dopad kamene. Shodná s enginovou
 * hrou (`controller.ts`), aby konec zněl v obou režimech stejně.
 */
const END_SOUND_DELAY_MS = 500;

/**
 * Zvuk konce partie z pohledu hráče `myColor` (fáze 78). `Record<Exclude<…>>` je
 * exhaustivní: kdyby do `GameResult` přibyla další terminální hodnota, kompilace se
 * hlasitě rozbije tady, ne že by se pro ni tiše zahrál zvuk remízy. Volá se JEN pro
 * terminální výsledek (`applyState` hlídá přechod z `ongoing`).
 */
function soundForResult(result: Exclude<GameResult, 'ongoing'>, myColor: Color): SoundEvent {
  const byResult: Record<Exclude<GameResult, 'ongoing'>, SoundEvent> = {
    'black-wins': myColor === 'black' ? 'win' : 'loss',
    'white-wins': myColor === 'white' ? 'win' : 'loss',
    draw: 'draw',
  };
  return byResult[result];
}

/** Rozpracovaný tah: výchozí pole + naklikané mezidopady (bez výchozího). */
interface Selection {
  readonly from: Square;
  readonly path: readonly Square[];
}

/** Stav partie hlášený skořápce (řádek stavu / výsledek). */
export interface PvpStatus {
  readonly result: GameResult;
  /** Kdo je na tahu (z pozice). */
  readonly turn: Color;
  /** Jsem na tahu já (partie běží a `turn` je moje barva)? Skořápka podle toho píše výzvu k tahu. */
  readonly myTurn: boolean;
  /**
   * Důvod konce partie (fáze 78), nebo `null` dokud běží / když ho stav nenese.
   * Už NORMALIZOVANÝ na hranici (`applyState`): neznámou/chybějící hodnotu drží
   * jako `null`, takže skořápka jen volí text a nemusí nic dovalidovávat.
   */
  readonly reason: EndReason | null;
}

export interface PvpControllerOptions {
  /** Barva TOHOTO hráče (z `challenge-accepted`). Orientuje desku a rozhoduje čí je tah. */
  readonly myColor: Color;
  /**
   * Odešle dokončený tah serveru (po room WS). `path` = všechna dopadová pole.
   * Vrací `true`, když tah odešel; `false`, když spojení není dostupné – deska pak
   * tah NEZAMKNE (jinak by zamrzla do čekání na stav, který nikdy nedorazí).
   */
  readonly sendMove: (from: Square, path: readonly Square[]) => boolean;
  /** Volá se po každém převzatém stavu (i úvodním) – skořápka kreslí řádek stavu. */
  readonly onStatus?: (status: PvpStatus) => void;
  /** Hláška odmítnutého tahu k zobrazení (skořápka ji ukáže u desky). */
  readonly onError?: (message: string) => void;
  /** Přehrávač zvuků (injektovatelný kvůli testu; výchozí no-op bez `Audio`). */
  readonly soundPlayer?: SoundPlayer;
}

export interface PvpController {
  /** Kořenový prvek desky k vložení do stránky. */
  readonly element: HTMLElement;
  /** Převezme pushnutý stav partie, překreslí a odemkne vstup. */
  applyState(dto: PvpGameDto): void;
  /** Server tah odmítl: odemkni vstup, zruš výběr, ohlas hlášku (deska zpět na poslední stav). */
  showError(message: string): void;
  /**
   * Spojení se stavem partie se ztratilo: ZAMKNI desku (žádný další tah – nedorazil
   * by potvrzený stav) a uvolni případný čekající tah. Nevratné v rámci obrazovky
   * (reconnection = todo 42); skořápka k tomu ukáže trvalou hlášku.
   */
  setConnectionLost(): void;
  /** Zastaví animace a uvolní zdroje desky (volá skořápka při odchodu). */
  dispose(): void;
}

/**
 * Vytvoří PvP desku. Vstup je zamčený, dokud nedorazí první stav (`applyState`);
 * do té doby je deska prázdná. `myColor` orientuje desku (vlastní kameny dole).
 */
export function createPvpController(options: PvpControllerOptions): PvpController {
  const player = options.soundPlayer ?? createSoundPlayer();
  // Stav partie z posledního převzatého stavu serveru. Do prvního `applyState`
  // je pozice `null` → deska je prázdná a klik nic nedělá (žádná pozice k výběru).
  let position: Position | null = null;
  let result: GameResult = 'ongoing';
  // Důvod konce partie z posledního stavu serveru (fáze 78). Normalizovaný: jen
  // platný `EndReason`, jinak `null` (běží / stav ho nenese / neznámá hodnota).
  let reason: EndReason | null = null;
  let selection: Selection | null = null;
  // `true` mezi odesláním tahu a příchodem potvrzeného stavu ze serveru. Po tu dobu
  // je vstup zamčený (žádný další tah), deska se NEhýbe optimisticky.
  let pendingMove = false;
  // `true` po ztrátě spojení se stavem partie (herní WS spadl). Zamkne vstup natrvalo
  // v rámci obrazovky – bez živého kanálu by potvrzený stav tahu nikdy nedorazil.
  let connectionLost = false;
  // `true` mezi `onDragStart` a `onDrop` – blokuje souběžný klik během gesta.
  let dragging = false;
  // `true`, když příští `applyState` má stav USADIT (`view.settle`) místo animovat:
  // tah byl dokončen TAŽENÍM nebo VÍCESKOKEM, kámen už opticky „doskákal" na cíl, takže
  // sklouznutí by se přehrálo podruhé. Nastaví ho `commitDrag` i `advance` (víceskok);
  // spotřebuje ho první `applyState`; resetují ho i `showError`/`setConnectionLost`
  // (nepotvrzený tah → žádné usazení). Prostý jednodopadový tah ho nechává `false`
  // (kámen zůstal na výchozím poli → server ho animuje jako jeden pohyb).
  let settleNext = false;
  let disposed = false;
  // Naplánovaný (ale ještě neodehraný) zvuk konce partie (fáze 78). Drží se, ať se dá
  // zrušit při dispose / dalším stavu – jinak by fanfára zazněla po odchodu z obrazovky.
  let endSoundTimer: ReturnType<typeof setTimeout> | null = null;
  // `true`, jakmile jsme viděli REÁLNĚ běžící stav (fáze 78). Zvuk konce se hraje jen
  // po přechodu z běžící partie, ne když je úplně PRVNÍ přijatý stav rovnou terminální
  // (načtení/reconnect do už dohrané partie – todo 42). Počáteční `result='ongoing'` je
  // jen výchozí hodnota PŘED prvním stavem, ne důkaz, že partie běžela.
  let sawOngoing = false;

  const view = createBoardView(handleClick, player, { canDrag, onDragStart, onDrop }, options.myColor);

  /** Smí hráč teď zadávat tah? Jen s pozicí, na tahu, partie běží, nečeká se a spojení žije. */
  function canInput(): boolean {
    return (
      position !== null &&
      !pendingMove &&
      !connectionLost &&
      result === 'ongoing' &&
      position.turn === options.myColor
    );
  }

  /**
   * Odešle tah serveru a vrátí, zda odešel. `sendMove` má vracet boolean, ale transport
   * (WS `socket.send`) může ve vzácném ZÁVODĚ stavu spojení VYHODIT (readyState se změní
   * mezi kontrolou a odesláním). To je I/O selhání, ne programová chyba – a nesmí
   * propadnout ven z `onDrop`: deska by pak nespustila `finishDrag`, tažený kámen by
   * zůstal zvednutý a vstup odemčený bez hlášky. Výjimku proto zaloguj (se stackem) a ber
   * ji jako „neodešlo" – volající pak jede stejnou vratnou cestou jako u `false`. `catch`
   * obaluje ZÁMĚRNĚ jen volání `sendMove`, ať nemaskuje chybu ve zbytku controlleru.
   */
  function trySend(from: Square, path: readonly Square[]): boolean {
    try {
      return options.sendMove(from, path);
    } catch (error) {
      console.error('Odeslání tahu selhalo (transport), beru jako neodeslané:', error);
      return false;
    }
  }

  /** `true`, pokud `square` je jedním z aktuálně nabízených dalších dopadů. */
  function isTarget(square: Square): boolean {
    return (
      position !== null &&
      selection !== null &&
      nextTargets(position, selection.from, selection.path).includes(square)
    );
  }

  function handleClick(square: Square | null): void {
    if (dragging || !canInput() || position === null) {
      return; // mimo tah / zamčeno / bez pozice / uprostřed tažení – klik zahoď
    }
    if (selection !== null && square !== null && isTarget(square)) {
      advance(square);
      return; // advance si řídí překreslení sám (i po odeslání tahu)
    }
    // TVRDÝ ZÁMEK: uprostřed rozdělaného skoku (path > 0) se klik mimo povinný dopad
    // IGNORUJE – žádné zrušení ani přepnutí kamene. Skok se musí dokončit (jediný únik
    // je dokončení, odmítnutí serverem, nebo ztráta spojení). Zámek platí až po prvním
    // meziskoku; čerstvý výběr kamene (path === 0) jde ještě volně měnit/zrušit.
    if (selection !== null && selection.path.length > 0) {
      return;
    }
    if (square === null) {
      selection = null;
    } else if (selectableAt(position, square) && selection?.from !== square) {
      // Nový výběr vlastního kamene (i přepnutí z jiného). Klik na už vybraný výchozí
      // kámen sem nespadne (padá do else a výběr se zruší).
      selection = { from: square, path: [] };
    } else {
      selection = null;
    }
    view.setHighlights(renderState());
  }

  /** Prodlouží sekvenci o dopad `square`; když je tah kompletní, ODEŠLE ho a zamkne vstup. */
  function advance(square: Square): void {
    if (position === null || selection === null) {
      return;
    }
    const path = [...selection.path, square];
    if (nextTargets(position, selection.from, path).length > 0) {
      // Skok ještě pokračuje (další povinný dopad) – prodluž trasu a kámen OPTICKY
      // usaď na tento dopad (`settle` → `effectivePosition`: kámen na dopadu, sebrané
      // zmizí), ať zobrazení klikání sedí s tažením. Server ho přesune celý až s tahem;
      // rozdělaný skok se neposílá.
      selection = { from: selection.from, path };
      view.settle(renderState());
      return;
    }
    // Sekvence úplná → pošli serveru výchozí pole a CELOU naklikanou cestu (smí mít
    // duplicity u kruhového skoku dámy – posílá se tak, jak je).
    const from = selection.from;
    const multi = path.length > 1; // víceskok už kámen opticky doskákal (settle po hopech)
    selection = null;
    view.setHighlights(renderState()); // zhasni zvýraznění; kameny nech, kde opticky jsou
    const sent = trySend(from, path);
    if (!sent) {
      // Tah NEodešel (spojení pryč). NEZAMYKEJ desku (jinak by zamrzla do čekání na
      // stav, který nedorazí) – zůstávám na tahu a můžu zkusit znovu. U víceskoku ale
      // kámen opticky „doskákal" na mezidopady → USAĎ desku zpět na potvrzenou pozici
      // (settle vrátí kámen na výchozí pole i obnoví sebrané). Pak ohlas hlášku.
      settleNext = false;
      view.settle(renderState());
      options.onError?.('Spojení není dostupné, tah se neodeslal. Zkus to znovu.');
      return;
    }
    // Odesláno → zamkni vstup a čekej na autoritativní stav. Víceskok už kámen opticky
    // doskákal → potvrzení jen USAĎ (`settleNext`); prostý tah kámen na výchozím poli
    // nechal → server ho animuje jako jeden pohyb.
    pendingMove = true;
    settleNext = multi;
    emitStatus(); // po odeslání už nejsem „na tahu" (čekám na potvrzení serveru)
  }

  /**
   * Smí se kámen na `square` právě táhnout? Stejné podmínky jako klik (`canInput`),
   * navíc ne uprostřed jiného gesta. Během rozpracovaného skoku
   * (`selection.path.length > 0`) je tažitelný JEN kámen na posledním dopadu
   * (`lastHopOf`) – tam kámen opticky stojí a odtud skáče dál (tvrdý zámek); jinak
   * libovolný vlastní kámen. Tažení i klikání teď staví na STEJNÉM optimistickém
   * modelu (`effectivePosition`), takže je lze v jednom skoku míchat. `canDrag` je jen
   * UX předfiltr, legalitu drží `onDrop` + server.
   */
  function canDrag(square: Square): boolean {
    if (dragging || !canInput() || position === null) {
      return false;
    }
    if (selection !== null && selection.path.length > 0) {
      return square === lastHopOf(selection);
    }
    return selectableAt(position, square);
  }

  /**
   * Tažení začalo na `square`: buď čerstvý výběr, nebo POKRAČOVÁNÍ rozpracovaného skoku,
   * když se zvedá kámen na posledním dopadu (míchání klik→tažení). Zvýrazni cíle;
   * kameny se nepřekreslují (`setHighlights`) – tažený kámen je zvednutý deskou.
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
    view.setHighlights(renderState());
  }

  /**
   * Kámen zvednutý z `origin` (poslední dopad, nebo výchozí pole) byl puštěn nad polem
   * `to` (`null` = mimo desku). Skok jde skládat HOP-PO-HOPU: puštění na povinný
   * MEZIdopad → kámen ZŮSTANE na `to` a čeká na další skok (`{ kind: 'hop' }`); puštění
   * na dopad, který tah dokončí → odešle se a kámen zůstane na cíli (`{ kind: 'commit' }`).
   * Puštění rovnou na KONCOVÉ pole souvislého řetězu (`resolveChainTo`) tah taky dokončí.
   * Nelegální/mimo puštění → kámen se VRÁTÍ (`{ kind: 'return' }`) a rozpracovaný skok
   * ZŮSTANE rozdělaný (tvrdý zámek – jde jen zkusit znovu). Legalitu ověří i server.
   */
  function onDrop(origin: Square, to: Square | null): DropOutcome {
    dragging = false;
    // Vrácení kamene: srovnej zvýraznění podle stavu. Výběr se ZÁMĚRNĚ NERUŠÍ: myší
    // ťuknutí na kámen jde taky přes drag (onDragStart+onDrop bez pohybu), následný
    // `click` je potlačený – kdyby se výběr zrušil, kámen by se myší nedal vybrat.
    // Uprostřed rozdělaného skoku „return" nechá kámen opticky na posledním dopadu
    // (deska zamčená), nic se nevrací na server.
    const bounce = (): DropOutcome => {
      view.setHighlights(renderState());
      return { kind: 'return' };
    };
    if (position === null || !canInput() || selection === null || to === null) {
      return bounce();
    }
    if (origin !== lastHopOf(selection)) {
      return bounce(); // zvednuto z jiného pole než kde kámen opticky stojí → jen vrať
    }
    const from = selection.from;
    const prefix = selection.path;
    // `to` je bezprostřední povinný dopad z aktuální pozice v řetězu.
    if (nextTargets(position, from, prefix).includes(to)) {
      const newPath = [...prefix, to];
      const captured = capturedOnHop(position, from, prefix, to);
      if (nextTargets(position, from, newPath).length > 0) {
        // Meziskok: kámen ZŮSTANE na `to` a čeká na další skok. Deska ho na dopad usadí
        // (`hop` níže) a sebrané schová; každé další překreslení odvodí totéž zobrazení
        // z výběru (`effectivePosition`), takže se sebraný kámen „nevzkřísí".
        selection = { from, path: newPath };
        view.setHighlights(renderState());
        return { kind: 'hop', landing: to, captured };
      }
      // Tento dopad tah DOKONČÍ.
      const move = resolveMove(position, from, newPath);
      if (move === null) {
        return bounce(); // obrana: dopad bez pokračování by měl jít vyřešit
      }
      return commitDrag(move.from, move.path, to, captured);
    }
    // `to` není bezprostřední dopad → zkus celý řetěz končící v `to` (souvislé tažení
    // přes víc skoků v jednom gestu). `captures` mimo už sebrané (`prefix`).
    const chain = resolveChainTo(position, from, prefix, to);
    if (chain !== null) {
      return commitDrag(chain.from, chain.path, to, chain.captures.slice(prefix.length));
    }
    return bounce();
  }

  /**
   * Společný konec tažení, kdy tah dokončí: pošli ho serveru a podle výsledku dej desce
   * verdikt. `sent === false` (spojení pryč) → NEZAMYKEJ a USAĎ desku zpět na potvrzenou
   * pozici (`view.settle`; u víceskoku už kámen opticky doskákal / předchozí hopy sebraly
   * kameny → jen „return" by je neobnovil), ohlas hlášku (zůstávám na tahu, jde zkusit
   * znovu); vrácené `{ kind: 'return' }` navíc vrátí tažený kámen z ruky. Odesláno →
   * zamkni, nastav `settleNext` (kámen už je na cíli, potvrzený stav se jen usadí) a nech
   * kámen na `landing`; sebrané kameny (`captured`) nech desku odklidit.
   */
  function commitDrag(
    from: Square,
    path: readonly Square[],
    landing: Square,
    captured: readonly Square[],
  ): DropOutcome {
    const sent = trySend(from, path);
    if (!sent) {
      selection = null;
      settleNext = false;
      // settle je bezpečné volat synchronně před návratem: `finishDrag` (v desce) běží
      // AŽ po tomto `onDrop`; settle mezitím tažený kámen z ruky odstraní/obnoví pozici,
      // takže následné „return" už jen animuje odpojený element (neškodné).
      view.settle(renderState());
      options.onError?.('Spojení není dostupné, tah se neodeslal. Zkus to znovu.');
      return { kind: 'return' };
    }
    selection = null;
    pendingMove = true;
    settleNext = true;
    emitStatus(); // po odeslání už nejsem „na tahu" (čekám na potvrzení serveru)
    return { kind: 'commit', landing, captured: [...captured] };
  }

  /** Pole, na kterém pohyblivý kámen právě opticky STOJÍ (poslední dopad, nebo výchozí). */
  function lastHopOf(sel: Selection): Square {
    return sel.path.length > 0 ? (sel.path[sel.path.length - 1] ?? sel.from) : sel.from;
  }

  /**
   * „Optimistická" pozice pro ZOBRAZENÍ rozpracovaného skoku: pohyblivý kámen je
   * přesunutý z výchozího pole na poslední dopad a dosud sebrané kameny jsou schované.
   * Server je potvrdí až s celým tahem, ale klient je ukazuje hned, aby kámen „zůstal"
   * na dopadu a čekal na další skok. Proměna (man→king) se NEřeší – tu potvrdí server na
   * konci tahu. Prázdné výchozí pole (obrana) → beze změny.
   */
  function effectivePosition(pos: Position, sel: Selection): Position {
    const moving = pos.board[sel.from - 1] ?? null;
    if (moving === null) {
      return pos;
    }
    const captured = capturesForPrefix(pos, sel.from, sel.path);
    const landing = lastHopOf(sel);
    const board = pos.board.slice();
    board[sel.from - 1] = null;
    for (const c of captured) {
      board[c - 1] = null;
    }
    board[landing - 1] = moving;
    return { board, turn: pos.turn };
  }

  /**
   * Stav k vykreslení. Bez výběru holá pozice. S vybraným kamenem bez dopadů (path === 0)
   * výběr výchozího kamene + jeho cíle. S rozpracovaným skokem (path > 0) kámen OPTICKY
   * na posledním dopadu (`effectivePosition`, sebrané schované), `selected` na tom dopadu,
   * `path` = trasa (výchozí pole + předchozí dopady) a cíle = BEZPROSTŘEDNÍ další dopady
   * (`nextTargets`) – shodně pro tažení i klikání (zvýrazněné povinné dopady jsou zároveň
   * vizuální výzva „dokonči skok").
   */
  function renderState(): RenderState {
    if (position === null) {
      // Prázdná deska před prvním stavem: pozice ještě není. Tenhle stav se pro
      // `setHighlights` nepoužije (klik je zablokovaný), je tu jen pro typovou úplnost.
      return { position: { board: [], turn: options.myColor }, selected: null, path: [], targets: [] };
    }
    if (selection === null) {
      return { position, selected: null, path: [], targets: [] };
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
      position: effectivePosition(position, selection),
      selected: lastHopOf(selection),
      path: [selection.from, ...selection.path.slice(0, -1)],
      targets: nextTargets(position, selection.from, selection.path),
    };
  }

  /** Ohlásí stav skořápce. `myTurn` = smím teď táhnout (na tahu, běží, nečeká se na server). */
  function emitStatus(): void {
    options.onStatus?.({
      result,
      turn: position === null ? options.myColor : position.turn,
      myTurn: canInput(),
      reason,
    });
  }

  function applyState(dto: PvpGameDto): void {
    if (disposed) {
      return; // push dorazil až po odchodu z obrazovky – zahozenou desku nepřepisuj
    }
    const prevResult = result;
    position = dto.position;
    result = dto.result;
    // Důvod konce (fáze 78): normalizuj na hranici – neznámé/chybějící `reason`
    // (starší server, rozbitý stav) drž jako `null`, skořápka pak spadne na text
    // bez důvodu místo aby zobrazila nesmysl.
    reason = isEndReason(dto.reason) ? dto.reason : null;
    // Autoritativní stav dorazil → zruš rozdělaný výběr a odemkni vstup.
    selection = null;
    pendingMove = false;
    const settle = settleNext;
    settleNext = false;
    // `rendered` = kdy doběhne animace tohoto stavu; koncový zvuk se zavěsí až za ni.
    let rendered: Promise<void>;
    if (settle) {
      // Tah byl dokončen TAŽENÍM – kámen už je rukou na cíli. Jen USAĎ (settle),
      // ať se pohyb nepřehraje podruhé jako sklouznutí (a dorovnej případné sebrané).
      view.settle(renderState());
      rendered = Promise.resolve(); // settle neanimuje → nic k čekání
    } else {
      // Rozdíl proti minulé pozici `view.update` zanimuje (tah můj klikaný i soupeřův)
      // jako jeden pohyb; první stav (prev===null) se jen staticky vykreslí.
      rendered = view.update(renderState());
    }
    // Zvuk konce partie (fáze 78) při přechodu ongoing → terminální, z pohledu MÉ barvy:
    // výhra fanfára, prohra zvuk prohry, remíza zvuk remízy. Až po dokončení animace
    // posledního tahu, ať nepřekryje jeho dopad. Konec může přijít i soupeřovým tahem.
    // `sawOngoing` brání zvuku při vstupu do UŽ dohrané partie (první stav terminální).
    if (sawOngoing && prevResult === 'ongoing' && result !== 'ongoing') {
      scheduleEndSound(rendered, result, soundForResult(result, options.myColor));
    }
    if (result === 'ongoing') {
      sawOngoing = true;
    }
    emitStatus();
  }

  /**
   * Přehraje zvuk konce partie AŽ po dokončení animace posledního tahu (`rendered`)
   * a ještě po prodlevě {@link END_SOUND_DELAY_MS}. Nezahraje, pokud se controller
   * mezitím disposnul (odchod z obrazovky) nebo se výsledek změnil (obrana proti
   * zastaralému naplánovanému zvuku). Dvojče enginové `scheduleEndSound`.
   */
  function scheduleEndSound(rendered: Promise<void>, forResult: GameResult, event: SoundEvent): void {
    void rendered.then(() => {
      if (disposed || result !== forResult) {
        return;
      }
      endSoundTimer = setTimeout(() => {
        endSoundTimer = null;
        if (disposed || result !== forResult) {
          return;
        }
        player.play(event);
      }, END_SOUND_DELAY_MS);
    });
  }

  function showError(message: string): void {
    if (disposed || connectionLost) {
      // Po ztrátě spojení je deska nevratně zamčená (reconnection = todo 42). Opožděné
      // odmítnutí tahu z ROOM WS (ten žije dál, drží ho lobby) je tou dobou zastaralé –
      // NEsmí přepsat trvalou hlášku „Spojení se přerušilo, vrať se do místnosti" ani
      // odemknout desku. Zahoď ho.
      return;
    }
    // Server tah odmítl (nelegální/mimo pořadí/závod se soupeřem). Když hráč tah zadal
    // TAŽENÍM, kámen se fyzicky přesunul na cíl (u kliku ne) – proto NEstačí srovnat
    // zvýraznění, ale celou desku USADÍ zpět na poslední POTVRZENOU pozici: `view.settle`
    // vrátí kámen na výchozí pole i obnoví optimisticky sebrané kameny. Pro klik (kámen
    // se nehnul) je settle na tutéž pozici neškodný. `settleNext` shoď – tažený tah se
    // nepotvrdil, žádné usazení příštího stavu.
    selection = null;
    pendingMove = false;
    settleNext = false;
    view.settle(renderState());
    // POŘADÍ: nejdřív srovnej řádek stavu (emitStatus → skořápka při novém stavu
    // skrývá starou chybu tahu), AŽ POTOM ohlas hlášku. Obráceně by ji následující
    // emitStatus/render hned skryl a chyba tahu by se nikdy neukázala.
    emitStatus(); // zpět „na tahu" (ne „soupeř přemýšlí")
    options.onError?.(message);
  }

  function setConnectionLost(): void {
    if (disposed) {
      return;
    }
    connectionLost = true;
    pendingMove = false; // uvolni případný čekající tah (potvrzení už nedorazí)
    settleNext = false;
    selection = null;
    // Po tažení může kámen viset na cíli neodeslaného/nepotvrzeného tahu → usaď desku
    // zpět na potvrzenou pozici (settle vrátí i optimisticky sebrané), ne jen zvýraznění.
    view.settle(renderState());
    emitStatus(); // canInput() je teď false → myTurn false
  }

  return {
    element: view.element,
    applyState,
    showError,
    setConnectionLost,
    dispose(): void {
      disposed = true;
      if (endSoundTimer !== null) {
        clearTimeout(endSoundTimer); // zahoď naplánovaný zvuk konce (odchod z obrazovky)
        endSoundTimer = null;
      }
      view.dispose();
    },
  };
}

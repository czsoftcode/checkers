/**
 * Deska PvP partie (člověk vs. člověk přes server). TENKÁ obdoba engine
 * {@link createBoardController} – ZÁMĚRNĚ nesdílí kód: PvP nemá polling, engine,
 * ballot ani nápovědu a jede čistě na server-pushi. Znovupoužívá jen vykreslení
 * (`board-view`) a výběr/skoky (`selection`).
 *
 * Tok:
 *  - stav partie přichází PUSHEM přes herní WS (viz `game-socket`) → `applyState`
 *    ho převezme, překreslí (animace tahu z rozdílu pozic) a odemkne vstup;
 *  - hráč na tahu KLIKÁNÍM sestaví legální tah (i vícenásobný skok); po dokončení
 *    se tah POŠLE (`sendMove`) a vstup se ZAMKNE – deska se NEhýbe optimisticky,
 *    kámen zůstane na výchozím poli, dokud nedorazí autoritativní stav ze serveru
 *    (ten pak tah animuje jako jeden pohyb);
 *  - hráč může tah zadat i TAŽENÍM MYŠÍ (drag & drop, jen myš – dotyk jede na
 *    ťuknutí). Tažení řeší CELÝ tah v JEDNOM gestu: kámen se pustí rovnou na cílové
 *    pole (u vícenásobného skoku na KONCOVÉ pole řetězu, mezidopad se vrátí – doskákat
 *    hop-po-hopu jde klikáním). Tažení kámen fyzicky přesune, takže je z principu
 *    optimistické; po odeslání se ZAMKNE a čeká na potvrzený stav, který se pak jen
 *    USADÍ (`view.settle`, ne druhé sklouznutí). Míchat tažení s rozklikanou sekvencí
 *    NEjde – jinak by se optimistický (tažený) a neoptimistický (klikaný) model rozešly;
 *  - odmítnutí tahu serverem (`showError`) i ztráta spojení (`setConnectionLost`) vrátí
 *    kámen na poslední POTVRZENOU pozici tím, že desku celou USADÍ (`view.settle` –
 *    vrátí i optimisticky sebrané kameny), ne jen srovnají zvýraznění.
 *
 * Server je JEDINÁ autorita nad legalitou; klientský výběr je jen UX (počítá tahy
 * ze STEJNÉ knihovny `rules` jako server). Vzdání/remíza (todo 40), reconnection
 * (todo 42) i timeout (todo 43) jsou mimo tento řez.
 */

import type { Color, GameResult, Position, Square } from '@checkers/rules';

import { createBoardView } from './board-view.js';
import type { DropOutcome, RenderState } from './board-view.js';
import { capturedOnHop, endpointsFor, nextTargets, resolveChainTo, resolveMove, selectableAt } from './selection.js';
import { createSoundPlayer } from './sound.js';
import type { SoundPlayer } from './sound.js';
import type { PvpGameDto } from './server-client.js';

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
  // tah byl dokončen TAŽENÍM, kámen už je rukou na cíli, takže sklouznutí by se přehrálo
  // podruhé. Nastaví ho `commitDrag`, spotřebuje první `applyState`; resetují ho i
  // `showError`/`setConnectionLost` (tažený tah se nepotvrdil → žádné usazení).
  let settleNext = false;
  let disposed = false;

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
    if (square === null) {
      selection = null;
    } else if (selection !== null && isTarget(square)) {
      advance(square);
      return; // advance si řídí překreslení sám (i po odeslání tahu)
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
      // Skok ještě pokračuje (další povinný dopad) – jen prodluž trasu a zvýrazni
      // nové cíle. Kámen se NEhýbe (zůstává na výchozím poli), server ho přesune celý.
      selection = { from: selection.from, path };
      view.setHighlights(renderState());
      return;
    }
    // Sekvence úplná → pošli serveru výchozí pole a CELOU naklikanou cestu (smí mít
    // duplicity u kruhového skoku dámy – posílá se tak, jak je).
    const from = selection.from;
    selection = null;
    view.setHighlights(renderState()); // zhasni zvýraznění; kámen zůstává na výchozím poli
    const sent = options.sendMove(from, path);
    if (!sent) {
      // Tah NEodešel (spojení pryč). NEZAMYKEJ desku (jinak by zamrzla do čekání na
      // stav, který nedorazí) – zůstávám na tahu a můžu zkusit znovu. Ohlas hlášku.
      options.onError?.('Spojení není dostupné, tah se neodeslal. Zkus to znovu.');
      return;
    }
    // Odesláno → zamkni vstup a čekej na autoritativní stav; deska se do té doby
    // nehýbe (žádné optimistické vykreslení).
    pendingMove = true;
    emitStatus(); // po odeslání už nejsem „na tahu" (čekám na potvrzení serveru)
  }

  /**
   * Smí se kámen na `square` právě táhnout? Stejné podmínky jako klik (`canInput`),
   * navíc: ne uprostřed jiného gesta a ne, když už běží rozklikaná vícenásobná
   * sekvence (`selection.path.length > 0`). Tažení totiž řeší CELÝ tah v jednom gestu
   * a kámen fyzicky přesune; klikaná sekvence kámen NEhýbe (neoptimistická) – kombinace
   * by desku rozhodila. `canDrag` je jen UX předfiltr, legalitu drží `onDrop` + server.
   */
  function canDrag(square: Square): boolean {
    if (dragging || !canInput() || position === null) {
      return false;
    }
    if (selection !== null && selection.path.length > 0) {
      return false;
    }
    return selectableAt(position, square);
  }

  /** Tažení začalo na `square`: čerstvý výběr (žádné pokračování klikané sekvence) + zvýrazni cíle. */
  function onDragStart(square: Square): void {
    if (!canDrag(square)) {
      return;
    }
    dragging = true;
    selection = { from: square, path: [] };
    view.setHighlights(renderState());
  }

  /**
   * Kámen zvednutý z `origin` byl puštěn nad polem `to` (`null` = mimo desku). Tažení
   * dokončí CELÝ tah v jednom gestu: buď jeden dopad, který tah končí, nebo souvislý
   * řetěz skoků na koncové pole (`resolveChainTo`). Mezidopad nedokončeného řetězu ani
   * nelegální/mimo puštění → kámen se VRÁTÍ (`{ kind: 'return' }`) a rozpracovaný výběr
   * se zruší (klikat jde znovu). Legalitu ověří i server.
   */
  function onDrop(origin: Square, to: Square | null): DropOutcome {
    dragging = false;
    // Vrácení kamene: srovnej zvýraznění zpět do KLIK režimu (`dragging` je už false →
    // renderState dá `nextTargets`, ne koncová pole), ať po nepovedeném/tapovém puštění
    // nezůstanou svítit koncová pole tažení. Výběr se ZÁMĚRNĚ NEruší: myší ťuknutí na
    // kámen jde taky přes drag (onDragStart+onDrop bez pohybu), následný `click` je
    // potlačený – kdyby se výběr zrušil, kámen by se myší nedal vybrat. „Return" tu nikdy
    // nenechá drift: bez `hop` větve se kámen buď dokončí (commit), nebo vrátí, nic se
    // optimisticky neodklidí.
    const bounce = (): DropOutcome => {
      view.setHighlights(renderState());
      return { kind: 'return' };
    };
    if (position === null || !canInput() || selection === null || to === null) {
      return bounce();
    }
    if (origin !== selection.from) {
      return bounce(); // zvednuto z jiného pole než kde je výběr → jen vrať
    }
    const from = selection.from;
    // Jeden dopad, který tah DOKONČÍ (žádný další povinný skok z `to`).
    if (nextTargets(position, from, []).includes(to) && nextTargets(position, from, [to]).length === 0) {
      const move = resolveMove(position, from, [to]);
      if (move !== null) {
        return commitDrag(move.from, move.path, to, capturedOnHop(position, from, [], to));
      }
      return bounce();
    }
    // Vícenásobný skok: kámen musí dopadnout rovnou na KONCOVÉ pole řetězu (souvislé
    // tažení). Mezipole = nedokončený řetěz → vrať (doskákat jde klikáním). Výběr
    // necháme být, ať jde hned zkusit znovu.
    const chain = resolveChainTo(position, from, [], to);
    if (chain !== null) {
      return commitDrag(chain.from, chain.path, to, chain.captures);
    }
    return bounce();
  }

  /**
   * Společný konec tažení, kdy tah dokončí: pošli ho serveru a podle výsledku dej desce
   * verdikt. `sent === false` (spojení pryč) → NEZAMYKEJ, vrať kámen a ohlas hlášku
   * (zůstávám na tahu, jde zkusit znovu). Odesláno → zamkni, nastav `settleNext` (kámen
   * je rukou na cíli, potvrzený stav se jen usadí) a nech kámen na `landing`; sebrané
   * kameny (`captured`) nech desku odklidit.
   */
  function commitDrag(
    from: Square,
    path: readonly Square[],
    landing: Square,
    captured: readonly Square[],
  ): DropOutcome {
    const sent = options.sendMove(from, path);
    if (!sent) {
      selection = null;
      view.setHighlights(renderState());
      options.onError?.('Spojení není dostupné, tah se neodeslal. Zkus to znovu.');
      return { kind: 'return' };
    }
    selection = null;
    pendingMove = true;
    settleNext = true;
    emitStatus(); // po odeslání už nejsem „na tahu" (čekám na potvrzení serveru)
    return { kind: 'commit', landing, captured: [...captured] };
  }

  /** Stav k vykreslení: bez výběru holá pozice, s výběrem výchozí kámen + trasa + cíle. */
  function renderState(): RenderState {
    if (position === null) {
      // Prázdná deska před prvním stavem: pozice ještě není. Tenhle stav se pro
      // `setHighlights` nepoužije (klik je zablokovaný), je tu jen pro typovou úplnost.
      return { position: { board: [], turn: options.myColor }, selected: null, path: [], targets: [] };
    }
    if (selection === null) {
      return { position, selected: null, path: [], targets: [] };
    }
    // Kámen zůstává na výchozím poli (žádné optimistické „doskočení"): `selected` je
    // výchozí pole, `path` naklikané mezidopady (trasa). Cíle se liší podle způsobu
    // zadání: při TAŽENÍ svítí KONCOVÁ pole tahů (`endpointsFor` – kam se dá pustit,
    // včetně konce vícenásobného skoku), protože tažení řeší celý tah v jednom gestu;
    // při KLIKÁNÍ svítí bezprostřední další dopady (`nextTargets`), aby šlo skákat
    // hop-po-hopu. Během tažení je `path` vždy prázdná (drag nepokračuje klik-sekvenci).
    return {
      position,
      selected: selection.from,
      path: [...selection.path],
      targets: dragging
        ? endpointsFor(position, selection.from)
        : nextTargets(position, selection.from, selection.path),
    };
  }

  /** Ohlásí stav skořápce. `myTurn` = smím teď táhnout (na tahu, běží, nečeká se na server). */
  function emitStatus(): void {
    options.onStatus?.({
      result,
      turn: position === null ? options.myColor : position.turn,
      myTurn: canInput(),
    });
  }

  function applyState(dto: PvpGameDto): void {
    if (disposed) {
      return; // push dorazil až po odchodu z obrazovky – zahozenou desku nepřepisuj
    }
    position = dto.position;
    result = dto.result;
    // Autoritativní stav dorazil → zruš rozdělaný výběr a odemkni vstup.
    selection = null;
    pendingMove = false;
    const settle = settleNext;
    settleNext = false;
    if (settle) {
      // Tah byl dokončen TAŽENÍM – kámen už je rukou na cíli. Jen USAĎ (settle),
      // ať se pohyb nepřehraje podruhé jako sklouznutí (a dorovnej případné sebrané).
      view.settle(renderState());
    } else {
      // Rozdíl proti minulé pozici `view.update` zanimuje (tah můj klikaný i soupeřův)
      // jako jeden pohyb; první stav (prev===null) se jen staticky vykreslí.
      void view.update(renderState());
    }
    emitStatus();
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
      view.dispose();
    },
  };
}

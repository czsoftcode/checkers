/**
 * Herní obrazovka PvP partie (člověk vs. člověk). Po přijetí výzvy sem `main.ts`
 * přejde s `gameId`, vlastní barvou a přezdívkou soupeře (z `challenge-accepted`)
 * a s mostem k živému room WS (`GameLink`).
 *
 * Rozvržení SDÍLÍ se hrou proti počítači (app-shell): svislý sloupec `.game` s
 * panelem ovládání NAD deskou (`.panel`/`.controls`), řádkem desky (`.board-row`)
 * a stavovým pruhem pod deskou (`.status-bar`). Na pozadí náhodný `background_NN.webp`
 * (`.page-bg`). Znovupoužití tříd i globálního `--board-size` drží „vejde se do
 * viewportu" na jednom místě – žádný druhý výpočet velikosti desky.
 *
 * Skládá dohromady tři díly z jiných modulů:
 *  - {@link createPvpController} = deska (klik-tah vč. vícenásobného skoku, orientace
 *    dle vlastní barvy). Tah posílá přes `link.move` (room WS – fáze 70).
 *  - {@link createGameSocket} = odběr stavu partie přes `/games/:id/ws`; každý
 *    pushnutý stav předá `controller.applyState` (server je autorita, deska jen kreslí).
 *  - `link.onError` = chyby tahu (odmítnutí serverem) míří do `controller.showError`
 *    (deska se vrátí na poslední potvrzený stav, ukáže se hláška).
 *
 * Kdo je na tahu ukazuje REÁLNÝ kámen na boku desky (`.pvp-turn`): na změnu tahu
 * se mění jen třída kamene (obrázek/barva), ne obal indikátoru. Kámen je primárně
 * webp (`black.webp`/`white.webp`), zapnutý přes třídu `.pvp-turn--img` AŽ po
 * ověřeném načtení (`preloadImages`); do té doby (a při chybě/jsdom) platí prosté
 * CSS kolečko černé/bílé. Barvu na tahu poznat i BEZ indikátoru z vlastních kamenů
 * dole, proto tu není textová hláška „kdo je na tahu" – textový pruh nese jen
 * výsledek, ztrátu spojení a chybu tahu.
 *
 * DŮLEŽITÉ: room WS zůstává OTEVŘENÝ (drží ho `main.ts` přes lobby) – tahy i příkazy
 * (vzdání/remíza/odveta/Konec) jdou tudy a partie je na serveru navázaná na session id.
 * Návrat do místnosti (`onBackToRoom`) jen přepne pohled; volá se z „Konec"/„Odveta",
 * ze signálu `game-closed` (soupeř dal Konec) a z nouzového modalu po ztrátě spojení.
 * Herní WS (stav) je NAOPAK vlastní téhle obrazovce a `dispose` ho zavře.
 *
 * Mimo řez (vědomě): reconnection (todo 42), timeout nečinnosti (todo 43).
 * Žádné inline styly ani skripty (CSP) – vzhled je ve `styles.css`.
 */

import type { Color, GameResult } from '@checkers/rules';

import { backgroundUrls, pickBackground } from './backgrounds.js';
import { createGameSocket } from './game-socket.js';
import type { GameSocketFactory } from './game-socket.js';
import { preloadImages } from './image-preload.js';
import { createPvpController } from './pvp-controller.js';
import type { PvpStatus } from './pvp-controller.js';
import blackStoneUrl from './assets/black.webp?url';
import whiteStoneUrl from './assets/white.webp?url';
import type { GameLink } from './lobby.js';
import type { ChallengeAcceptedInfo } from './room-client.js';

export interface GameScreenOptions {
  /** Návrat do místnosti (jen přepnutí pohledu; room WS řídí caller a NEzavírá se). */
  readonly onBackToRoom: () => void;
  /** Most k živému room WS: odeslání tahu + příjem chyb tahu (z lobby). */
  readonly link: GameLink;
  /** URL herního WS – jen pro testy; jinak se odvodí z `location`. */
  readonly gameSocketUrl?: string;
  /** Náhrada tovární funkce herního socketu – jen pro testy (fake socket). */
  readonly gameSocketFactory?: GameSocketFactory;
  /**
   * Náhrada tovární funkce na `Image` pro ověření kamenů indikátoru – jen pro testy
   * (fake Image, ať jde deterministicky ověřit přepnutí na webp). Ve hře je výchozí
   * `() => new Image()`; `null` (prostředí bez `Image`) ověření přeskočí a indikátor
   * zůstane na CSS fallbacku.
   */
  readonly createStoneImage?: (() => HTMLImageElement) | null;
}

/** Ovládaná herní obrazovka. `dispose` zavře herní WS a odregistruje listenery (room WS se tu nezavírá). */
export interface GameScreen {
  readonly element: HTMLElement;
  dispose(): void;
}

/** Text výsledku z pohledu hráče `myColor` (jen pro terminální výsledek). */
function outcomeText(result: Exclude<GameResult, 'ongoing'>, myColor: Color): string {
  if (result === 'draw') {
    return 'Remíza.';
  }
  const iWin =
    (result === 'black-wins' && myColor === 'black') ||
    (result === 'white-wins' && myColor === 'white');
  return iWin ? 'Vyhrál jsi!' : 'Prohrál jsi.';
}

/** Postaví herní obrazovku. Vrací kořenový prvek k vložení do stránky. */
export function createGameScreen(info: ChallengeAcceptedInfo, options: GameScreenOptions): GameScreen {
  // `true` po dispose(): async ověření kamenů (preloadImages) může doběhnout až po
  // odchodu z obrazovky – pak už do (odpojeného) indikátoru nesahej.
  let disposed = false;

  // Stav pro ovládání vzdání/remízy (fáze 77). `result` a `connLost` řídí, jestli
  // jdou tlačítka použít (jen za běhu partie a s živým herním kanálem). `iOffered` =
  // já jsem nabídl remízu a čekám na soupeře (jen poznámka ve stavovém pruhu, ne
  // modal). `modalKind` = co je právě v modalu: potvrzení vzdání (`resign`), příchozí
  // nabídka soupeře (`draw-offer`), nebo VÝSLEDEK dohrané partie (`result`, s tlačítky
  // Odveta/Konec). Nejvýš jeden naráz. Dotazy resign/draw-offer ruší KAŽDÝ nový
  // autoritativní stav; výsledkový modal naopak drží (konec je konec) – zavře ho až
  // volba Odveta/Konec.
  let result: GameResult = 'ongoing';
  // `false`, dokud nedorazí PRVNÍ stav partie – do té doby je deska prázdná a
  // tlačítka (vzdát/remíza) zamčená (není co vzdát, partie se teprve načítá).
  let started = false;
  let connLost = false;
  let iOffered = false;
  // Modaly: 'resign'/'draw-offer' = dotazy za běhu; 'result' = konec partie (Odveta/
  // Konec); 'rematch-wait' = nabídl jsem odvetu a čekám na soupeře (jen Konec);
  // 'rematch-incoming' = soupeř nabídl odvetu mně (Přijmout/Odmítnout).
  let modalKind:
    | 'none'
    | 'resign'
    | 'draw-offer'
    | 'result'
    | 'rematch-wait'
    | 'rematch-incoming'
    | 'disconnected' = 'none';

  const element = document.createElement('div');
  element.className = 'game';

  // Pozadí celé stránky: skrytý `<img>` přes celý viewport, POD obsahem (třída
  // `.page-bg`). URL se losuje JEDNOU při vzniku obrazovky – nová partie = nová
  // výzva = nová obrazovka, uvnitř se „nová hra" neděje. Prázdný výčet (žádné pozadí)
  // → src='' → prosvítá barevné pozadí z CSS. `src` je atribut, ne styl → CSP OK.
  const pageBg = document.createElement('img');
  pageBg.className = 'page-bg';
  pageBg.alt = '';
  pageBg.src = pickBackground(backgroundUrls, Math.random) ?? '';
  element.append(pageBg);

  // Panel s ovládáním NAD deskou (na šířku desky). Vlevo TUČNÁ přezdívka soupeře,
  // svislý oddělovač, pak „Nabídnout remízu" a „Vzdát se" (fáze 77). Žádné „Zpět do
  // místnosti" za běhu – viz níže. Barvu, za kterou hraju, tu NEPÍŠEME – je jasná z
  // vlastních kamenů dole na desce.
  const panel = document.createElement('div');
  panel.className = 'panel';
  const controls = document.createElement('div');
  controls.className = 'controls pvp-controls';
  // Popisek „Soupeř:" (běžný řez) + TUČNÁ přezdívka, ať je jasné, že jde o jméno
  // soupeře, ne o moje.
  const opponentLabel = document.createElement('span');
  opponentLabel.className = 'pvp-opponent-label';
  opponentLabel.textContent = 'Soupeř:';
  const opponent = document.createElement('span');
  opponent.className = 'pvp-opponent';
  opponent.textContent = info.opponentNick;
  const divider = document.createElement('span');
  divider.className = 'controls-divider';
  divider.setAttribute('aria-hidden', 'true');
  // Nabídnout remízu + Vzdát se (fáze 77). Aktivní jen za běhu partie a s živým
  // herním kanálem (viz `refreshControls`); server je stejně autorita a chybný
  // příkaz odmítne. Dotaz na potvrzení vzdání i příchozí nabídka jdou do MODALU níž.
  const offerDrawBtn = document.createElement('button');
  offerDrawBtn.type = 'button';
  offerDrawBtn.className = 'btn-offer-draw';
  offerDrawBtn.textContent = 'Nabídnout remízu';
  const resignBtn = document.createElement('button');
  resignBtn.type = 'button';
  resignBtn.className = 'btn-resign';
  resignBtn.textContent = 'Vzdát se';
  // ZÁMĚRNĚ bez tlačítka „Zpět do místnosti" za běhu partie (fáze 77): jen se odpojí
  // z DOM, ale na serveru zůstaneš `busy` (v partii) → zablokovaný pro další hru až
  // do refreshe (bez reconnectionu se do partie nevrátíš). Čistý odchod z běžící
  // partie je „Vzdát se"; z dohrané „Konec" (uvolní oba). `options.onBackToRoom` se
  // volá jen z těch cest.
  controls.append(opponentLabel, opponent, divider, offerDrawBtn, resignBtn);

  panel.append(controls);

  // Jeden MODAL pro oba dotazy (fáze 77): potvrzení vzdání a příchozí nabídku remízy.
  // Vždy je otevřený nejvýš jeden (`modalKind`); přepíná se text i akční tlačítka.
  // Znovupoužívá CSP-bezpečné třídy `.modal-overlay`/`.modal-dialog` (jako výsledkový
  // modal u hry vs. PC – žádné inline styly). NENÍ to nativní `confirm()` (ten blokuje
  // WS event loop); je to obyčejný overlay v DOM, WS běží dál. Překryv nad vším
  // zabrání souběžnému kliku na ovládání pod ním.
  const modal = document.createElement('div');
  modal.className = 'modal-overlay hidden';
  const modalDialog = document.createElement('div');
  modalDialog.className = 'modal-dialog';
  modalDialog.setAttribute('role', 'dialog');
  modalDialog.setAttribute('aria-modal', 'true');
  const modalMsg = document.createElement('p');
  modalMsg.className = 'modal-msg';
  // Krátká poznámka UVNITŘ modalu (např. „Soupeř odvetu odmítl."). NoticeLine pod
  // deskou je za overlayem = neviditelný, proto vlastní řádek nad tlačítky.
  const modalNotice = document.createElement('p');
  modalNotice.className = 'modal-notice hidden';
  const modalActions = document.createElement('div');
  modalActions.className = 'modal-actions';
  // Primární = kladná akce (Ano, vzdát se / Přijmout remízu), sekundární = zápor
  // (Zrušit / Odmítnout). Konkrétní text, třídu a chování nastaví `openResignModal`
  // / `openDrawOfferModal` podle `modalKind`; klik dispatchuje `onModalPrimary`/
  // `onModalSecondary`.
  const modalPrimaryBtn = document.createElement('button');
  modalPrimaryBtn.type = 'button';
  const modalSecondaryBtn = document.createElement('button');
  modalSecondaryBtn.type = 'button';
  modalActions.append(modalPrimaryBtn, modalSecondaryBtn);
  modalDialog.append(modalMsg, modalNotice, modalActions);
  modal.append(modalDialog);

  const controller = createPvpController({
    myColor: info.color,
    sendMove: (from, path) => options.link.move(from, path),
    onStatus: renderStatus,
    onError: showMoveError,
  });

  // Indikátor strany na tahu: SAMOTNÝ kámen na boku desky (bez prstence). Obal
  // (`.pvp-turn`) persistuje; na změnu tahu se přepíná jen třída kamene (.black/
  // .white → jiný obrázek/barva). Startuje skrytý, zobrazí se s prvním stavem
  // partie a schová se po konci (viz `updateTurnIndicator`). Kámen je webp až po
  // ověřeném načtení (`.pvp-turn--img`), jinak CSS kolečko.
  const turnIndicator = document.createElement('div');
  turnIndicator.className = 'pvp-turn hidden';
  const turnStone = document.createElement('div');
  turnStone.className = 'pvp-turn-stone';
  turnIndicator.append(turnStone);

  // Řádek desky: deska + indikátor na tahu vedle sebe (na <768 px se `.board-row`
  // v CSS přepne na sloupec a indikátor je pod deskou). Panel je NAD tímto řádkem.
  const boardRow = document.createElement('div');
  boardRow.className = 'board-row';
  boardRow.append(controller.element, turnIndicator);

  // Stavový pruh POD deskou (`flex: 1` ho roztáhne do zbytku výšky – deska se
  // nenatáhne a celek se vejde do okna). Nese už JEN: hlášku o načítání / výsledek /
  // ztrátu spojení (`statusLine`) a chybu odmítnutého tahu (`errorLine`). Kdo je na
  // tahu ukazuje kámen v indikátoru, ne text.
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  const statusLine = document.createElement('p');
  statusLine.className = 'status hidden';
  // Neutrální poznámka k remíze (fáze 77): „nabídl jsi remízu, čekám…" / „soupeř
  // odmítl". NENÍ to chyba (`errorLine`) ani výsledek (`statusLine`) – jen informace.
  const noticeLine = document.createElement('p');
  noticeLine.className = 'pvp-notice hidden';
  const errorLine = document.createElement('p');
  errorLine.className = 'pvp-error hidden';
  statusBar.append(statusLine, noticeLine, errorLine);

  element.append(panel, boardRow, statusBar, modal);
  setStatus('Připojuji k partii…');

  // Zapnutí webp kamene indikátoru AŽ po ověřeném načtení obou obrázků (jako u
  // desky – `piece-images.ts`): jistota, že se `url(...)` ve `styles.css` opravdu
  // vykreslí, jinak zůstat na CSS kolečku. V jsdom se `onload`/`onerror` nevyvolá →
  // promise visí → fallback drží (test si `createStoneImage` injektuje). `null`
  // (prostředí bez `Image`) ověření přeskočí.
  const createStoneImage =
    options.createStoneImage ?? (typeof Image === 'function' ? (): HTMLImageElement => new Image() : null);
  if (createStoneImage !== null) {
    void preloadImages([blackStoneUrl, whiteStoneUrl], createStoneImage).then((ok) => {
      if (ok && !disposed) {
        turnIndicator.classList.add('pvp-turn--img');
      }
    });
  }

  // Chyby tahu z room WS (přes lobby most) → deska se vrátí na poslední stav a ukáže hlášku.
  // Chyba je i odmítnutý příkaz remízy/vzdání (např. „remíza už je nabídnutá"): pak
  // moje optimistické „čekám na soupeře" neplatí → zahoď ho a překresli tlačítka.
  const unsubscribeError = options.link.onError((message) => {
    if (iOffered) {
      iOffered = false;
      setNotice('');
      refreshControls();
    }
    // Chyba během čekání na odvetu (jediná odchozí operace v tom stavu je nabídka
    // odvety) = nabídka NEprošla (soupeř odešel / už nabídnul). `showError` míří na
    // řádek POD deskou = za overlayem neviditelný, a nabízející by ve „Čekám…" uvázl.
    // Proto se vrať na výsledek a důvod ukaž V modalu.
    if (modalKind === 'rematch-wait') {
      reopenResult();
      setModalNotice(message);
      return;
    }
    controller.showError(message);
  });

  // Nabídnout remízu: optimisticky ukaž „čekám na soupeře" a zamkni tlačítko. Server
  // je autorita – když nabídku odmítne (offer-exists apod.), přijde `error` a stav se
  // vrátí (viz `unsubscribeError`). Soupeřovu odpověď doručí `onDrawOffered`/game-state.
  const onOfferDraw = (): void => {
    if (offerDrawBtn.disabled) {
      return;
    }
    if (options.link.offerDraw()) {
      iOffered = true;
      setNotice('Nabídl jsi remízu, čekám na odpověď soupeře…');
      refreshControls();
    } else {
      setNotice('Spojení není dostupné – zkus to znovu.');
    }
  };
  offerDrawBtn.addEventListener('click', onOfferDraw);

  // Vzdání je nevratné → klik na „Vzdát se" otevře MODAL s dotazem; teprve „Ano,
  // vzdát se" ho odešle. Terminální stav pak dorazí game-state cestou.
  const onResign = (): void => {
    if (resignBtn.disabled) {
      return;
    }
    openResignModal();
  };
  resignBtn.addEventListener('click', onResign);

  // Klik na akční tlačítka MODALU dispatchuje podle toho, který dotaz je otevřený.
  // Primární = kladná akce, sekundární = zápor. Modal je vždy nejvýš jeden (`modalKind`).
  const onModalPrimary = (): void => {
    if (modalKind === 'resign') {
      // Potvrzené vzdání. Zavři modal AŽ po pokusu; když příkaz neodešel (room WS
      // dole), ukaž poznámku a modal zavři tak jako tak (opakovat jde přes tlačítko).
      closeModal();
      if (!options.link.resign()) {
        setNotice('Spojení není dostupné – zkus to znovu.');
      }
    } else if (modalKind === 'draw-offer') {
      // Přijetí nabídky → server ukončí partii, terminální stav (draw) dorazí OBĚMA
      // přes game-state. Modal zavři JEN když příkaz odešel: jinak serverová nabídka
      // visí dál a bez modalu bych ji nemohl přijmout (tichá ztráta).
      if (options.link.acceptDraw()) {
        closeModal();
      } else {
        setNotice('Spojení není dostupné – zkus to znovu.');
      }
    } else if (modalKind === 'result') {
      // ODVETA: nabídni soupeři a ZŮSTAŇ na obrazovce (čekej). Po přijetí přijde nová
      // partie přes `challenge-accepted` (obrazovka se vymění). Když příkaz nedošel
      // (spojení dole), zůstaň na výsledku s hláškou.
      if (options.link.offerRematch()) {
        openRematchWaitModal();
      } else {
        setNotice('Spojení není dostupné – zkus to znovu.');
      }
    } else if (modalKind === 'rematch-incoming') {
      // PŘIJMOUT odvetu → server založí novou partii, obě strany přejdou přes
      // `challenge-accepted` (tahle obrazovka se zahodí). Modal nezavírám ručně –
      // udělá to přechod. Když příkaz nedošel, zůstaň na dotazu s hláškou.
      if (!options.link.acceptRematch()) {
        setNotice('Spojení není dostupné – zkus to znovu.');
      }
    } else if (modalKind === 'disconnected') {
      // NOUZOVÝ východ po ztrátě spojení → do místnosti (server-side busy zůstane,
      // dokud partie doběhne timeoutem / hráč obnoví stránku – reconnection = todo 42).
      options.onBackToRoom();
    }
  };
  const onModalSecondary = (): void => {
    if (modalKind === 'resign') {
      closeModal(); // Zrušit – žádný příkaz, partie běží dál
    } else if (modalKind === 'draw-offer') {
      // Odmítnutí → nabídka zmizí, partie běží dál; soupeři se pošle `draw-rejected`.
      // Modal zavři JEN při úspěšném odeslání (viz přijetí výš).
      if (options.link.rejectDraw()) {
        closeModal();
        setNotice('Nabídku remízy jsi odmítl.');
      } else {
        setNotice('Spojení není dostupné – zkus to znovu.');
      }
    } else if (modalKind === 'result' || modalKind === 'rematch-wait') {
      // KONEC: uvolní oba na serveru (ať můžou hrát s někým jiným) a přechod do
      // místnosti. Z 'rematch-wait' je to zároveň „přestat čekat na odvetu" – server
      // při leave-game pošle soupeři `game-closed`, ať se taky přesune do místnosti.
      options.link.leaveGame();
      options.onBackToRoom();
    } else if (modalKind === 'rematch-incoming') {
      // ODMÍTNOUT odvetu → zpět na výsledek (Odveta/Konec). Když příkaz nedošel,
      // zůstaň na dotazu s hláškou.
      if (options.link.declineRematch()) {
        reopenResult();
      } else {
        setNotice('Spojení není dostupné – zkus to znovu.');
      }
    }
  };
  modalPrimaryBtn.addEventListener('click', onModalPrimary);
  modalSecondaryBtn.addEventListener('click', onModalSecondary);

  // Klik na ztmavené pozadí (mimo dialog): u vzdání = Zrušit (bezpečné), u nabídky
  // remízy ZÁMĚRNĚ nic (uživatel musí vybrat Přijmout/Odmítnout – rozhodnutí zadání).
  const onModalBackdrop = (event: MouseEvent): void => {
    if (event.target === modal && modalKind === 'resign') {
      closeModal();
    }
  };
  modal.addEventListener('click', onModalBackdrop);

  // Esc: stejná logika jako backdrop – zavře jen dotaz na vzdání, nabídku remízy nechá.
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && modalKind === 'resign') {
      closeModal();
    }
  };
  document.addEventListener('keydown', onKeydown);

  // Soupeř nabídl remízu → otevři MODAL s dotazem přijmout/odmítnout (jen za běhu
  // partie a s živým kanálem). Případný otevřený dotaz na vzdání nahradí (nabídka je
  // aktuálnější a vzdání ještě neodešlo – vzdát se dá pořád znovu).
  const unsubscribeOffered = options.link.onDrawOffered(() => {
    if (result !== 'ongoing' || connLost) {
      return;
    }
    setNotice('');
    openDrawOfferModal();
  });
  // Soupeř odmítl MOU nabídku → zruš „čekám" a oznam to.
  const unsubscribeRejected = options.link.onDrawRejected(() => {
    iOffered = false;
    setNotice('Soupeř nabídku remízy odmítl.');
    refreshControls();
  });

  // Soupeř nabídl ODVETU (po konci partie) → ukaž dotaz Přijmout/Odmítnout. Jen když
  // je partie dohraná (odveta jindy nedává smysl) a kanál žije.
  const unsubscribeRematchOffered = options.link.onRematchOffered(() => {
    if (result === 'ongoing' || connLost) {
      return;
    }
    openRematchIncomingModal();
  });
  // Soupeř MOU nabídku odvety odmítl → zpět na výsledek s hláškou. Přijde jen když
  // čekám ('rematch-wait'); soupeřovo opuštění partie řeší `onGameClosed` níž.
  const unsubscribeRematchDeclined = options.link.onRematchDeclined(() => {
    if (modalKind !== 'rematch-wait') {
      return;
    }
    reopenResult();
    setModalNotice('Soupeř odvetu odmítl.');
  });
  // Soupeř dal „Konec" → partie skončila pro OBA → přesun do místnosti (ať nevisím na
  // výsledku/dotazu a nevím, co se děje). Server mě už uvolnil z busy.
  const unsubscribeGameClosed = options.link.onGameClosed(() => {
    options.onBackToRoom();
  });

  // Odběr stavu partie přes herní WS. Každý push → controller.applyState.
  const gameSocket = createGameSocket(
    info.gameId,
    {
      onState: (game) => {
        controller.applyState(game);
      },
      onClosed: () => {
        // Partie už dohraná → výsledkový modal (Odveta/Konec) vládne obrazovce;
        // zavření herního WS je po konci benigní (nemá co doručit) a NESMÍ ho
        // přebít hláškou „spojení přerušeno". Deska je stejně už zamčená (konec).
        if (result !== 'ongoing') {
          return;
        }
        // Spojení se stavem partie skončilo (pád / restart serveru / neznámá partie).
        // ZAMKNI desku (bez živého kanálu by potvrzený stav tahu nedorazil → deska by
        // tiše přijala tah, který nikam nejde). `setConnectionLost` uvnitř přes onStatus
        // zavolá renderStatus (ta stav vyprázdní), proto hlášku i modal řešíme AŽ PO něm.
        controller.setConnectionLost();
        connLost = true;
        setStatus('Spojení s partií se přerušilo.');
        // Deska je mrtvá → schovej i indikátor na tahu (jinak by dál svítil kámen a
        // aria-label by tvrdil „na tahu", i když se nedá hrát).
        turnIndicator.classList.add('hidden');
        // Bez živého kanálu nemá vzdání/remíza smysl (potvrzení stavu by nedorazilo):
        // zamkni tlačítka a zavři případný otevřený dotaz.
        clearDrawState();
        refreshControls();
        // NOUZOVÝ východ: za běhu partie NENÍ tlačítko „Zpět do místnosti" v panelu
        // (vzdání/remíza jsou zamčené connLostem), takže bez modalu by uživatel uvázl
        // a musel reloadovat. Modal dá cestu do místnosti. Reconnection je todo 42 –
        // busy na serveru zůstane, dokud partie doběhne timeoutem / hráč obnoví stránku.
        openDisconnectedModal();
      },
    },
    {
      ...(options.gameSocketUrl === undefined ? {} : { url: options.gameSocketUrl }),
      ...(options.gameSocketFactory === undefined ? {} : { socketFactory: options.gameSocketFactory }),
    },
  );

  /** Nastaví text stavového řádku a schová ho, když je prázdný (ať prázdný odstavec ve vodorovném pruhu netvoří mezeru/oddělovač). */
  function setStatus(text: string): void {
    statusLine.textContent = text;
    statusLine.classList.toggle('hidden', text === '');
  }

  /**
   * Indikátor strany na tahu: viditelný jen za běhu partie (`result === 'ongoing'`),
   * kámen v barvě strany NA TAHU. `aria-label` nese informaci i pro čtečku (kámen je
   * jinak čistě vizuální). Barvu drž i ve skrytém stavu, ať při dalším zobrazení
   * neproblikne stará.
   */
  function updateTurnIndicator(status: PvpStatus): void {
    const ongoing = status.result === 'ongoing';
    turnIndicator.classList.toggle('hidden', !ongoing);
    turnStone.classList.toggle('black', status.turn === 'black');
    turnStone.classList.toggle('white', status.turn === 'white');
    turnIndicator.setAttribute('aria-label', status.turn === info.color ? 'Na tahu: ty' : 'Na tahu: soupeř');
  }

  /**
   * Vykreslí stav podle stavu partie z controlleru. Za běhu je textový řádek prázdný
   * (kdo je na tahu ukazuje kámen); terminální výsledek jde do řádku. Nová událost
   * skryje starou chybu tahu.
   *
   * KAŽDÝ nový autoritativní stav (tah, konec) zavře otevřený dotaz (vzdání i nabídku)
   * a zruší „čekám na remízu" – server je zdroj pravdy, tah navíc na serveru nabídku
   * maže (fáze 77). Díky tomu se stav tlačítek nikde nezasekne bez zvláštního signálu.
   */
  function renderStatus(status: PvpStatus): void {
    hideMoveError();
    started = true;
    result = status.result;
    clearDrawState(); // zavře případný dotaz vzdání/nabídky (ne výsledkový modal)
    updateTurnIndicator(status);
    if (status.result !== 'ongoing') {
      setStatus(outcomeText(status.result, info.color));
      openResultModal(status.result); // konec partie → modal s Odveta/Konec
    } else {
      setStatus('');
    }
    refreshControls();
  }

  function showMoveError(message: string): void {
    errorLine.textContent = message;
    errorLine.classList.remove('hidden');
  }
  function hideMoveError(): void {
    errorLine.textContent = '';
    errorLine.classList.add('hidden');
  }

  /** Neutrální poznámka k remíze (nabídl jsi / soupeř odmítl); prázdná ji skryje. */
  function setNotice(text: string): void {
    noticeLine.textContent = text;
    noticeLine.classList.toggle('hidden', text === '');
  }

  /**
   * Zámek tlačítek podle stavu: hrát smíš, jen když partie běží a herní kanál žije.
   * „Vzdát se" je navíc zamčené, když už jeho dotaz visí v modalu; „Nabídnout remízu"
   * zamčené, když nabídka visí (moje čekání nebo soupeřova příchozí v modalu).
   */
  function refreshControls(): void {
    const canAct = started && result === 'ongoing' && !connLost;
    resignBtn.disabled = !canAct || modalKind === 'resign';
    offerDrawBtn.disabled = !canAct || iOffered || modalKind === 'draw-offer';
  }

  /** Otevře modal a dá fokus na první viditelné akční tlačítko (přístupnost). Poznámku v modalu vyčistí. */
  function showModal(): void {
    setModalNotice('');
    modal.classList.remove('hidden');
    const focusBtn = modalPrimaryBtn.classList.contains('hidden') ? modalSecondaryBtn : modalPrimaryBtn;
    focusBtn.focus();
  }

  /** Poznámka uvnitř modalu (např. „Soupeř odvetu odmítl."); prázdná ji skryje. */
  function setModalNotice(text: string): void {
    modalNotice.textContent = text;
    modalNotice.classList.toggle('hidden', text === '');
  }

  /** Zavře modal (žádný dotaz nevisí) a překreslí tlačítka. */
  function closeModal(): void {
    modalKind = 'none';
    modal.classList.add('hidden');
    refreshControls();
  }

  /** Otevře modal s dotazem na potvrzení vzdání (nevratná akce → varovné tlačítko). */
  function openResignModal(): void {
    modalKind = 'resign';
    modalMsg.textContent = 'Opravdu se vzdát? Partii tím prohráváš.';
    modalDialog.setAttribute('aria-label', 'Opravdu se vzdát?');
    modalPrimaryBtn.textContent = 'Ano, vzdát se';
    modalPrimaryBtn.className = 'btn-resign-yes';
    modalSecondaryBtn.textContent = 'Zrušit';
    modalSecondaryBtn.className = 'btn-resign-no';
    refreshControls();
    showModal();
  }

  /** Otevře modal s příchozí nabídkou remízy (kladná akce → zelené tlačítko). */
  function openDrawOfferModal(): void {
    modalKind = 'draw-offer';
    modalMsg.textContent = 'Soupeř nabízí remízu.';
    modalDialog.setAttribute('aria-label', 'Soupeř nabízí remízu');
    modalPrimaryBtn.textContent = 'Přijmout remízu';
    modalPrimaryBtn.className = 'btn-draw-accept';
    modalSecondaryBtn.textContent = 'Odmítnout';
    modalSecondaryBtn.className = 'btn-draw-reject';
    refreshControls();
    showModal();
  }

  /**
   * Otevře VÝSLEDKOVÝ modal (konec partie) s tlačítky Odveta (primární) a Konec
   * (sekundární). Nedismissovatelný (Esc/backdrop nic – viz onKeydown/onModalBackdrop):
   * uživatel musí vybrat, obojí ho odvede do místnosti. Text = výsledek z jeho pohledu.
   */
  function openResultModal(terminal: Exclude<GameResult, 'ongoing'>): void {
    modalKind = 'result';
    modalMsg.textContent = outcomeText(terminal, info.color);
    modalDialog.setAttribute('aria-label', outcomeText(terminal, info.color));
    modalPrimaryBtn.textContent = 'Odveta';
    modalPrimaryBtn.className = 'btn-rematch';
    modalSecondaryBtn.textContent = 'Konec';
    modalSecondaryBtn.className = 'btn-end';
    refreshControls();
    showModal();
  }

  /** Znovu otevře výsledkový modal (po odmítnuté/zrušené odvetě). Jen s terminálním výsledkem. */
  function reopenResult(): void {
    if (result !== 'ongoing') {
      openResultModal(result);
    }
  }

  /**
   * Nabídl jsem odvetu a čekám na soupeře (fáze 77). Zůstávám na obrazovce; jediné
   * tlačítko je „Konec" (přestat čekat → do místnosti). Primární tlačítko je skryté.
   */
  function openRematchWaitModal(): void {
    modalKind = 'rematch-wait';
    modalMsg.textContent = 'Nabídl jsi odvetu. Čekám na odpověď soupeře…';
    modalDialog.setAttribute('aria-label', 'Čekám na odpověď soupeře na odvetu');
    modalPrimaryBtn.className = 'btn-rematch hidden'; // ve waiting není co potvrdit
    modalSecondaryBtn.textContent = 'Konec';
    modalSecondaryBtn.className = 'btn-end';
    setNotice('');
    refreshControls();
    showModal();
  }

  /**
   * Ztráta herního spojení za běhu partie (fáze 77). Deska je mrtvá a vzdání/remíza
   * zamčené → jediné tlačítko je „Zpět do místnosti" (nouzový východ). Sekundární
   * skryté. Nedismissovatelný (Esc/backdrop nic – není kam „zavřít"). POZOR: busy na
   * serveru tím neuvolní (partie na serveru běží dál) – to řeší až reconnection/timeout.
   */
  function openDisconnectedModal(): void {
    modalKind = 'disconnected';
    modalMsg.textContent =
      'Spojení s partií se přerušilo. Pro novou hru může být potřeba obnovit stránku.';
    modalDialog.setAttribute('aria-label', 'Spojení s partií se přerušilo');
    modalPrimaryBtn.textContent = 'Zpět do místnosti';
    modalPrimaryBtn.className = 'btn-end';
    modalSecondaryBtn.className = 'btn-end hidden';
    showModal();
  }

  /** Soupeř nabídl odvetu MNĚ (fáze 77): Přijmout (prohodí barvy) / Odmítnout. */
  function openRematchIncomingModal(): void {
    modalKind = 'rematch-incoming';
    modalMsg.textContent = 'Soupeř chce odvetu. Barvy se prohodí.';
    modalDialog.setAttribute('aria-label', 'Soupeř nabízí odvetu');
    modalPrimaryBtn.textContent = 'Přijmout odvetu';
    modalPrimaryBtn.className = 'btn-draw-accept';
    modalSecondaryBtn.textContent = 'Odmítnout';
    modalSecondaryBtn.className = 'btn-draw-reject';
    setNotice('');
    refreshControls();
    showModal();
  }

  /**
   * Zruší visící stavy NABÍDKY remízy: mé „čekám", poznámku i otevřený DOTAZ vzdání /
   * příchozí nabídky. VÝSLEDKOVÝ modal ZÁMĚRNĚ nechá (konec je konec – zavře ho až
   * volba Odveta/Konec). Volá se na každý nový autoritativní stav a při ztrátě spojení.
   */
  function clearDrawState(): void {
    iOffered = false;
    setNotice('');
    if (modalKind === 'resign' || modalKind === 'draw-offer') {
      closeModal();
    }
  }

  // Výchozí stav ovládání (partie se teprve načítá → tlačítka zamčená do prvního stavu).
  refreshControls();

  return {
    element,
    dispose: (): void => {
      disposed = true;
      offerDrawBtn.removeEventListener('click', onOfferDraw);
      resignBtn.removeEventListener('click', onResign);
      modalPrimaryBtn.removeEventListener('click', onModalPrimary);
      modalSecondaryBtn.removeEventListener('click', onModalSecondary);
      modal.removeEventListener('click', onModalBackdrop);
      document.removeEventListener('keydown', onKeydown); // globální listener nesmí přežít obrazovku
      unsubscribeError(); // chyby tahu už do zavřené obrazovky nesměruj
      unsubscribeOffered(); // signály remízy už do zavřené obrazovky nesměruj
      unsubscribeRejected();
      unsubscribeRematchOffered(); // signály odvety už do zavřené obrazovky nesměruj
      unsubscribeRematchDeclined();
      unsubscribeGameClosed();
      gameSocket.close(); // zavři herní WS (room WS drží dál main.ts/lobby)
      controller.dispose();
    },
  };
}

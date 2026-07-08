/**
 * Autoritativní HTTP server partie (Fastify + zod). Server je JEDINÝ zdroj
 * pravdy: každý tah se ověřuje přes sdílenou `rules` (přes `findLegalMove`),
 * žádná pravidla se tu neduplikují.
 *
 * `buildApp()` vrací nakonfigurovanou instanci bez `listen` (testuje se přes
 * `app.inject()`); reálné naslouchání řeší `main.ts`.
 */

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { THREE_MOVE_BALLOTS } from '@checkers/rules';
import type { Color, Move } from '@checkers/rules';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatGamePdn, writeGamePdn } from './archive.js';
import { findLegalMove, gameToDto, legalMoveDtos, moveToDto } from './dto.js';
import type { GameStateMessage } from './dto.js';
import { GameHub } from './hub.js';
import { RoomPresence } from './presence.js';
import type { RoomServerMessage } from './presence.js';
import { ERROR_CODES, sendError } from './errors.js';
import { LEVELS, STRENGTH_BY_LEVEL, levelUsesBook } from './levels.js';
import { OPENING_BOOK, lookupBookMove } from './opening-book.js';
import type { OpeningBook } from './opening-book.js';
import { GameStore, effectiveResult, opposite } from './store.js';
import type { GameRecord } from './store.js';
import type { EngineMover } from './engine-client.js';

/** Tělo POST /games/:id/moves: výchozí pole + cesta dopadů (čísla 1–32). */
const moveBodySchema = z.object({
  from: z.number().int().min(1).max(32),
  path: z.array(z.number().int().min(1).max(32)).min(1),
});

/**
 * Tělo POST /games: volitelná úroveň obtížnosti a barva člověka. Chybí-li `level`
 * (nebo přijde prázdné tělo), platí výchozí Profesionál; chybí-li `humanColor`,
 * platí `'black'` (dnešek: člověk černý, engine bílý) → zpětně kompatibilní se
 * starým klientem i testy, které tělo neposílají. Neznámá hodnota → chyba (400).
 */
const createGameBodySchema = z.object({
  level: z.enum(LEVELS).default('professional'),
  humanColor: z.enum(['black', 'white']).default('black'),
  // Fixní 3-move ballot pro kolo 2 Mistrovství: klient pošle index zahájení z
  // kola 1, server ho nasadí místo losu. Schema ověří jen TYP (celé číslo ≥ 0) →
  // špatný typ/záporné/neceločíselné padne už tady (400). Rozsah proti délce
  // decku a pravidlo „index jen s championship" řeší route (potřebuje deck z rules).
  ballotIndex: z.number().int().nonnegative().optional(),
});

/**
 * Barva enginu v konkrétní partii = opačná než barva člověka (`opposite`).
 * Barva člověka je uložená u partie (`GameRecord.humanColor`), engine je vždy
 * druhá strana. Dřívější napevno `'white'` je jen výchozí případ (člověk černý).
 */
function engineColorOf(record: GameRecord): Color {
  return opposite(record.humanColor);
}

/**
 * Práh přijetí nabídky remízy: engine remízu přijme, právě když skóre pozice
 * Z POHLEDU ENGINU není kladné (≤ 0), tj. engine pozici nehodnotí jako svou
 * výhru. Když vede, hraje dál a trestá – sedí s cílem kalibrace (silnému hráči
 * vzdorovat, ne vždy vyhrát). Pohled je enginu (ne napevno bílého), aby práh
 * platil i když engine hraje černou. Číslo je vědomě laditelné; skutečné doladění
 * chce odehrané partie (poziční evaluace dává i v remízových pozicích nenulové skóre).
 */
export const DRAW_ACCEPT_MAX_ENGINE_SCORE = 0;

export interface BuildAppOptions {
  /**
   * Engine na tahy bílého. Když chybí, server je čistě manuální (obě strany
   * hraje klient) – zpětně kompatibilní chování z fáze 18.
   */
  readonly engine?: EngineMover;
  /**
   * Adresář pro archivní PDN dokončených partií. Když chybí, archivace je
   * VYPNUTÁ (žádný zápis na disk) – tak běží testy i manuální režim, které
   * disk řešit nechtějí. Reálný běh mu předá cestu z env (`main.ts`).
   */
  readonly pdnDir?: string;
  /**
   * Zdroj náhody pro los třítahového zahájení (úroveň Mistrovství). Předá se
   * store. Když chybí, store použije `Math.random`; test injektuje seedovaný
   * PRNG (`mulberry32`), aby byl los deterministický a měl zuby.
   */
  readonly rng?: () => number;
  /**
   * Kniha zahájení (fáze 56, kandidáti od fáze 57): pozice → seznam tahů. Když
   * chybí, použije se výchozí `OPENING_BOOK`. Injektovatelná kvůli testům –
   * řízená kniha nezávisí na obsahu produkčního seedu.
   */
  readonly openingBook?: OpeningBook;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new GameStore(options.rng);
  const engine = options.engine;
  const pdnDir = options.pdnDir;
  const openingBook = options.openingBook ?? OPENING_BOOK;

  // Jednotná obálka i pro chyby z frameworku: rozbité JSON tělo přijde jako 4xx
  // s `statusCode`, přemapuje se na invalid_request. Neočekávaná chyba (např.
  // RangeError z rules na poškozeném stavu) NENÍ klientská → 500 + log,
  // nikdy se nemaskuje jako 4xx.
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      // Klientská chyba z frameworku (rozbité JSON tělo, špatný Content-Type…).
      // Fixní zpráva – err.message frameworku umí prozradit interní detaily.
      return sendError(reply, status, ERROR_CODES.invalidRequest, 'Neplatný požadavek');
    }
    // Logger je vypnutý (logger: false), takže req.log.error je no-op. Bez
    // tohohle by neočekávaná chyba (např. RangeError z rules) zmizela bez
    // stacku. console.error ji zachová nezávisle na konfiguraci loggeru.
    req.log.error(err);
    console.error('Neočekávaná chyba serveru:', err);
    return sendError(reply, 500, ERROR_CODES.internal, 'Interní chyba serveru');
  });

  // Neznámá routa/metoda: Fastify by jinak vrátil vlastní tvar (error jako
  // string, bez `code`) → drift kontraktu { error: { code, message } }, na který
  // se navěsí web klient. Sjednotíme obálku i tady.
  app.setNotFoundHandler((req, reply) => {
    return sendError(
      reply,
      404,
      ERROR_CODES.notFound,
      `Neznámá cesta ${req.method} ${req.url}`,
    );
  });

  /** GameDto ze záznamu: `result` je EFEKTIVNÍ výsledek (vzdání > pozice). */
  function dtoFor(record: GameRecord): ReturnType<typeof gameToDto> {
    // Ballot tahy: JEN u Mistrovství (`ballotIndex !== null`). Ballot je vždy tři
    // půltahy, které store nasadil jako první tři položky historie (viz store
    // `seedBallot`) – klient je na startu jednou přehraje (animace zahájení).
    // Mimo Mistrovství `null`, ať se drát zbytečně nenafukuje a klient pozná, že
    // žádné intro není. Kopie do drátového tvaru přes `moveToDto`.
    const ballotMoves =
      record.ballotIndex === null ? null : record.moves.slice(0, 3).map(moveToDto);
    return gameToDto(
      record.id,
      record.state,
      record.engineStatus,
      effectiveResult(record),
      record.level,
      record.ballotIndex,
      ballotMoves,
      record.humanColor,
    );
  }

  // Registr WS odběratelů partií (fáze 66). Push je aditivní: web klient dnes
  // stav dál polluje, hub jen navíc rozešle nový stav odběratelům dané partie.
  const hub = new GameHub();
  // Diagnostický přístup k hubu (počet odběratelů) – využívá ho integrační test
  // k deterministickému čekání na registraci odběru (bez arbitrárního sleepu),
  // do budoucna i případné metriky. Není to veřejný HTTP kontrakt.
  app.decorate('gameHub', hub);

  // Registr přítomných hráčů v jedné společné místnosti (fáze 67) – globální
  // real-time vrstva vedle per-partie hubu. Dekorace zpřístupní počet přítomných
  // integračnímu testu (deterministické čekání na zápis hráče, bez sleepu);
  // není to veřejný HTTP kontrakt.
  const presence = new RoomPresence();
  app.decorate('roomPresence', presence);

  /**
   * Rozešle AKTUÁLNÍ stav partie jejím WS odběratelům. Fire-and-forget vedlejší
   * efekt mutačních cest (tah člověka/enginu, vzdání, remíza) – volá se AŽ po
   * změně stavu, nikdy nesmí shodit REST odpověď ani tah enginu (o izolaci
   * chyb se stará hub). Bez odběratelů je to no-op. Kontrakt drátu = `GameDto`
   * v obálce `{ type: 'game-state', game }`, stejný tvar jako REST.
   */
  function broadcast(record: GameRecord): void {
    const message: GameStateMessage = { type: 'game-state', game: dtoFor(record) };
    hub.broadcast(record.id, JSON.stringify(message));
  }

  // WS plugin + endpoint v samostatném pluginu registrovaném AŽ ZA ním: tím je
  // zaručeno pořadí bootu (plugin nastaví `onRoute`/`websocket` dřív, než se
  // route s `websocket: true` přidá). buildApp je synchronní, proto ne `await`,
  // ale fronta pluginů to vyřeší při `ready`/`listen`/`inject`.
  app.register(websocket);
  // Callback (ne async) forma pluginu: encapsulace zaručí pořadí bootu, `done()`
  // ho uzavře; async bez `await` by lint (require-await) odmítl.
  app.register((instance, _opts, done) => {
    // Odběr stavu partie přes WebSocket. Odběr je daný PŘIPOJENÍM na `:id`,
    // klient přes WS nic neposílá (zápisová cesta = REST). Na `close` se socket
    // odhlásí (bez toho by hub i broadcast rostly o mrtvá spojení). Neznámá
    // partie: nezaregistruj a čistě zavři – neblokuj spojení na prázdno.
    instance.get<{ Params: { id: string } }>(
      '/games/:id/ws',
      { websocket: true },
      (socket, req) => {
        const id = req.params.id;
        if (store.get(id) === undefined) {
          socket.close();
          return;
        }
        hub.subscribe(id, socket);
        socket.on('close', () => {
          hub.unsubscribe(id, socket);
        });
      },
    );

    // Místnost přítomnosti (fáze 67). Vstup je ZPRÁVOU, ne připojením: klient po
    // otevření pošle `{ type:'join', nick }`. Server přidělí session id, zapíše
    // hráče a pošle mu `roster` (vč. sebe), ostatním `joined`. Duplicita →
    // `nick-taken` (socket zůstává, klient zkusí návrh). Prázdná/dlouhá → `error`.
    // Dvojí join na tomtéž socketu → `error` (přejmenování není v tomto řezu).
    // `close` odhlásí a rozešle `left` – JEN pokud se hráč opravdu zapsal.
    instance.get('/room/ws', { websocket: true }, (socket) => {
      // Referencí na zapsaného hráče se drží stav spojení: null = ještě nevstoupil
      // (nebo dostal nick-taken/error a zkouší znovu). Autorita nad tímto socketem.
      let me: { id: string } | null = null;

      const send = (message: RoomServerMessage): void => {
        try {
          socket.send(JSON.stringify(message));
        } catch (error) {
          console.error('Místnost: odeslání příchozímu selhalo:', error);
        }
      };

      socket.on('message', (raw: Buffer) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          send({ type: 'error', message: 'Neplatná zpráva (očekávám JSON).' });
          return;
        }
        // Pozor: `JSON.parse('null')` je platný JSON a vrátí `null` (nespadne na
        // catch výš) – čtení `.type` na `null` by hodilo TypeError MIMO try a
        // shodilo handler. Proto tvarová kontrola PŘED přístupem k `.type`.
        // Primitiva a pole tady taky nechceme (join je objekt), odmítni je čistě.
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          send({ type: 'error', message: 'Neplatná zpráva (očekávám objekt).' });
          return;
        }
        const msg = parsed as { type?: unknown; nick?: unknown };
        if (msg.type !== 'join') {
          send({ type: 'error', message: 'Neznámý typ zprávy.' });
          return;
        }
        if (typeof msg.nick !== 'string') {
          send({ type: 'error', message: 'Chybí přezdívka.' });
          return;
        }
        if (me !== null) {
          send({ type: 'error', message: 'Už jsi v místnosti.' });
          return;
        }

        const result = presence.join(msg.nick, socket);
        if (result.status === 'invalid') {
          send({ type: 'error', message: result.reason });
          return;
        }
        if (result.status === 'nick-taken') {
          send({ type: 'nick-taken', suggestion: result.suggestion });
          return;
        }
        // Úspěch. Pořadí: hráč už je v rosteru (join ho zapsal) → pošli `roster`
        // JEN jemu (vč. sebe), teprve pak `joined` VŠEM OSTATNÍM (except = já),
        // ať nedostane vlastní příchod dvakrát.
        me = { id: result.player.id };
        send({ type: 'roster', players: presence.roster() });
        presence.broadcast(
          JSON.stringify({ type: 'joined', player: result.player }),
          result.player.id,
        );
      });

      socket.on('close', () => {
        if (me === null) {
          return; // nikdy nevstoupil → nic neodhlašuj ani nerozesílej
        }
        const id = me.id;
        presence.remove(id);
        // `left` všem zbylým – hráč už je odebraný, except není třeba.
        presence.broadcast(JSON.stringify({ type: 'left', player: { id } }));
      });
    });

    done();
  });

  app.post('/games', (req, reply) => {
    // Prázdné/chybějící tělo → `{}` → zod doplní výchozí úroveň. Neznámá úroveň
    // je klientská chyba (400), ne tichý default.
    const parsed = createGameBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        ERROR_CODES.invalidRequest,
        `Neplatné tělo: očekávám { level: ${LEVELS.join(' | ')}, humanColor: black | white, ballotIndex?: celé číslo ≥ 0 }`,
      );
    }
    const { level, humanColor, ballotIndex } = parsed.data;
    // Fixní ballot (kolo 2 Mistrovství): klientský vstup, server mu nevěří. zod
    // ověřil jen typ (celé číslo ≥ 0); tady zbývá to, co zod nevidí:
    //   (a) rozsah proti reálnému decku – mimo rozsah = 400, ať se nedostane do
    //       store, kde by applyBallotByIndex hodil RangeError → 500;
    //   (b) index dává smysl JEN u Mistrovství – s jinou úrovní je to nesmysl =
    //       400, ne tiché ignorování (maskovaná klientská chyba).
    if (ballotIndex !== undefined) {
      if (ballotIndex >= THREE_MOVE_BALLOTS.length) {
        return sendError(
          reply,
          400,
          ERROR_CODES.invalidRequest,
          `ballotIndex ${String(ballotIndex)} mimo rozsah decku (0–${String(THREE_MOVE_BALLOTS.length - 1)})`,
        );
      }
      if (level !== 'championship') {
        return sendError(
          reply,
          400,
          ERROR_CODES.invalidRequest,
          `ballotIndex lze zadat jen pro úroveň 'championship', ne '${level}'`,
        );
      }
    }
    const record = store.create(level, humanColor, ballotIndex);
    // Mistrovství: partie začíná vylosovaným ballotem → jednorázový záznam KTERÉ
    // zahájení padlo (ověřitelnost losu, debug férovosti). Ballot je zároveň
    // prvními třemi tahy v historii; index je navíc.
    if (record.ballotIndex !== null) {
      console.log(`[games] Mistrovství: partie ${record.id} začíná ballotem #${record.ballotIndex}`);
    }
    // Engine musí táhnout PRVNÍ, kdykoli je na tahu jeho barva hned po založení:
    // (a) Mistrovství s ballotem, po němž je na tahu bílý a bílý = engine;
    // (b) běžná partie, kde je člověk bílý → engine je černý a začíná. Obojí
    // pokryje `maybeTriggerEngine`: sám hlídá `turn === engineColorOf(record)`,
    // takže pro partii, kde na tahu začíná člověk, je to no-op → zpětně kompatibilní.
    maybeTriggerEngine(record);
    // Čerstvý záznam: `maybeTriggerEngine` mohl přepnout engineStatus na
    // `thinking`; odpověď to má ukázat (engine dotáhne na pozadí, klient dopolluje).
    const fresh = store.get(record.id) ?? record;
    return reply.code(201).send(dtoFor(fresh));
  });

  app.get<{ Params: { id: string } }>('/games/:id', (req, reply) => {
    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    return reply.send(dtoFor(record));
  });

  // Vzdání partie: člověk se vzdává → vyhrává engine (druhá barva). Barvu výhry
  // určí store podle uložené `humanColor` (nikoli natvrdo bílý). Vynucený
  // výsledek žije MIMO pravidla (pozice zůstává rozehraná), proto ho drží store.
  // Bez kontroly, kdo je na tahu – vzdát lze kdykoli za běhu, i když engine
  // zrovna přemýšlí (jeho běžící job po probuzení uvidí terminál a nezahraje).
  app.post<{ Params: { id: string } }>('/games/:id/resign', async (req, reply) => {
    const outcome = store.resign(req.params.id);
    if (outcome === 'not-found') {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    if (outcome === 'already-over') {
      return sendError(reply, 409, ERROR_CODES.gameOver, 'Partie je u konce');
    }
    // Partie je teď terminální (výhra enginu) → archivuj právě jednou (markArchived).
    await maybeArchive(outcome);
    broadcast(outcome); // soupeř uvidí konec partie (vzdání) real-time
    return reply.send(dtoFor(outcome));
  });

  // Nabídka remízy: člověk nabídne remízu, engine (druhá barva) o ní rozhodne.
  // Rozhodnutí přichází VÝHRADNĚ z enginu (skóre pozice); práh přijetí drží
  // server (DRAW_ACCEPT_MAX_ENGINE_SCORE). Synchronní: handler počká na engine a
  // vrátí { accepted, game }. Bez enginu nabídka nedostupná (není decidér).
  app.post<{ Params: { id: string } }>('/games/:id/offer-draw', async (req, reply) => {
    if (engine === undefined) {
      return sendError(
        reply,
        409,
        ERROR_CODES.drawOfferUnavailable,
        'Nabídka remízy není v tomto režimu dostupná (server běží bez enginu).',
      );
    }

    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    if (effectiveResult(record) !== 'ongoing') {
      return sendError(reply, 409, ERROR_CODES.gameOver, 'Partie je u konce');
    }
    // Engine přemýšlí (je na tahu) → nabídku teď nepřijímáme: engine by
    // dostal druhý souběžný požadavek do sériové fronty a člověk by čekal až za
    // jeho tah. Klient tlačítko v tomhle stavu ani nenabízí; tohle je pojistka.
    if (record.engineStatus === 'thinking') {
      return sendError(
        reply,
        409,
        ERROR_CODES.engineBusy,
        'Počítač je na tahu, remízu nabídni na svém tahu.',
      );
    }

    // Rozhodnutí enginu. Skóre je z pohledu STRANY NA TAHU (negamax) → přepočet
    // na pohled ENGINU: na tahu engine = beze změny, na tahu člověk = obrácené
    // znaménko. Pohled je enginu (ne napevno bílého), ať práh platí i když engine
    // hraje černou. Selhání enginu (timeout/pád/protokol) NENÍ „engine řekl ne":
    // nabídka spadne jako 503 a partie zůstane beze změny.
    const engineColor = engineColorOf(record);
    let engineScore: number;
    try {
      const { score } = await engine.evaluate(record.state.position);
      engineScore = record.state.position.turn === engineColor ? score : -score;
    } catch (error) {
      console.error(`Engine selhal při vyhodnocení nabídky remízy pro partii ${req.params.id}:`, error);
      return sendError(
        reply,
        503,
        ERROR_CODES.engineUnavailable,
        'Počítač teď nedokáže o nabídce rozhodnout, zkus to prosím znovu.',
      );
    }

    const accepted = engineScore <= DRAW_ACCEPT_MAX_ENGINE_SCORE;
    if (!accepted) {
      // Odmítnuto: stav se nemění, jen se dorovná čerstvý záznam (engine mohl
      // mezitím na svém tahu začít – ale to sem přes guard výš nepustíme).
      const fresh = store.get(record.id) ?? record;
      return reply.send({ accepted: false, game: dtoFor(fresh) });
    }

    // Přijato: acceptDraw je atomický check-and-set přes efektivní výsledek –
    // kdyby partie mezitím skončila jinak, remízu nepřepíše (→ 409 game_over).
    const outcome = store.acceptDraw(record.id);
    if (outcome === 'not-found') {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    if (outcome === 'already-over') {
      return sendError(reply, 409, ERROR_CODES.gameOver, 'Partie je u konce');
    }
    // Partie je teď terminální (draw) → archivuj právě jednou (markArchived).
    await maybeArchive(outcome);
    broadcast(outcome); // soupeř uvidí přijatou remízu real-time
    return reply.send({ accepted: true, game: dtoFor(outcome) });
  });

  // Nápověda tahu (fáze 44, mód „Výuka"): engine spočítá nejlepší tah pro člověka
  // (stranu na tahu) a server ho vrátí. READ-ONLY: nesahá na store ani engineStatus,
  // stav partie se nemění – klient si tah jen zvýrazní. Nápověda hraje VŽDY PLNOU
  // silou (bestmove bez Strength), nezávisle na úrovni partie: má učit objektivně
  // nejlepší tah, ne mělký podle úrovně soupeře. Engine je nedůvěryhodný i když radí,
  // proto se jeho tah OVĚŘÍ přes findLegalMove (jako u tahu enginu níž) – nelegální
  // výstup se člověku nikdy nepodá, spadne jako 503.
  app.get<{ Params: { id: string } }>('/games/:id/hint', async (req, reply) => {
    if (engine === undefined) {
      return sendError(
        reply,
        409,
        ERROR_CODES.hintUnavailable,
        'Nápověda není v tomto režimu dostupná (server běží bez enginu).',
      );
    }

    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    if (effectiveResult(record) !== 'ongoing') {
      return sendError(reply, 409, ERROR_CODES.gameOver, 'Partie je u konce');
    }
    // Na tahu je engine → není co radit člověku; navíc by se druhý souběžný
    // požadavek zařadil do sériové fronty enginu. Klient nápovědu v tomhle stavu
    // ani nežádá; tohle je pojistka (a symetrie s guardem v /moves).
    if (record.state.position.turn === engineColorOf(record)) {
      return sendError(
        reply,
        409,
        ERROR_CODES.notYourTurn,
        'Na tahu je počítač, nápověda je jen na tvém tahu.',
      );
    }

    // Ověřovat proti TÉ pozici, na kterou jsme se enginu ptali (zachytíme ji před
    // awaitem). Selhání enginu (timeout/pád/protokol) NENÍ nápověda: spadne jako 503
    // a partie zůstane beze změny (stejně jako u nabídky remízy).
    const position = record.state.position;
    let suggested: Move;
    try {
      suggested = await engine.bestmove(position, undefined);
    } catch (error) {
      console.error(`Engine selhal při hledání nápovědy pro partii ${req.params.id}:`, error);
      return sendError(
        reply,
        503,
        ERROR_CODES.engineUnavailable,
        'Počítač teď nedokáže poradit, zkus to prosím znovu.',
      );
    }

    // Engine je nedůvěryhodný: doporučený tah PROVĚŘ proti legálním tahům pozice.
    // Nelegální/nesmyslný výstup = engine se zbláznil → 503, člověku se nepodá.
    const legal = findLegalMove(position, suggested.from, suggested.path);
    if (legal === undefined) {
      console.error(`Engine vrátil nelegální nápovědu pro partii ${req.params.id}, odmítám.`);
      return sendError(
        reply,
        503,
        ERROR_CODES.engineUnavailable,
        'Počítač teď nedokáže poradit, zkus to prosím znovu.',
      );
    }

    return reply.send({ move: moveToDto(legal) });
  });

  app.post<{ Params: { id: string } }>('/games/:id/moves', async (req, reply) => {
    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }

    const parsed = moveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        ERROR_CODES.invalidRequest,
        'Neplatné tělo tahu: očekávám { from: 1–32, path: [1–32, …] }',
      );
    }

    // Tah do už skončené partie → 409 game_over. Kontroluje se PŘED hledáním
    // legálního tahu: remíza opakováním / 80 půltahů může mít legální tahy, ale
    // partie je u konce. Přes efektivní výsledek → chytí i vzdanou partii.
    if (effectiveResult(record) !== 'ongoing') {
      return sendError(reply, 409, ERROR_CODES.gameOver, 'Partie je u konce');
    }

    // Autorita barvy: když je zapojený engine, člověk smí táhnout JEN svou
    // stranou. Bez téhle kontroly by klient mohl zahrát legální tah ENGINU,
    // zatímco engine přemýšlí – a přepsat mu pozici pod rukama (autorita
    // serveru by se rozjela s tím, co engine počítá). `findLegalMove` sám tuhle
    // díru nezavře: pro stranu na tahu (enginovu) legální tah najde a přijme.
    if (engine !== undefined && record.state.position.turn === engineColorOf(record)) {
      return sendError(
        reply,
        409,
        ERROR_CODES.notYourTurn,
        'Na tahu je počítač, počkej na jeho tah.',
      );
    }

    const move = findLegalMove(record.state.position, parsed.data.from, parsed.data.path);
    if (move === undefined) {
      return sendError(reply, 409, ERROR_CODES.illegalMove, 'Nelegální tah', {
        legalMoves: legalMoveDtos(record.state.position),
      });
    }

    const next = store.applyMove(record.id, move);
    if (next === undefined) {
      // Partie zmizela mezi get a applyMove – v jednom procesu se nestane.
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }

    // Když partii ukončil PRÁVĚ tento tah člověka (černý vyhrál/remíza), archivuj
    // na disk. `maybeTriggerEngine` níž je s tímhle vzájemně vyloučené (spustí se
    // jen když je partie `ongoing`), pořadí mezi nimi je proto jedno.
    await maybeArchive(next);

    // Je-li zapojený engine a je na tahu (bílý), spusť jeho tah NA POZADÍ –
    // handler nikdy nečeká na engine. Klient tah uvidí pollingem GET.
    maybeTriggerEngine(next);

    // Odpověď nese stav HNED po tahu člověka (engine ještě nedotáhl); jen
    // engineStatus už může být `thinking`, proto se čte čerstvý záznam.
    const fresh = store.get(next.id) ?? next;
    // Push odběratelům partie: soupeř uvidí tah člověka i případný přechod na
    // `thinking` (engine dotáhne vlastním pushem níž). Aditivní k REST odpovědi.
    broadcast(fresh);
    return reply.send(dtoFor(fresh));
  });

  /** Když je na tahu engine v běžící partii, označ `thinking` a spusť job. */
  function maybeTriggerEngine(record: GameRecord): void {
    if (engine === undefined) {
      return;
    }
    if (effectiveResult(record) !== 'ongoing') {
      return;
    }
    if (record.state.position.turn !== engineColorOf(record)) {
      return;
    }
    store.setEngineStatus(record.id, 'thinking');
    void runEngineMove(record.id);
  }

  /**
   * Když je partie v `record` terminální a ještě nebyla archivována, zapiš ji
   * jako PDN na disk. `markArchived` je atomický check-and-set (viz store) –
   * zaručuje zápis PRÁVĚ JEDNOU i kdyby se sem přišlo víckrát. Sestavení PDN
   * (`formatGamePdn`) může vyhodit u poškozeného stavu – to je chyba serveru a
   * MÁ padnout hlasitě; naopak selhání I/O (`writeGamePdn`) partii neshodí.
   * Bez `pdnDir` (nebo běžící partie) je no-op.
   */
  async function maybeArchive(record: GameRecord): Promise<void> {
    if (pdnDir === undefined) {
      return;
    }
    const result = effectiveResult(record);
    if (result === 'ongoing') {
      return;
    }
    if (!store.markArchived(record.id)) {
      return; // už archivováno nebo partie zmizela
    }
    const pdn = formatGamePdn(record.moves, result, new Date());
    await writeGamePdn(pdnDir, record.id, pdn);
  }

  /**
   * Spočítá a zahraje tah enginu. Engine je NEDŮVĚRYHODNÝ: jeho tah se ověří
   * stejnou cestou (`findLegalMove`) jako tah člověka. Jakékoli selhání
   * (timeout+retry vyčerpán, pád, nelegální/protokolová chyba) skončí stavem
   * `error` – partie zůstane stát na tahu člověka, server nespadne. Funkce
   * nikdy nevyhazuje (volá se jako fire-and-forget).
   */
  async function runEngineMove(id: string): Promise<void> {
    if (engine === undefined) {
      return;
    }
    try {
      const record = store.get(id);
      if (record === undefined) {
        return;
      }
      if (
        effectiveResult(record) !== 'ongoing' ||
        record.state.position.turn !== engineColorOf(record)
      ) {
        return; // stav se změnil / engine není na tahu – defenzivně nic nedělej
      }
      // POZOR: tahle kontrola i `store.get` výše MUSÍ zůstat PŘED prvním awaitem
      // (níž `engine.bestmove` nebo u knižního tahu `await Promise.resolve()`).
      // `maybeTriggerEngine` nastaví 'thinking' a synchronně sem vskočí; kdyby se
      // guard/return dostal ZA await, partie by uvázla natrvalo v 'thinking'
      // (reset na 'idle' dělá jen post-await větev níž). Dnes je return před
      // awaitem, takže žádný reset nepotřebuje.

      // Kniha zahájení (fáze 56): jen plnosilové úrovně (`levelUsesBook`). Zásah
      // → knižní tah BEZ volání enginu; server knize nevěří stejně jako enginu,
      // proto se tah ještě ověří přes `findLegalMove` – nelegální/chybějící knižní
      // tah knihu zahodí a hledá se normálně (fallback, ne stav `error`). Lookup
      // je synchronní (žádný await), pozice se pod ním nezmění; přesto knižní tah
      // projde toutéž re-validací proti AKTUÁLNÍ pozici níž jako tah enginu.
      const position = record.state.position;
      let move = levelUsesBook(record.level) ? lookupBookMove(openingBook, position) : undefined;
      if (move !== undefined && findLegalMove(position, move.from, move.path) === undefined) {
        move = undefined; // knižní tah nelegální v této pozici → fallback na hledání
      }

      if (move === undefined) {
        // Mimo knihu (nebo knihu neužije úroveň) → hledá engine. Síla se řídí
        // úrovní partie (fixní po dobu partie, čte se ZE ZÁZNAMU – ne z klienta
        // ani globálu, ať souběžné partie s různými úrovněmi hrají každá svou
        // silou). Profesionál → undefined → engine dostane dnešní požadavek beze
        // změny. `bestmove` je `await` = přirozený předěl: HTTP odpověď na
        // spouštěcí request se odešle dřív, tah dorazí až pollingem.
        move = await engine.bestmove(position, STRENGTH_BY_LEVEL[record.level]);
      } else {
        // Knižní tah je hotový synchronně. MUSÍME ale ustoupit event-loopu, ať se
        // HTTP odpověď na spouštěcí request (POST /games nebo /moves) odešle DŘÍV,
        // než tah aplikujeme – jinak by se aplikoval ještě uvnitř `void
        // runEngineMove(...)` a spouštěcí odpověď by nesla tah už hotový místo
        // `thinking` (rozbitý kontrakt: klient čeká tah enginu pollingem, fáze 30).
        // Po tomto awaitu platí táž re-validace proti AKTUÁLNÍ pozici jako u enginu.
        await Promise.resolve();
      }

      // Po awaitu se stav znovu načte a ověří: tah enginu se aplikuje VÝHRADNĚ
      // proti AKTUÁLNÍ pozici, ne proti snímku z doby před přemýšlením. Za
      // normálního běhu hlídá autorita barvy, že se pozice během `thinking`
      // nezmění; kdyby se přesto změnila, tah enginu se zahodí (ne aplikuje na
      // cizí pozici, kde by `advanceState` vyhodil RangeError).
      const current = store.get(id);
      if (current === undefined) {
        return;
      }
      // Efektivní výsledek → vzdání (které stav pravidel nemění) tady engine
      // zastaví: nezahraje tah do vzdané partie ani ji znovu nearchivuje.
      if (
        effectiveResult(current) !== 'ongoing' ||
        current.state.position.turn !== engineColorOf(current)
      ) {
        // Stav se během přemýšlení změnil (typicky člověk vzdal / přijal remízu):
        // engine netáhne, jen se srovná status na `idle`. Push, ať odběratel
        // nezůstane viset na `thinking` bez pollingu.
        const idled = store.setEngineStatus(id, 'idle');
        if (idled !== undefined) {
          broadcast(idled);
        }
        return;
      }

      const legal = findLegalMove(current.state.position, move.from, move.path);
      if (legal === undefined) {
        console.error(`Engine vrátil nelegální tah pro partii ${id}, odmítám.`);
        // Push `error`: bez tahu enginu tu není applyMove, tedy ani přirozený
        // broadcast bod – jinak odběratel visí na `thinking` do pollingu.
        const errored = store.setEngineStatus(id, 'error');
        if (errored !== undefined) {
          broadcast(errored);
        }
        return;
      }

      store.applyMove(id, legal);
      // Návrat `setEngineStatus` nese tah (applyMove výš) I status `idle` –
      // broadcast jím pushne odběratelům hotový tah enginu (nahrazuje polling).
      const afterEngine = store.setEngineStatus(id, 'idle');
      if (afterEngine !== undefined) {
        broadcast(afterEngine);
      }

      // Tah enginu mohl partii ukončit (bílý vyhrál / remíza) – archivuj.
      // Uvnitř try schválně: kdyby zápis/sestavení házelo, spadne to do větve
      // `error` (engine status), partie nespadne. `writeGamePdn` I/O chybu
      // stejně jen loguje; házet by mohl jen bug v `formatGamePdn`.
      if (afterEngine !== undefined) {
        await maybeArchive(afterEngine);
      }
    } catch (error) {
      console.error(`Tah enginu selhal pro partii ${id}:`, error);
      const errored = store.setEngineStatus(id, 'error');
      if (errored !== undefined) {
        broadcast(errored);
      }
    }
  }

  return app;
}

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
import { findLegalMove, gameToDto, legalMoveDtos, moveToDto, pvpGameToDto } from './dto.js';
import type { AnyGameDto, GameStateMessage, MoveDto } from './dto.js';
import { GameHub } from './hub.js';
import { RoomPresence } from './presence.js';
import type { RoomServerMessage } from './presence.js';
import { ChallengeRegistry } from './challenges.js';
import { ERROR_CODES, sendError } from './errors.js';
import { LEVELS, STRENGTH_BY_LEVEL, levelUsesBook } from './levels.js';
import { OPENING_BOOK, lookupBookMove } from './opening-book.js';
import type { OpeningBook } from './opening-book.js';
import { GameStore, effectiveResult, opposite } from './store.js';
import type { GameRecord, PvpGameRecord } from './store.js';
import type { EngineMover } from './engine-client.js';

/** Tělo POST /games/:id/moves: výchozí pole + cesta dopadů (čísla 1–32). */
const moveBodySchema = z.object({
  from: z.number().int().min(1).max(32),
  path: z.array(z.number().int().min(1).max(32)).min(1),
});

/**
 * Výsledek sdíleného jádra aplikace tahu ({@link buildApp} → `tryApplyMove`, fáze
 * 70). Diskriminovaná unie, ať si každý transport (REST vs. room WS) namapuje
 * výstup na SVŮJ kanál a chybové texty. `illegal` nese legální tahy (klient si
 * opraví nabídku); `vanished` = partie zmizela mezi čtením a zápisem (v jednom
 * procesu prakticky nenastane, ale nesmí to spadnout na `undefined`).
 */
type ApplyMoveResult =
  | { readonly kind: 'game-over' }
  | { readonly kind: 'illegal'; readonly legalMoves: MoveDto[] }
  | { readonly kind: 'vanished' }
  | { readonly kind: 'ok'; readonly record: GameRecord };

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
/**
 * Odmítne engine-orientovaný REST endpoint volaný na PvP partii (fáze 68). PvP
 * partie existuje, ale v tomto řezu se přes REST nehraje ani nečte (todo 36/40) –
 * 409 `pvp_not_playable`, ne 404 (partie JE) ani 500 (není to chyba serveru).
 * JEDNO místo pro tuhle odpověď (GET dto, tah, vzdání, remíza, nápověda).
 */
function rejectPvp(reply: FastifyReply, id: string): FastifyReply {
  return sendError(
    reply,
    409,
    ERROR_CODES.pvpNotPlayable,
    `Partie ${id} je hra dvou lidí; tato akce pro ni zatím není dostupná.`,
  );
}

function engineColorOf(record: GameRecord): Color {
  if (record.mode === 'pvp') {
    // Nedosažitelné: engine-cesty PvP partii odmítnou (pvp_not_playable) dřív, než
    // se sem dostanou. Assertion proti tiché špatné barvě, ne běžná větev.
    throw new Error(`engineColorOf: PvP partie ${record.id} nemá engine barvu (todo 36)`);
  }
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
  function dtoFor(record: GameRecord): AnyGameDto {
    if (record.mode === 'pvp') {
      // PvP tvar (fáze 70): bez engine-specifických polí. `effectiveResult` platí
      // i pro PvP (forcedResult je zatím vždy null – vzdání/remíza PvP je todo 40 –
      // takže se výsledek odvodí čistě z pozice).
      return pvpGameToDto(record.id, record.state, effectiveResult(record));
    }
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

  // Registr čekajících výzev + busy stav párování (fáze 68). Logika mimo route
  // (viz challenges.ts); route jen serializuje a rozesílá. Dekorace zpřístupní
  // registr i store integračnímu testu (deterministické čekání na čekající výzvu /
  // ověření vzniklé PvP partie bez sleepu). Nejde o veřejný HTTP kontrakt.
  const challenges = new ChallengeRegistry();
  app.decorate('challengeRegistry', challenges);
  app.decorate('gameStore', store);

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

  /**
   * Sdílené jádro aplikace tahu (fáze 70): konec partie → legalita proti `rules`
   * → `applyMove`. Vědomě NEobsahuje autoritu „čí je tah" (tu řeší volající podle
   * režimu: engine barva u REST, členství + pořadí u PvP room WS), engine trigger
   * ani archivaci (zůstávají v REST engine cestě). Nepushuje – na `ok` broadcastuje
   * volající sám (REST po engine triggeru, WS hned). Vrací výsledek, ne HTTP/WS
   * odpověď, ať ho každý transport namapuje na svůj kanál.
   */
  function tryApplyMove(record: GameRecord, from: number, path: readonly number[]): ApplyMoveResult {
    // Tah do už skončené partie → konec. PŘED hledáním legálního tahu: remíza
    // opakováním / 80 půltahů může mít legální tahy, ale partie je u konce.
    // Přes efektivní výsledek → chytí i vzdanou (u PvP zatím nenastane, todo 40).
    if (effectiveResult(record) !== 'ongoing') {
      return { kind: 'game-over' };
    }
    const move = findLegalMove(record.state.position, from, path);
    if (move === undefined) {
      return { kind: 'illegal', legalMoves: legalMoveDtos(record.state.position) };
    }
    const next = store.applyMove(record.id, move);
    if (next === undefined) {
      return { kind: 'vanished' };
    }
    return { kind: 'ok', record: next };
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
      // Nick držíme kvůli výzvám (fáze 68): `challenged` nese přezdívku vyzyvatele.
      let me: { id: string; nick: string } | null = null;

      const send = (message: RoomServerMessage): void => {
        try {
          socket.send(JSON.stringify(message));
        } catch (error) {
          console.error('Místnost: odeslání příchozímu selhalo:', error);
        }
      };

      // Vstup pod přezdívkou (fáze 67). Set `me` = zapsaný hráč (vč. nicku).
      const handleJoin = (nick: unknown): void => {
        if (typeof nick !== 'string') {
          send({ type: 'error', message: 'Chybí přezdívka.' });
          return;
        }
        if (me !== null) {
          send({ type: 'error', message: 'Už jsi v místnosti.' });
          return;
        }
        const result = presence.join(nick, socket);
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
        me = { id: result.player.id, nick: result.player.nick };
        send({ type: 'roster', players: presence.roster() });
        presence.broadcast(
          JSON.stringify({ type: 'joined', player: result.player }),
          result.player.id,
        );
      };

      // Výzva na partii (fáze 68). Jen zapsaný hráč smí vyzývat; cíl musí být v
      // místnosti. Logiku (sebe-výzva, busy, dvojitá/křížová) drží registr →
      // `rejected` se vrátí vyzyvateli jako `error`. Úspěch: `challenged` cíli.
      const handleChallenge = (targetId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        if (typeof targetId !== 'string') {
          send({ type: 'error', message: 'Chybí id vyzvaného hráče.' });
          return;
        }
        if (!presence.has(targetId)) {
          send({ type: 'error', message: 'Vyzvaný hráč není v místnosti.' });
          return;
        }
        const result = challenges.create(me.id, targetId);
        if (result.status === 'rejected') {
          send({ type: 'error', message: result.reason });
          return;
        }
        presence.sendTo(
          targetId,
          JSON.stringify({
            type: 'challenged',
            challenge: {
              id: result.challenge.id,
              challengerId: me.id,
              challengerNick: me.nick,
            },
          }),
        );
      };

      // Přijetí výzvy (fáze 68). Přijmout smí jen vyzvaný. Úspěch: vznikne PvP
      // partie (vyzyvatel černá, vyzvaný bílá) a OBA dostanou její id + svou barvu.
      // Vedlejší zrušené výzvy obou hráčů → protějškům `challenge-cancelled`.
      const handleAccept = (challengeId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        if (typeof challengeId !== 'string') {
          send({ type: 'error', message: 'Chybí id výzvy.' });
          return;
        }
        const result = challenges.accept(me.id, challengeId);
        if (result.status === 'gone') {
          send({ type: 'error', message: 'Výzva už neplatí.' });
          return;
        }
        const { challengerId, challengedId } = result.challenge;
        const game = store.createPvp(challengerId, challengedId);
        presence.sendTo(
          challengerId,
          JSON.stringify({
            type: 'challenge-accepted',
            gameId: game.id,
            color: 'black',
            opponentId: challengedId,
          }),
        );
        presence.sendTo(
          challengedId,
          JSON.stringify({
            type: 'challenge-accepted',
            gameId: game.id,
            color: 'white',
            opponentId: challengerId,
          }),
        );
        // Protějšek zaniklé vedlejší výzvy = ten z dvojice, který se PRÁVĚ nespároval.
        const paired = new Set([challengerId, challengedId]);
        for (const c of result.cancelled) {
          const counterpart = paired.has(c.challengerId) ? c.challengedId : c.challengerId;
          presence.sendTo(
            counterpart,
            JSON.stringify({ type: 'challenge-cancelled', challengeId: c.id }),
          );
        }
      };

      // Odmítnutí výzvy (fáze 68). Odmítnout smí jen vyzvaný; úspěch → vyzyvateli
      // `challenge-rejected`. Cizí/neznámé id → `error`, socket žije dál.
      const handleReject = (challengeId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        if (typeof challengeId !== 'string') {
          send({ type: 'error', message: 'Chybí id výzvy.' });
          return;
        }
        const result = challenges.reject(me.id, challengeId);
        if (result.status === 'gone') {
          send({ type: 'error', message: 'Výzva už neplatí.' });
          return;
        }
        presence.sendTo(
          result.challenge.challengerId,
          JSON.stringify({ type: 'challenge-rejected', challengedId: result.challenge.challengedId }),
        );
      };

      // PvP tah (fáze 70). Autorita stojí na `me.id` – identitu hráče přiřadil
      // server TOMUTO socketu při joinu, NEČTE se z klientovy zprávy (session id
      // sice roster zveřejňuje, tady se ale nedá podvrhnout, kdo tah poslal). Řetěz
      // ověření: zapsán → partie existuje a je PvP → hráč je JEJÍ účastník (z toho
      // barva) → je NA TAHU → legalita (sdílené `tryApplyMove`). Každý zádrhel =
      // `error` vyzývateli, socket žije dál a STAV SE NEMĚNÍ. Na úspěch broadcast
      // nového stavu OBĚMA přes game hub `/games/:id/ws`; PvP tudy NEvolá engine
      // ani archiv (konec/vzdání/remíza PvP = todo 40).
      const handleMove = (gameId: unknown, from: unknown, path: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        if (typeof gameId !== 'string') {
          send({ type: 'error', message: 'Chybí id partie.' });
          return;
        }
        // Tvar tahu přes STEJNÉ schema jako REST (jediný zdroj pravdy o tvaru).
        // Tvarová kontrola PŘED přístupem k polím – špatný typ from/path → čistý error.
        const parsedMove = moveBodySchema.safeParse({ from, path });
        if (!parsedMove.success) {
          send({ type: 'error', message: 'Neplatný tah: očekávám { from: 1–32, path: [1–32, …] }.' });
          return;
        }
        const record = store.get(gameId);
        if (record === undefined) {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        if (record.mode !== 'pvp') {
          // Engine partie se přes místnost nehraje (jede REST + engine autorita).
          send({ type: 'error', message: 'Tato partie se v místnosti nehraje.' });
          return;
        }
        // Členství → barva. Neúčastník (me.id ∉ players, i tah na cizí partii) →
        // odmítnutí, ne aplikace.
        const myColor: Color | null =
          record.players.black === me.id
            ? 'black'
            : record.players.white === me.id
              ? 'white'
              : null;
        if (myColor === null) {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        // Konec partie PŘED autoritou pořadí – stejné pořadí jako REST /moves:
        // v terminální pozici (PvP může doběhnout pravidly) dostane i hráč, který
        // není nominálně na tahu, čitelné „konec", ne matoucí „nejsi na tahu".
        // `tryApplyMove` konec kontroluje taky (backstop), ale hláška by tam byla
        // až po autoritě pořadí – proto explicitně tady.
        if (effectiveResult(record) !== 'ongoing') {
          send({ type: 'error', message: 'Partie je u konce.' });
          return;
        }
        // Pořadí: táhnout smíš, jen když je na tahu TVÁ barva (jinak mimo pořadí).
        if (record.state.position.turn !== myColor) {
          send({ type: 'error', message: 'Nejsi na tahu.' });
          return;
        }
        const applied = tryApplyMove(record, parsedMove.data.from, parsedMove.data.path);
        if (applied.kind === 'game-over') {
          // Nedosažitelné: konec odchycen výše. Backstop pro typovou úplnost.
          send({ type: 'error', message: 'Partie je u konce.' });
          return;
        }
        if (applied.kind === 'illegal') {
          // Stav se nemění; klientova deska je dál správná (žádný push netřeba).
          send({ type: 'error', message: 'Nelegální tah.' });
          return;
        }
        if (applied.kind === 'vanished') {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        broadcast(applied.record);
      };

      // Konec/nabídka remízy v PvP (fáze 77). Stejná autorita jako u tahu: identita
      // hráče je `me.id` (přiřazená serverem při joinu), NE z klientovy zprávy. Guard
      // proti engine partii je NUTNÝ PŘED voláním store: PvP metody store na engine
      // partii hlasitě throwují (obranná assertion proti programové chybě), a ten throw
      // by tudy shodil handler zprávy – proto sem PvP metodu nepustíme jinak než s
      // ověřenou PvP partií. Vrací záznam k dalšímu zpracování, nebo `null` (chybu už
      // poslal příchozímu a socket žije dál).
      const requirePvpGame = (gameId: unknown): PvpGameRecord | null => {
        if (typeof gameId !== 'string') {
          send({ type: 'error', message: 'Chybí id partie.' });
          return null;
        }
        const record = store.get(gameId);
        if (record === undefined) {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return null;
        }
        if (record.mode !== 'pvp') {
          send({ type: 'error', message: 'Tato partie se v místnosti nehraje.' });
          return null;
        }
        return record;
      };

      /**
       * Session id SOUPEŘE v PvP partii vůči `me`. `me` je zaručeně účastník (store
       * ho tak ověřil, než vrátil záznam), takže je vždy jednou z barev a soupeř je
       * ta druhá. Slouží k adresné signalizaci nabídky/odmítnutí po room WS.
       */
      const opponentIn = (record: PvpGameRecord, myId: string): string =>
        record.players.black === myId ? record.players.white : record.players.black;

      // Vzdání PvP partie: vyhrává SOUPEŘ (barvu dopočte store z `players`). Na úspěch
      // se terminální stav rozešle OBĚMA přes game hub (`game-state`), stejnou cestou
      // jako tah – klient tím pozná konec partie. Signalizace po room WS tu není třeba.
      const handleResign = (gameId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        const game = requirePvpGame(gameId);
        if (game === null) {
          return;
        }
        const outcome = store.resignPvp(game.id, me.id);
        if (outcome === 'not-found') {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        if (outcome === 'not-participant') {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        if (outcome === 'already-over') {
          send({ type: 'error', message: 'Partie je u konce.' });
          return;
        }
        broadcast(outcome);
      };

      // Nabídka remízy: stav partie se NEMĚNÍ (pozice běží dál), jen se soupeři pošle
      // signál `draw-offered` po room WS. Nabízející čeká na odpověď (accept → konec,
      // reject → nic). Dvojí nabídka / cizí partie → `error` jen příchozímu.
      const handleDrawOffer = (gameId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        const game = requirePvpGame(gameId);
        if (game === null) {
          return;
        }
        const outcome = store.offerDrawPvp(game.id, me.id);
        if (outcome === 'not-found') {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        if (outcome === 'not-participant') {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        if (outcome === 'already-over') {
          send({ type: 'error', message: 'Partie je u konce.' });
          return;
        }
        if (outcome === 'offer-exists') {
          send({ type: 'error', message: 'Remíza už je nabídnutá.' });
          return;
        }
        presence.sendTo(
          opponentIn(outcome, me.id),
          JSON.stringify({ type: 'draw-offered', gameId: outcome.id }),
        );
      };

      // Přijetí nabídky remízy: partie končí `draw`. Terminální stav se rozešle OBĚMA
      // přes game hub (stejně jako vzdání). Bez visící nabídky / vlastní nabídka →
      // `no-offer` → `error` příchozímu.
      const handleDrawAccept = (gameId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        const game = requirePvpGame(gameId);
        if (game === null) {
          return;
        }
        const outcome = store.acceptDrawPvp(game.id, me.id);
        if (outcome === 'not-found') {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        if (outcome === 'not-participant') {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        if (outcome === 'already-over') {
          send({ type: 'error', message: 'Partie je u konce.' });
          return;
        }
        if (outcome === 'no-offer') {
          send({ type: 'error', message: 'Není co přijmout: remíza není nabídnutá.' });
          return;
        }
        broadcast(outcome);
      };

      // Odmítnutí nabídky remízy: stav partie se NEMĚNÍ, nabídka se zruší a
      // NABÍZEJÍCÍMU se pošle `draw-rejected` po room WS. Nabízející = soupeř (odmítnout
      // smí jen protistrana, cizí/vlastní nabídku store nepustí přes `no-offer`).
      const handleDrawReject = (gameId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        const game = requirePvpGame(gameId);
        if (game === null) {
          return;
        }
        const outcome = store.rejectDrawPvp(game.id, me.id);
        if (outcome === 'not-found') {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        if (outcome === 'not-participant') {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        if (outcome === 'already-over') {
          send({ type: 'error', message: 'Partie je u konce.' });
          return;
        }
        if (outcome === 'no-offer') {
          send({ type: 'error', message: 'Není co odmítnout: remíza není nabídnutá.' });
          return;
        }
        presence.sendTo(
          opponentIn(outcome, me.id),
          JSON.stringify({ type: 'draw-rejected', gameId: outcome.id }),
        );
      };

      // Opuštění DOHRANÉ partie (fáze 77, „Konec"/„Odveta" ve výsledkovém modalu):
      // uvolní OBA hráče z busy stavu, ať můžou hrát s někým jiným (nebo spolu odvetu).
      // Autorita: smí jen ÚČASTNÍK a jen když je partie TERMINÁLNÍ – uvolnit busy u
      // běžící partie by umožnilo dvojité spárování (třetí hráč vyzve někoho, kdo
      // pořád hraje). Bez efektu na stav partie ani na čekající výzvy (odveta = čerstvá
      // výzva, kterou nechceme shodit). Klient si sám přejde do místnosti; sem se nic
      // neposílá (kromě chyby při zádrhelu).
      const handleLeaveGame = (gameId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        const game = requirePvpGame(gameId);
        if (game === null) {
          return;
        }
        const myColor: Color | null =
          game.players.black === me.id
            ? 'black'
            : game.players.white === me.id
              ? 'white'
              : null;
        if (myColor === null) {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        if (effectiveResult(game) === 'ongoing') {
          send({ type: 'error', message: 'Partie ještě běží.' });
          return;
        }
        // Uvolni OBA – ale nejvýš JEDNOU na partii (atomický markPvpLeft). Druhé
        // `leave-game` na tutéž partii (druhý hráč klikne taky, nebo podvržený
        // duplikát) je no-op: bez téhle pojistky by mohlo uvolnit hráče, který se
        // mezitím spároval do NOVÉ partie → dvojité spárování.
        if (store.markPvpLeft(game.id)) {
          challenges.release(game.players.black);
          challenges.release(game.players.white);
          // „Konec" ukončuje partii pro OBA: dej soupeři vědět, ať se taky přesune do
          // místnosti (jinak visí na výsledku / dotazu odvety a neví, co se děje).
          presence.sendTo(
            opponentIn(game, me.id),
            JSON.stringify({ type: 'game-closed', gameId: game.id }),
          );
        }
      };

      // Nabídka ODVETY po dohrané partii (fáze 77). Analogie nabídky remízy, ale platí
      // až po konci. Stav se nemění; soupeři se pošle `rematch-offered` po room WS,
      // nabízející čeká. Přijetí založí novou partii (viz níže), odmítnutí přijde jako
      // `rematch-declined`.
      const handleRematchOffer = (gameId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        const game = requirePvpGame(gameId);
        if (game === null) {
          return;
        }
        const outcome = store.offerRematchPvp(game.id, me.id);
        if (outcome === 'not-found') {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        if (outcome === 'not-participant') {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        if (outcome === 'not-over') {
          send({ type: 'error', message: 'Partie ještě běží.' });
          return;
        }
        if (outcome === 'gone') {
          send({ type: 'error', message: 'Odveta už není možná (partie skončila).' });
          return;
        }
        if (outcome === 'offer-exists') {
          send({ type: 'error', message: 'Odveta už je nabídnutá.' });
          return;
        }
        presence.sendTo(
          opponentIn(outcome, me.id),
          JSON.stringify({ type: 'rematch-offered', gameId: outcome.id }),
        );
      };

      // Přijetí odvety (fáze 77). Server je autorita nad NOVOU partií: založí ji s
      // PROHOZENÝMI barvami (kdo byl černý, je teď bílý), STAROU zapečetí proti
      // `leave-game` (markPvpLeft – ať nikdo neuvolní busy hráčů, co jsou už v nové
      // partii), a OBA přesune do nové hry stávající zprávou `challenge-accepted`.
      // Busy oba drží dál z původního spárování → nová partie je nemusí znovu zamykat.
      const handleRematchAccept = (gameId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        const game = requirePvpGame(gameId);
        if (game === null) {
          return;
        }
        const outcome = store.acceptRematchPvp(game.id, me.id);
        if (outcome === 'not-found') {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        if (outcome === 'not-participant') {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        if (outcome === 'not-over') {
          send({ type: 'error', message: 'Partie ještě běží.' });
          return;
        }
        if (outcome === 'gone') {
          send({ type: 'error', message: 'Odveta už není možná (soupeř odešel).' });
          return;
        }
        if (outcome === 'no-offer') {
          send({ type: 'error', message: 'Není co přijmout: odveta není nabídnutá.' });
          return;
        }
        // Prohoď barvy: nová černá = původní bílý, nová bílá = původní černý.
        const oldBlack = outcome.players.black;
        const oldWhite = outcome.players.white;
        const fresh = store.createPvp(oldWhite, oldBlack);
        // Zapečeť starou partii: budoucí leave-game(stará) už neuvolní busy (oba jsou
        // teď v `fresh`). Bez toho by podvržený leave-game na starou partii uvolnil
        // hráče z běžící nové → dvojité spárování.
        store.markPvpLeft(outcome.id);
        presence.sendTo(
          oldWhite,
          JSON.stringify({
            type: 'challenge-accepted',
            gameId: fresh.id,
            color: 'black',
            opponentId: oldBlack,
          }),
        );
        presence.sendTo(
          oldBlack,
          JSON.stringify({
            type: 'challenge-accepted',
            gameId: fresh.id,
            color: 'white',
            opponentId: oldWhite,
          }),
        );
      };

      // Odmítnutí odvety (fáze 77). Nabídka se zruší, nabízejícímu se pošle
      // `rematch-declined` po room WS (vrátí se na výsledek s hláškou).
      const handleRematchDecline = (gameId: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        const game = requirePvpGame(gameId);
        if (game === null) {
          return;
        }
        const outcome = store.declineRematchPvp(game.id, me.id);
        if (outcome === 'not-found') {
          send({ type: 'error', message: 'Partie neexistuje.' });
          return;
        }
        if (outcome === 'not-participant') {
          send({ type: 'error', message: 'Nejsi hráčem této partie.' });
          return;
        }
        if (outcome === 'not-over') {
          send({ type: 'error', message: 'Partie ještě běží.' });
          return;
        }
        if (outcome === 'gone') {
          send({ type: 'error', message: 'Odveta už není možná (partie skončila).' });
          return;
        }
        if (outcome === 'no-offer') {
          send({ type: 'error', message: 'Není co odmítnout: odveta není nabídnutá.' });
          return;
        }
        presence.sendTo(
          opponentIn(outcome, me.id),
          JSON.stringify({ type: 'rematch-declined', gameId: outcome.id }),
        );
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
        // Primitiva a pole tady taky nechceme (zprávy jsou objekty), odmítni čistě.
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          send({ type: 'error', message: 'Neplatná zpráva (očekávám objekt).' });
          return;
        }
        const msg = parsed as {
          type?: unknown;
          nick?: unknown;
          targetId?: unknown;
          challengeId?: unknown;
          gameId?: unknown;
          from?: unknown;
          path?: unknown;
        };
        switch (msg.type) {
          case 'join':
            handleJoin(msg.nick);
            return;
          case 'challenge':
            handleChallenge(msg.targetId);
            return;
          case 'accept':
            handleAccept(msg.challengeId);
            return;
          case 'reject':
            handleReject(msg.challengeId);
            return;
          case 'move':
            handleMove(msg.gameId, msg.from, msg.path);
            return;
          case 'resign':
            handleResign(msg.gameId);
            return;
          case 'draw-offer':
            handleDrawOffer(msg.gameId);
            return;
          case 'draw-accept':
            handleDrawAccept(msg.gameId);
            return;
          case 'draw-reject':
            handleDrawReject(msg.gameId);
            return;
          case 'leave-game':
            handleLeaveGame(msg.gameId);
            return;
          case 'rematch-offer':
            handleRematchOffer(msg.gameId);
            return;
          case 'rematch-accept':
            handleRematchAccept(msg.gameId);
            return;
          case 'rematch-decline':
            handleRematchDecline(msg.gameId);
            return;
          default:
            send({ type: 'error', message: 'Neznámý typ zprávy.' });
            return;
        }
      });

      socket.on('close', () => {
        if (me === null) {
          return; // nikdy nevstoupil → nic neodhlašuj ani nerozesílej
        }
        const id = me.id;
        presence.remove(id);
        // `left` všem zbylým – hráč už je odebraný, except není třeba.
        presence.broadcast(JSON.stringify({ type: 'left', player: { id } }));
        // Odchod ruší jeho čekající výzvy (vyzyvatele i vyzvaného) a jeho busy stav.
        // Každý protějšek zaniklé výzvy dostane `challenge-cancelled` (fire-and-forget;
        // sendTo hlídá otevřenost socketu). Bez toho by protějšek čekal na mrtvou výzvu.
        const cancelled = challenges.removePlayer(id);
        for (const c of cancelled) {
          const counterpart = c.challengerId === id ? c.challengedId : c.challengerId;
          presence.sendTo(
            counterpart,
            JSON.stringify({ type: 'challenge-cancelled', challengeId: c.id }),
          );
        }
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
    // Čtení stavu funguje pro OBA režimy (fáze 70): `dtoFor` PvP serializuje bez
    // engine polí. Zápisové/engine-závislé cesty (moves REST, resign, draw, hint)
    // PvP dál odmítají – PvP se hraje výhradně přes room WS (todo 36) a končí až
    // s todo 40.
    return reply.send(dtoFor(record));
  });

  // Vzdání partie: člověk se vzdává → vyhrává engine (druhá barva). Barvu výhry
  // určí store podle uložené `humanColor` (nikoli natvrdo bílý). Vynucený
  // výsledek žije MIMO pravidla (pozice zůstává rozehraná), proto ho drží store.
  // Bez kontroly, kdo je na tahu – vzdát lze kdykoli za běhu, i když engine
  // zrovna přemýšlí (jeho běžící job po probuzení uvidí terminál a nezahraje).
  app.post<{ Params: { id: string } }>('/games/:id/resign', async (req, reply) => {
    // PvP partii odmítni PŘED store.resign (ten na PvP hlasitě throwuje). Vzdání
    // druhému člověku je todo 40, tady jen bezpečné odmítnutí (ne 500).
    const existing = store.get(req.params.id);
    if (existing?.mode === 'pvp') {
      return rejectPvp(reply, req.params.id);
    }
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
    if (record.mode === 'pvp') {
      return rejectPvp(reply, req.params.id); // PvP remíza druhému člověku = todo 40
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
    if (record.mode === 'pvp') {
      return rejectPvp(reply, req.params.id); // nápověda enginem v PvP nedává smysl
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
    if (record.mode === 'pvp') {
      // Hraní PvP partie (routování + autorita tahu podle hráče na tahu) je todo 36.
      // Tady jen bezpečné odmítnutí, ať PvP tah neprojde nezabezpečenou engine cestou.
      return rejectPvp(reply, req.params.id);
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

    // Tah do už skončené partie → 409 game_over. Kontroluje se PŘED autoritou
    // barvy i hledáním legálního tahu: remíza opakováním / 80 půltahů může mít
    // legální tahy, ale partie je u konce. Přes efektivní výsledek → chytí i
    // vzdanou. Pořadí (konec před autoritou) je záměrné – nechává game_over vyhrát
    // i v pozici, kde je nominálně na tahu engine.
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

    // Sdílené jádro: legalita + applyMove (autorita „čí je tah" už proběhla výše).
    const applied = tryApplyMove(record, parsed.data.from, parsed.data.path);
    if (applied.kind === 'illegal') {
      return sendError(reply, 409, ERROR_CODES.illegalMove, 'Nelegální tah', {
        legalMoves: applied.legalMoves,
      });
    }
    if (applied.kind === 'game-over') {
      // Nedosažitelné: konec je odchycen výše. Backstop pro typovou úplnost.
      return sendError(reply, 409, ERROR_CODES.gameOver, 'Partie je u konce');
    }
    if (applied.kind === 'vanished') {
      // Partie zmizela mezi get a applyMove – v jednom procesu se nestane.
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    const next = applied.record;

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
    if (record.mode === 'pvp') {
      // PvP partie nemá engine stranu → žádný tah enginu. Obranný no-op: dnes se
      // sem PvP záznam nedostane (POST /games zakládá jen engine partie), ale
      // guard drží invariant, kdyby budoucí cesta zavolala trigger na PvP.
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
      if (record.mode === 'pvp') {
        // Nedosažitelné: runEngineMove běží jen po maybeTriggerEngine, který PvP
        // odmítne. Guard zúží typ (dále se čte record.level) a drží invariant.
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

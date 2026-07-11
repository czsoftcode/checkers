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
import type { Color } from '@checkers/rules';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findLegalMove, gameToDto, legalMoveDtos, moveToDto, pvpGameToDto } from './dto.js';
import type { AnyGameDto, GameStateMessage, MoveDto } from './dto.js';
import { GameHub } from './hub.js';
import { RoomPresence } from './presence.js';
import type { RoomServerMessage } from './presence.js';
import { ChallengeRegistry } from './challenges.js';
import { ERROR_CODES, sendError } from './errors.js';
import { GameStore, effectiveResult, endReason } from './store.js';
import type { GameRecord, PvpGameRecord } from './store.js';

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

export interface BuildAppOptions {
  /**
   * Adresář pro archivní PDN dokončených partií. PDN modul (`archive.ts`) po
   * odstranění serverové AI (fáze 90) dočasně nemá volajícího – parametr se drží
   * pro budoucí napojení PDN archivu na PvP (samostatná backlog položka). Dnes
   * ho `buildApp` nečte; `main.ts` ho i tak předává, ať se signatura nemění.
   */
  readonly pdnDir?: string;
  /**
   * Zdroj náhody pro los třítahového zahájení (úroveň Mistrovství). Předá se
   * store. Když chybí, store použije `Math.random`; test injektuje seedovaný
   * PRNG (`mulberry32`), aby byl los deterministický a měl zuby.
   */
  readonly rng?: () => number;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new GameStore(options.rng);

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
      // i pro PvP (vzdání/remíza fáze 77 nastaví `forcedResult`). `endReason` k němu
      // přidá DŮVOD konce (vzdání / dohoda / pravidla / běží), ať výherce u výsledku
      // vidí, PROČ hra skončila (fáze 78) – oba se počítají z téhož záznamu, drží spolu.
      return pvpGameToDto(record.id, record.state, effectiveResult(record), endReason(record));
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
   * Jádro aplikace tahu (fáze 70): konec partie → legalita proti `rules` →
   * `applyMove`. Po odstranění serverové AI (fáze 90) má jediného volajícího –
   * PvP tah po room WS (`handleMove`); zůstává vydělené, ať se autorita „čí je
   * tah" (členství + pořadí, řeší volající) nemíchá s legalitou. Nepushuje – na
   * `ok` broadcastuje volající sám. Vrací výsledek, ne HTTP/WS odpověď.
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

  app.get<{ Params: { id: string } }>('/games/:id', (req, reply) => {
    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    // Jediný REST endpoint partie, který zůstal po odstranění serverové AI
    // (fáze 90): čtení stavu funguje pro OBA režimy, `dtoFor` PvP serializuje bez
    // engine polí. Zápis PvP (tah/vzdání/remíza) i její snapshot+push jdou přes
    // room WS a `/games/:id/ws`; serverová AI (tah, vzdání, nabídka remízy,
    // nápověda) se přesunula do prohlížeče a její REST endpointy tu už nejsou.
    return reply.send(dtoFor(record));
  });

  return app;
}

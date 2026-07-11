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
import { isVariantId, rulesetForVariant } from '@checkers/rules';
import type { Color, VariantId } from '@checkers/rules';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findLegalMove, legalMoveDtos, pvpGameToDto } from './dto.js';
import type { GameStateMessage, MoveDto, PvpGameDto } from './dto.js';
import { formatGamePdn, writeGamePdn } from './archive.js';
import { GameHub } from './hub.js';
import { Lobbies } from './presence.js';
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
   * Adresář pro archivní PDN dokončených PvP partií (fáze 92). Když je nastaven,
   * server po KAŽDÉM terminálním konci partie (vzdání / dohodnutá remíza /
   * přirozený konec dle pravidel) zapíše anonymní PDN celé partie právě jednou.
   * Když není nastaven, archiv se vypne (nic se nepíše) – např. v testech, které
   * archivaci netestují. Zápis je jednosměrný a best-effort (viz `archive.ts`).
   */
  readonly pdnDir?: string;
  /**
   * Zdroj aktuálního času pro tagy `[UTCDate]`/`[UTCTime]` archivního PDN.
   * Injektovatelný kvůli determinismu testů; v produkci `() => new Date()`.
   */
  readonly now?: () => Date;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new GameStore();
  const pdnDir = options.pdnDir;
  const now = options.now ?? ((): Date => new Date());

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

  /**
   * PvP DTO ze záznamu: `result` je EFEKTIVNÍ výsledek (vzdání/remíza > pozice).
   * Po odstranění serverové AI (fáze 90/91) je každá partie PvP – engine větev
   * zanikla. `effectiveResult` platí i pro PvP (vzdání/remíza fáze 77 nastaví
   * `forcedResult`); `endReason` k němu přidá DŮVOD konce (vzdání / dohoda /
   * pravidla / běží), ať výherce u výsledku vidí, PROČ hra skončila (fáze 78) –
   * oba se počítají z téhož záznamu, drží spolu.
   */
  function dtoFor(record: GameRecord): PvpGameDto {
    return pvpGameToDto(record.id, record.state, effectiveResult(record), endReason(record));
  }

  // Registr WS odběratelů partií (fáze 66). Push je aditivní: web klient dnes
  // stav dál polluje, hub jen navíc rozešle nový stav odběratelům dané partie.
  const hub = new GameHub();
  // Diagnostický přístup k hubu (počet odběratelů) – využívá ho integrační test
  // k deterministickému čekání na registraci odběru (bez arbitrárního sleepu),
  // do budoucna i případné metriky. Není to veřejný HTTP kontrakt.
  app.decorate('gameHub', hub);

  // Registr ČTYŘ varianta-lobby + globální identita (fáze 103, dřív jedna místnost
  // fáze 67). Dekorace `lobbies` zpřístupní registr novým testům; `roomPresence`
  // ukazuje na AMERICKOU lobby (default), aby dosavadní testy sahající na
  // `app.roomPresence.count()` zůstaly beze změny (bez varianty → americká lobby).
  // Není to veřejný HTTP kontrakt.
  const lobbies = new Lobbies();
  app.decorate('lobbies', lobbies);
  app.decorate('roomPresence', lobbies.room('american'));

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
   * chyb se stará hub). Bez odběratelů je to no-op. Kontrakt drátu = `PvpGameDto`
   * v obálce `{ type: 'game-state', game }`, stejný tvar jako REST.
   */
  function broadcast(record: GameRecord): void {
    const message: GameStateMessage = { type: 'game-state', game: dtoFor(record) };
    hub.broadcast(record.id, JSON.stringify(message));
    maybeArchive(record);
  }

  /**
   * Napojení PDN archivu na PvP (fáze 92). `broadcast` je společný choke point
   * VŠECH tří terminálních konců (vzdání, dohodnutá remíza, přirozený konec dle
   * pravidel po tahu), takže archivace odsud pokryje všechny jednou.
   *
   * Guard `store.markArchived(id)` je atomický check-and-set (Node je
   * jednovláknový, mezi čtením a zápisem `archived` není `await`): terminální
   * záznam projde právě jednou, i kdyby `broadcast` přišel na tutéž partii
   * vícekrát. Rozehraná (`ongoing`) partie i běh bez `pdnDir` se přeskočí.
   *
   * Zápis je fire-and-forget a `writeGamePdn` NIKDY nevyhazuje – selhání zápisu
   * neshodí konec partie ani WS (best-effort archiv). Trade-off: partie se
   * označí za archivovanou PŘED dokončením zápisu, takže selhaný zápis se už
   * neopakuje (přijaté „nejvýš jednou", ne „garantovaně jednou na disku").
   *
   * Pozor na rozsah záruky „neshodí": platí pro I/O část (`writeGamePdn`).
   * Synchronní příprava (`formatGamePdn`) je záměrně NEobalená – jediná její
   * throw cesta (`result === 'ongoing'`) je odstíněná guardem výš, cokoli dalšího
   * by byla programová korupce dat, která MÁ padnout hlasitě, ne se maskovat.
   */
  function maybeArchive(record: GameRecord): void {
    if (pdnDir === undefined) {
      return;
    }
    const result = effectiveResult(record);
    if (result === 'ongoing') {
      return;
    }
    if (!store.markArchived(record.id)) {
      return; // už archivováno (nebo partie mezitím zmizela) – žádný druhý zápis
    }
    const pdn = formatGamePdn(record.moves, result, now(), record.state.variant);
    void writeGamePdn(pdnDir, record.id, pdn);
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
    // BEZPEČNOSTNÍ HRANICE (todo 56): legalita se ověřuje pravidly VARIANTY záznamu,
    // ne americkými. Bez toho by server přijal nelegální tah v ruské/české/pool partii
    // (klient je nedůvěryhodný). `advanceState` ve store čte tutéž variantu ze stavu.
    const ruleset = rulesetForVariant(record.state.variant);
    const move = findLegalMove(record.state.position, from, path, ruleset);
    if (move === undefined) {
      return { kind: 'illegal', legalMoves: legalMoveDtos(record.state.position, ruleset) };
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
      // `variant` = lobby, ve které hráč je (fáze 103) – rozhoduje o rosteru,
      // broadcastu a scope výzev; drží se tu, ať se při `close` ví, kam poslat `left`.
      let me: { id: string; nick: string; variant: VariantId } | null = null;

      const send = (message: RoomServerMessage): void => {
        try {
          socket.send(JSON.stringify(message));
        } catch (error) {
          console.error('Místnost: odeslání příchozímu selhalo:', error);
        }
      };

      // Vstup pod přezdívkou do zvolené varianta-lobby (fáze 103). `variant` je
      // volitelná: chybí / není platné `VariantId` → americká lobby (zpětná
      // kompatibilita se stávajícím klientem, který variantu neposílá). Set `me` =
      // zapsaný hráč (vč. nicku a lobby).
      const handleJoin = (nick: unknown, variant: unknown): void => {
        if (typeof nick !== 'string') {
          send({ type: 'error', message: 'Chybí přezdívka.' });
          return;
        }
        if (me !== null) {
          send({ type: 'error', message: 'Už jsi v místnosti.' });
          return;
        }
        // Neznámá/chybějící varianta → american (default). Neplatný cizí string
        // se NEodmítá, jen degraduje na american – stávající klient bez varianty
        // tak hraje beze změny a nový klient dostane echo skutečné lobby v `roster`.
        const lobby: VariantId = isVariantId(variant) ? variant : 'american';
        const result = lobbies.join(nick, lobby, socket);
        if (result.status === 'invalid') {
          send({ type: 'error', message: result.reason });
          return;
        }
        if (result.status === 'nick-taken') {
          send({ type: 'nick-taken', suggestion: result.suggestion });
          return;
        }
        // Úspěch. Pořadí: hráč už je v rosteru své lobby (join ho zapsal) → pošli
        // `roster` JEN jemu (vč. sebe a echo varianty lobby), teprve pak `joined`
        // OSTATNÍM V TÉŽE lobby (except = já), ať nedostane vlastní příchod dvakrát.
        me = { id: result.player.id, nick: result.player.nick, variant: lobby };
        send({ type: 'roster', players: lobbies.room(lobby).roster(), variant: lobby });
        lobbies
          .room(lobby)
          .broadcast(JSON.stringify({ type: 'joined', player: result.player }), result.player.id);
      };

      // Přechod do jiné varianta-lobby BEZ ztráty identity (fáze 103). Server op –
      // klientské UI ho zavolá v D3b. Odmítnut, když hráč PRÁVĚ HRAJE (busy): jako
      // se nemění varianta uprostřed partie, nesmí se přejít do jiné lobby v běžící
      // hře. Úspěch: stará lobby dostane `left`, nová `joined`, přecházející čerstvý
      // `roster` cílové lobby (echo varianty). `same` = už tam je (jen echo rosteru).
      const handleSwitchLobby = (variant: unknown): void => {
        if (me === null) {
          send({ type: 'error', message: 'Nejdřív vstup do místnosti.' });
          return;
        }
        if (!isVariantId(variant)) {
          send({ type: 'error', message: 'Neznámá varianta lobby.' });
          return;
        }
        if (challenges.isBusy(me.id)) {
          send({ type: 'error', message: 'Nelze přejít do jiné lobby během partie.' });
          return;
        }
        const from = me.variant;
        const result = lobbies.switchLobby(me.id, variant);
        if (result.status === 'not-joined') {
          // Nedosažitelné: `me !== null` znamená přihlášený. Backstop pro úplnost.
          send({ type: 'error', message: 'Nejsi přihlášen.' });
          return;
        }
        if (result.status === 'same') {
          // Už v cílové lobby – jen znovu pošli roster (echo), nic nepřesouvej.
          send({ type: 'roster', players: lobbies.room(variant).roster(), variant });
          return;
        }
        // Přechod ruší VŠECHNY jeho čekající výzvy (vyzyvatele i vyzvaného) – jinak
        // by výzva z PŮVODNÍ lobby přežila přechod a její pozdější přijetí by založilo
        // CROSS-VARIANT partii (hráč se mezitím přesunul jinam) a obešlo hranici „výzva
        // jen v téže lobby". Hráč není busy (guard výš), takže `removePlayer` jen
        // zahodí pending; protějšek každé zaniklé výzvy dostane `challenge-cancelled`
        // (jako při `close`), ať nevisí na mrtvé výzvě.
        const cancelled = challenges.removePlayer(me.id);
        for (const c of cancelled) {
          const counterpart = c.challengerId === me.id ? c.challengedId : c.challengerId;
          lobbies.sendTo(
            counterpart,
            JSON.stringify({ type: 'challenge-cancelled', challengeId: c.id }),
          );
        }
        me = { id: me.id, nick: me.nick, variant };
        // Stará lobby: hráč odešel. Nová lobby: přišel. Přecházejícímu roster cílové.
        lobbies.room(from).broadcast(JSON.stringify({ type: 'left', player: { id: me.id } }));
        send({ type: 'roster', players: lobbies.room(variant).roster(), variant });
        lobbies
          .room(variant)
          .broadcast(
            JSON.stringify({ type: 'joined', player: { id: me.id, nick: me.nick } }),
            me.id,
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
        // Vyzvat lze JEN hráče v TÉŽE lobby (fáze 103). Cross-variant výzva padne
        // přirozeně: cíl v jiné lobby → `has` je false → „není v místnosti".
        if (!lobbies.room(me.variant).has(targetId)) {
          send({ type: 'error', message: 'Vyzvaný hráč není v místnosti.' });
          return;
        }
        const result = challenges.create(me.id, targetId);
        if (result.status === 'rejected') {
          send({ type: 'error', message: result.reason });
          return;
        }
        lobbies.sendTo(
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
        // Partie nese variantu LOBBY, ve které se dvojice spárovala (fáze 103).
        // Přijímající (`me`) i vyzyvatel jsou v téže lobby (výzva jen v rámci lobby),
        // takže `me.variant` je varianta obou. Rematch pak variantu dědí (viz níž).
        const game = store.createPvp(challengerId, challengedId, me.variant);
        lobbies.sendTo(
          challengerId,
          JSON.stringify({
            type: 'challenge-accepted',
            gameId: game.id,
            color: 'black',
            opponentId: challengedId,
          }),
        );
        lobbies.sendTo(
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
          lobbies.sendTo(
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
        lobbies.sendTo(
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
      // hráče je `me.id` (přiřazená serverem při joinu), NE z klientovy zprávy. Ověří
      // existenci partie a vrátí záznam k dalšímu zpracování, nebo `null` (chybu už
      // poslal příchozímu a socket žije dál). Po odstranění serverové AI (fáze 90/91)
      // je každá partie PvP, takže stačí ověřit, že vůbec existuje.
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
        lobbies.sendTo(
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
        lobbies.sendTo(
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
          lobbies.sendTo(
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
        lobbies.sendTo(
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
        // Rematch DĚDÍ variantu staré partie – jinak by odveta v ruské/české lobby
        // tiše spadla do americké (default createPvp).
        const fresh = store.createPvp(oldWhite, oldBlack, outcome.state.variant);
        // Zapečeť starou partii: budoucí leave-game(stará) už neuvolní busy (oba jsou
        // teď v `fresh`). Bez toho by podvržený leave-game na starou partii uvolnil
        // hráče z běžící nové → dvojité spárování.
        store.markPvpLeft(outcome.id);
        lobbies.sendTo(
          oldWhite,
          JSON.stringify({
            type: 'challenge-accepted',
            gameId: fresh.id,
            color: 'black',
            opponentId: oldBlack,
          }),
        );
        lobbies.sendTo(
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
        lobbies.sendTo(
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
          variant?: unknown;
          targetId?: unknown;
          challengeId?: unknown;
          gameId?: unknown;
          from?: unknown;
          path?: unknown;
        };
        switch (msg.type) {
          case 'join':
            handleJoin(msg.nick, msg.variant);
            return;
          case 'switch-lobby':
            handleSwitchLobby(msg.variant);
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
        const lobby = me.variant;
        lobbies.remove(id);
        // `left` zbylým V JEHO lobby – hráč už je odebraný, except není třeba.
        lobbies.room(lobby).broadcast(JSON.stringify({ type: 'left', player: { id } }));
        // Odchod ruší jeho čekající výzvy (vyzyvatele i vyzvaného) a jeho busy stav.
        // Každý protějšek zaniklé výzvy dostane `challenge-cancelled` (fire-and-forget;
        // sendTo hlídá otevřenost socketu). Bez toho by protějšek čekal na mrtvou výzvu.
        const cancelled = challenges.removePlayer(id);
        for (const c of cancelled) {
          const counterpart = c.challengerId === id ? c.challengedId : c.challengerId;
          lobbies.sendTo(
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

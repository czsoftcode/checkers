/**
 * Autoritativní HTTP server partie (Fastify + zod). Server je JEDINÝ zdroj
 * pravdy: každý tah se ověřuje přes sdílenou `rules` (přes `findLegalMove`),
 * žádná pravidla se tu neduplikují.
 *
 * `buildApp()` vrací nakonfigurovanou instanci bez `listen` (testuje se přes
 * `app.inject()`); reálné naslouchání řeší `main.ts`.
 */

import Fastify from 'fastify';
import { z } from 'zod';
import { gameResultFromState } from '@checkers/rules';
import type { Color } from '@checkers/rules';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatGamePdn, writeGamePdn } from './archive.js';
import { findLegalMove, gameToDto, legalMoveDtos } from './dto.js';
import { ERROR_CODES, sendError } from './errors.js';
import { GameStore } from './store.js';
import type { GameRecord } from './store.js';
import type { EngineMover } from './engine-client.js';

/** Tělo POST /games/:id/moves: výchozí pole + cesta dopadů (čísla 1–32). */
const moveBodySchema = z.object({
  from: z.number().int().min(1).max(32),
  path: z.array(z.number().int().min(1).max(32)).min(1),
});

/** Barvu enginu držíme napevno: člověk je černý (začíná), engine bílý. */
const ENGINE_COLOR: Color = 'white';

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
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new GameStore();
  const engine = options.engine;
  const pdnDir = options.pdnDir;

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

  app.post('/games', (_req, reply) => {
    const { id, state, engineStatus } = store.create();
    return reply.code(201).send(gameToDto(id, state, engineStatus));
  });

  app.get<{ Params: { id: string } }>('/games/:id', (req, reply) => {
    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    return reply.send(gameToDto(record.id, record.state, record.engineStatus));
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
    // partie je u konce.
    if (gameResultFromState(record.state) !== 'ongoing') {
      return sendError(reply, 409, ERROR_CODES.gameOver, 'Partie je u konce');
    }

    // Autorita barvy: když je zapojený engine, člověk smí táhnout JEN svou
    // stranou (černou). Bez téhle kontroly by klient mohl zahrát legální BÍLÝ
    // tah, zatímco engine přemýšlí – a přepsat mu pozici pod rukama (autorita
    // serveru by se rozjela s tím, co engine počítá). `findLegalMove` sám tuhle
    // díru nezavře: pro stranu na tahu (bílou) legální tah najde a přijme.
    if (engine !== undefined && record.state.position.turn === ENGINE_COLOR) {
      return sendError(
        reply,
        409,
        ERROR_CODES.notYourTurn,
        'Na tahu je engine (bílý), počkej na jeho tah.',
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
    return reply.send(gameToDto(fresh.id, fresh.state, fresh.engineStatus));
  });

  /** Když je na tahu engine v běžící partii, označ `thinking` a spusť job. */
  function maybeTriggerEngine(record: GameRecord): void {
    if (engine === undefined) {
      return;
    }
    if (gameResultFromState(record.state) !== 'ongoing') {
      return;
    }
    if (record.state.position.turn !== ENGINE_COLOR) {
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
    const result = gameResultFromState(record.state);
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
        gameResultFromState(record.state) !== 'ongoing' ||
        record.state.position.turn !== ENGINE_COLOR
      ) {
        return; // stav se změnil / engine není na tahu – defenzivně nic nedělej
      }

      const move = await engine.bestmove(record.state.position);

      // Po awaitu se stav znovu načte a ověří: tah enginu se aplikuje VÝHRADNĚ
      // proti AKTUÁLNÍ pozici, ne proti snímku z doby před přemýšlením. Za
      // normálního běhu hlídá autorita barvy, že se pozice během `thinking`
      // nezmění; kdyby se přesto změnila, tah enginu se zahodí (ne aplikuje na
      // cizí pozici, kde by `advanceState` vyhodil RangeError).
      const current = store.get(id);
      if (current === undefined) {
        return;
      }
      if (
        gameResultFromState(current.state) !== 'ongoing' ||
        current.state.position.turn !== ENGINE_COLOR
      ) {
        store.setEngineStatus(id, 'idle');
        return;
      }

      const legal = findLegalMove(current.state.position, move.from, move.path);
      if (legal === undefined) {
        console.error(`Engine vrátil nelegální tah pro partii ${id}, odmítám.`);
        store.setEngineStatus(id, 'error');
        return;
      }

      const afterEngine = store.applyMove(id, legal);
      store.setEngineStatus(id, 'idle');

      // Tah enginu mohl partii ukončit (bílý vyhrál / remíza) – archivuj.
      // Uvnitř try schválně: kdyby zápis/sestavení házelo, spadne to do větve
      // `error` (engine status), partie nespadne. `writeGamePdn` I/O chybu
      // stejně jen loguje; házet by mohl jen bug v `formatGamePdn`.
      if (afterEngine !== undefined) {
        await maybeArchive(afterEngine);
      }
    } catch (error) {
      console.error(`Tah enginu selhal pro partii ${id}:`, error);
      store.setEngineStatus(id, 'error');
    }
  }

  return app;
}

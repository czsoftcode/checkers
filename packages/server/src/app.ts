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
import type { Color } from '@checkers/rules';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatGamePdn, writeGamePdn } from './archive.js';
import { findLegalMove, gameToDto, legalMoveDtos } from './dto.js';
import { ERROR_CODES, sendError } from './errors.js';
import { LEVELS, STRENGTH_BY_LEVEL } from './levels.js';
import { GameStore, effectiveResult } from './store.js';
import type { GameRecord } from './store.js';
import type { EngineMover } from './engine-client.js';

/** Tělo POST /games/:id/moves: výchozí pole + cesta dopadů (čísla 1–32). */
const moveBodySchema = z.object({
  from: z.number().int().min(1).max(32),
  path: z.array(z.number().int().min(1).max(32)).min(1),
});

/**
 * Tělo POST /games: volitelná úroveň obtížnosti. Chybí-li `level` (nebo přijde
 * prázdné tělo), platí výchozí Profesionál → zpětně kompatibilní se starým
 * klientem i testy, které tělo neposílají. Neznámá hodnota → chyba (400).
 */
const createGameBodySchema = z.object({
  level: z.enum(LEVELS).default('professional'),
});

/** Barvu enginu držíme napevno: člověk je černý (začíná), engine bílý. */
const ENGINE_COLOR: Color = 'white';

/**
 * Práh přijetí nabídky remízy: engine (bílý) remízu přijme, právě když skóre
 * pozice Z POHLEDU BÍLÉHO není kladné (≤ 0), tj. bílý pozici nehodnotí jako svou
 * výhru. Když vede, hraje dál a trestá – sedí s cílem kalibrace (silnému hráči
 * vzdorovat, ne vždy vyhrát). Číslo je vědomě laditelné; skutečné doladění chce
 * odehrané partie (poziční evaluace dává i v remízových pozicích nenulové skóre).
 */
export const DRAW_ACCEPT_MAX_WHITE_SCORE = 0;

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

  /** GameDto ze záznamu: `result` je EFEKTIVNÍ výsledek (vzdání > pozice). */
  function dtoFor(record: GameRecord): ReturnType<typeof gameToDto> {
    return gameToDto(
      record.id,
      record.state,
      record.engineStatus,
      effectiveResult(record),
      record.level,
    );
  }

  app.post('/games', (req, reply) => {
    // Prázdné/chybějící tělo → `{}` → zod doplní výchozí úroveň. Neznámá úroveň
    // je klientská chyba (400), ne tichý default.
    const parsed = createGameBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        ERROR_CODES.invalidRequest,
        `Neplatné tělo: očekávám { level: ${LEVELS.join(' | ')} }`,
      );
    }
    return reply.code(201).send(dtoFor(store.create(parsed.data.level)));
  });

  app.get<{ Params: { id: string } }>('/games/:id', (req, reply) => {
    const record = store.get(req.params.id);
    if (record === undefined) {
      return sendError(reply, 404, ERROR_CODES.gameNotFound, `Partie ${req.params.id} neexistuje`);
    }
    return reply.send(dtoFor(record));
  });

  // Vzdání partie: člověk (černý) se vzdává → vyhrává bílý (počítač). Vynucený
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
    // Partie je teď terminální (white-wins) → archivuj právě jednou (markArchived).
    await maybeArchive(outcome);
    return reply.send(dtoFor(outcome));
  });

  // Nabídka remízy: člověk (černý) nabídne remízu, engine (bílý) o ní rozhodne.
  // Rozhodnutí přichází VÝHRADNĚ z enginu (skóre pozice); práh přijetí drží
  // server (DRAW_ACCEPT_MAX_WHITE_SCORE). Synchronní: handler počká na engine a
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
    // Engine přemýšlí (na tahu je bílý) → nabídku teď nepřijímáme: engine by
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
    // na pohled bílého: na tahu bílý = beze změny, na tahu černý = obrácené
    // znaménko. Selhání enginu (timeout/pád/protokol) NENÍ „engine řekl ne":
    // nabídka spadne jako 503 a partie zůstane beze změny.
    let whiteScore: number;
    try {
      const { score } = await engine.evaluate(record.state.position);
      whiteScore = record.state.position.turn === ENGINE_COLOR ? score : -score;
    } catch (error) {
      console.error(`Engine selhal při vyhodnocení nabídky remízy pro partii ${req.params.id}:`, error);
      return sendError(
        reply,
        503,
        ERROR_CODES.engineUnavailable,
        'Počítač teď nedokáže o nabídce rozhodnout, zkus to prosím znovu.',
      );
    }

    const accepted = whiteScore <= DRAW_ACCEPT_MAX_WHITE_SCORE;
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
    return reply.send({ accepted: true, game: dtoFor(outcome) });
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
        record.state.position.turn !== ENGINE_COLOR
      ) {
        return; // stav se změnil / engine není na tahu – defenzivně nic nedělej
      }

      // Síla se řídí úrovní partie (fixní po dobu partie, čte se ZE ZÁZNAMU –
      // ne z klienta ani globálu, ať souběžné partie s různými úrovněmi hrají
      // každá svou silou). Profesionál → undefined → engine dostane dnešní
      // požadavek beze změny.
      const move = await engine.bestmove(record.state.position, STRENGTH_BY_LEVEL[record.level]);

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

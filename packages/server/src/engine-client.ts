/**
 * Orchestrace enginu: engine běží jako oddělený podproces za JSON Lines
 * protokolem, server s ním mluví přes tuhle třídu. Klient je JEDINÝ, kdo
 * proces vlastní – spouští ho, řadí požadavky do SÉRIOVÉ fronty (engine je
 * jednovláknový a během searche nečte stdin, takže víc požadavků naráz nedává
 * smysl), hlídá tvrdý časový strop a při zaseknutí/pádu ho zabije a jednou
 * zopakuje. Server je autorita: `move` z enginu se NIKDY neaplikuje bez
 * ověření přes `rules` (to dělá volající, ne tenhle klient).
 *
 * Kontrakt zpráv se NEopisuje – protokolové typy se importují z
 * `@checkers/engine` (jeden zdroj tvaru mezi procesy).
 *
 * Selhání, která klient rozlišuje:
 * - timeout (engine neodpoví v `timeMs + HARD_TIMEOUT_MARGIN_MS`) → SIGKILL,
 *   restart, 1 retry na `timeMs/2`,
 * - pád procesu (exit před odpovědí / spawn error) → restart, 1 retry,
 * - protokolová chyba (`error` odpověď enginu, neočekávaný typ) → BEZ retry
 *   (opakování by vrátilo tutéž chybu), vyhodí `EngineProtocolError`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { Move, Position } from '@checkers/rules';
import { PROTOCOL_VERSION } from '@checkers/engine';
import type {
  BestmoveRequest,
  EngineRequest,
  EngineResponse,
  EvaluateRequest,
  HelloRequest,
  HelloResponse,
  Strength,
} from '@checkers/engine';
import { LineBuffer } from '@checkers/engine';

// `Strength` (páky síly bestmove) žije v `@checkers/engine` (tvar polí protokolu,
// jeden zdroj pro server i @checkers/ai). Re-export drží veřejné API serveru
// beze změny – volající serveru ho dál importují z `@checkers/server`.
export type { Strength };

/** Rozdíl mezi měkkým limitem enginu a tvrdým stropem klienta (ms). */
export const HARD_TIMEOUT_MARGIN_MS = 500;

/** Výchozí čas na tah enginu (ms). Drží ho server, klient ho NEdostává zvenčí. */
export const DEFAULT_ENGINE_TIME_MS = 1000;

/** Časový strop na handshake `hello` – velký, ať absorbuje studený start tsx. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Příkaz pro spuštění enginu jako podprocesu. */
export interface SpawnCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Vyhodnocení pozice enginem: skóre z pohledu STRANY NA TAHU (jako search). */
export interface EngineEvaluation {
  readonly score: number;
}

/** Minimum, které server potřebuje od enginu (umožní stub v testech). */
export interface EngineMover {
  /**
   * Vrátí tah pro pozici. `strength` je volitelný: chybí → plná síla
   * (Profesionál), zpětně kompatibilní se staršími volajícími.
   */
  bestmove(position: Position, strength?: Strength): Promise<Move>;
  /**
   * Vyhodnotí pozici (skóre bez výběru tahu) pro rozhodnutí o nabídce remízy.
   * Skóre je z pohledu strany na tahu – přepočet na barvu je věc volajícího.
   */
  evaluate(position: Position): Promise<EngineEvaluation>;
}

export interface EngineClientOptions {
  /** Jak spustit engine. Injektovatelné kvůli testům (falešný engine). */
  readonly spawn?: SpawnCommand;
  /** Měkký limit na tah v ms (výchozí DEFAULT_ENGINE_TIME_MS). */
  readonly timeMs?: number;
  /** Cesta k pidfile pro úklid osiřelých procesů; `null` = vypnuto. */
  readonly pidFile?: string | null;
  /** Kam logovat (stderr enginu, chyby orchestrace). Výchozí console.error. */
  readonly log?: (message: string) => void;
}

/** Timeout: engine neodpověděl v tvrdém stropu → proces se zabíjí. */
export class EngineTimeoutError extends Error {
  constructor(id: string, timeoutMs: number) {
    super(`Engine neodpověděl na "${id}" do ${String(timeoutMs)} ms.`);
    this.name = 'EngineTimeoutError';
  }
}

/** Proces enginu zemřel dřív, než odpověděl (pád, kill, spawn error). */
export class EngineCrashError extends Error {
  constructor(detail: string) {
    super(`Proces enginu skončil bez odpovědi: ${detail}`);
    this.name = 'EngineCrashError';
  }
}

/** Engine odpověděl chybou nebo neočekávaným tvarem – NEopakuje se. */
export class EngineProtocolError extends Error {
  constructor(code: string, detail: string) {
    super(`Protokolová chyba enginu (${code}): ${detail}`);
    this.name = 'EngineProtocolError';
  }
}

/** Klient byl mezitím zavřen (`close()`). */
export class EngineClosedError extends Error {
  constructor() {
    super('EngineClient byl zavřen.');
    this.name = 'EngineClosedError';
  }
}

interface Waiter {
  readonly resolve: (response: EngineResponse) => void;
  readonly reject: (error: Error) => void;
}

interface EngineProcess {
  readonly child: ChildProcess;
  readonly buffer: LineBuffer;
  dead: boolean;
}

/** Sestaví výchozí příkaz na spuštění reálného TS enginu přes tsx. */
export function defaultEngineCommand(): SpawnCommand {
  // "." export @checkers/engine míří na src/index.ts; main.ts je vedle něj.
  const indexPath = fileURLToPath(import.meta.resolve('@checkers/engine'));
  const srcDir = dirname(indexPath);
  const mainPath = join(srcDir, 'main.ts');
  // cwd = adresář enginu, aby `node --import tsx` našel tsx (devdep balíčku).
  return { command: process.execPath, args: ['--import', 'tsx', mainPath], cwd: srcDir };
}

/** Výchozí umístění pidfile (procesní hygiena, ne perzistence partií). */
function defaultPidFile(): string {
  return join(tmpdir(), 'checkers-engine.pid');
}

export class EngineClient implements EngineMover {
  private readonly spawnCmd: SpawnCommand;
  private readonly timeMs: number;
  private readonly pidFile: string | null;
  private readonly log: (message: string) => void;

  private proc: EngineProcess | null = null;
  private readonly pending = new Map<string, Waiter>();
  private seq = 0;
  private closed = false;
  /** Konec fronty: sériově řetězí joby, sám nikdy nerejectuje (nezasekne se). */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: EngineClientOptions = {}) {
    this.spawnCmd = options.spawn ?? defaultEngineCommand();
    this.timeMs = options.timeMs ?? DEFAULT_ENGINE_TIME_MS;
    this.pidFile = options.pidFile === undefined ? defaultPidFile() : options.pidFile;
    this.log = options.log ?? ((message): void => console.error(message));

    // Úklid osiřelého enginu z minulého (spadlého) běhu HNED při vzniku klienta,
    // ještě než spustíme vlastní proces.
    this.cleanupStaleProcess();
  }

  /** PID aktuálního procesu enginu, nebo null. Jen pro testy/diagnostiku. */
  currentPid(): number | null {
    return this.proc && !this.proc.dead ? (this.proc.child.pid ?? null) : null;
  }

  /** Handshake: ověří, že na druhé straně žije engine se správným protokolem. */
  async warmup(): Promise<HelloResponse> {
    return this.enqueue(async () => {
      const request: HelloRequest = { type: 'hello', id: this.nextId() };
      const response = await this.request(request, HANDSHAKE_TIMEOUT_MS);
      if (response.type !== 'hello') {
        throw new EngineProtocolError('unexpected', `Na hello přišlo "${response.type}".`);
      }
      if (response.protocol !== PROTOCOL_VERSION) {
        throw new EngineProtocolError(
          'protocol_mismatch',
          `Engine hlásí protokol ${String(response.protocol)}, čekám ${String(PROTOCOL_VERSION)}.`,
        );
      }
      return response;
    });
  }

  /**
   * Vrátí tah enginu pro danou pozici. Řadí se do sériové fronty. Při
   * timeoutu/pádu jednou zopakuje na polovičním čase; protokolovou chybu
   * neopakuje. Vrácený `move` je NEOVĚŘENÝ – legalitu určuje volající přes rules.
   */
  async bestmove(position: Position, strength?: Strength): Promise<Move> {
    return this.enqueue(async () => {
      try {
        return await this.requestBestmove(position, this.timeMs, strength);
      } catch (error) {
        if (error instanceof EngineProtocolError || error instanceof EngineClosedError) {
          throw error; // protokolová chyba / zavřený klient se neopakuje
        }
        const half = Math.max(1, Math.floor(this.timeMs / 2));
        this.log(`Engine selhal (${describeError(error)}), zkouším znovu na ${String(half)} ms.`);
        return await this.requestBestmove(position, half, strength);
      }
    });
  }

  /**
   * Vrátí skóre pozice z pohledu strany na tahu. Řadí se do stejné sériové
   * fronty jako bestmove a má stejnou politiku selhání: timeout/pád jednou
   * zopakuje na polovičním čase, protokolovou chybu neopakuje.
   */
  async evaluate(position: Position): Promise<EngineEvaluation> {
    return this.enqueue(async () => {
      try {
        return await this.requestEvaluate(position, this.timeMs);
      } catch (error) {
        if (error instanceof EngineProtocolError || error instanceof EngineClosedError) {
          throw error; // protokolová chyba / zavřený klient se neopakuje
        }
        const half = Math.max(1, Math.floor(this.timeMs / 2));
        this.log(`Engine selhal (${describeError(error)}), zkouším znovu na ${String(half)} ms.`);
        return await this.requestEvaluate(position, half);
      }
    });
  }

  /** Zabije proces enginu, smaže pidfile a odmítne čekající požadavky. */
  async close(): Promise<void> {
    this.closed = true;
    const ep = this.proc;
    this.proc = null;
    if (ep && !ep.dead) {
      ep.dead = true;
      ep.child.kill('SIGKILL');
    }
    this.rejectAllPending(new EngineClosedError());
    this.removePidFile();
    // Počkáme na dořetězení fronty, ať close() nevrací dřív, než doběhnou joby.
    await this.tail.catch(() => undefined);
  }

  // --- interní ---

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(new EngineClosedError());
    }
    const run = this.tail.then(job, job);
    // tail nesmí nést výsledek ani chybu jobu, jinak by jeden pád zasekl frontu.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async requestBestmove(
    position: Position,
    timeMs: number,
    strength?: Strength,
  ): Promise<Move> {
    // Páky síly se do požadavku vkládají JEN když jsou zadané: bez nich engine
    // dostane přesně dnešní zprávu (Profesionál) a chová se bit po bitu jako dřív
    // (zpětná kompatibilita – kontrolováno testem). exactOptionalPropertyTypes:
    // absence pole ≠ hodnota undefined, proto podmíněný spread, ne `?:`.
    const request: BestmoveRequest = {
      type: 'bestmove',
      id: this.nextId(),
      position,
      timeMs,
      ...(strength?.maxDepth !== undefined ? { maxDepth: strength.maxDepth } : {}),
      ...(strength?.carelessness !== undefined ? { carelessness: strength.carelessness } : {}),
    };
    const response = await this.request(request, timeMs + HARD_TIMEOUT_MARGIN_MS);
    if (response.type === 'bestmove') {
      // Engine je NEDŮVĚRYHODNÝ – tvar `move` se ověří TADY, na hranici procesu.
      // Bez toho by pokřivený tah (move: null, path: string…) vybouchl až o dvě
      // vrstvy dál TypeErrorem v `findLegalMove`; radši čitelná protokolová chyba.
      if (!isMoveShape(response.move)) {
        throw new EngineProtocolError('invalid_move', 'Engine vrátil tah v neplatném tvaru.');
      }
      return response.move;
    }
    if (response.type === 'error') {
      throw new EngineProtocolError(response.code, response.message);
    }
    throw new EngineProtocolError('unexpected', `Na bestmove přišlo "${response.type}".`);
  }

  private async requestEvaluate(position: Position, timeMs: number): Promise<EngineEvaluation> {
    const request: EvaluateRequest = { type: 'evaluate', id: this.nextId(), position, timeMs };
    const response = await this.request(request, timeMs + HARD_TIMEOUT_MARGIN_MS);
    if (response.type === 'evaluate') {
      // Nedůvěryhodný engine – tvar `score` se ověří TADY, na hranici procesu.
      // Bez toho by pokřivené skóre (score: null / "NaN") propadlo do prahové
      // logiky serveru a rozhodlo o remíze na základě smetí.
      if (typeof response.score !== 'number' || !Number.isFinite(response.score)) {
        throw new EngineProtocolError('invalid_score', 'Engine vrátil skóre v neplatném tvaru.');
      }
      return { score: response.score };
    }
    if (response.type === 'error') {
      throw new EngineProtocolError(response.code, response.message);
    }
    throw new EngineProtocolError('unexpected', `Na evaluate přišlo "${response.type}".`);
  }

  /**
   * Pošle jeden požadavek a čeká na odpověď spárovanou přes `id`, nejdéle
   * `timeoutMs`. Timeout i pád procesu končí výjimkou; na timeout proces zabije.
   */
  private request(message: EngineRequest, timeoutMs: number): Promise<EngineResponse> {
    const ep = this.ensureProcess();
    const id = message.id;

    return new Promise<EngineResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.killProcess(ep);
        reject(new EngineTimeoutError(id, timeoutMs));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (response): void => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error): void => {
          clearTimeout(timer);
          reject(error);
        },
      });

      try {
        ep.child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        // proces zemřel mezi ensureProcess a zápisem (EPIPE / destroyed stream)
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new EngineCrashError(describeError(error)));
      }
    });
  }

  private ensureProcess(): EngineProcess {
    if (this.closed) {
      throw new EngineClosedError();
    }
    if (this.proc && !this.proc.dead) {
      return this.proc;
    }
    return this.spawnProcess();
  }

  private spawnProcess(): EngineProcess {
    const child = spawn(this.spawnCmd.command, [...this.spawnCmd.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.spawnCmd.cwd === undefined ? {} : { cwd: this.spawnCmd.cwd }),
      ...(this.spawnCmd.env === undefined ? {} : { env: this.spawnCmd.env }),
    });
    const ep: EngineProcess = { child, buffer: new LineBuffer(), dead: false };
    this.proc = ep;

    // EPIPE na stdin (zápis do mrtvého procesu) nesmí shodit server jako
    // uncaught – chybu zápisu řešíme v request(), tady jen ať event nebublá.
    child.stdin?.on('error', () => undefined);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      for (const line of ep.buffer.push(chunk)) {
        this.onLine(ep, line);
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.log(`[engine stderr] ${chunk.trimEnd()}`);
    });

    child.on('exit', (code, signal) => {
      this.onExit(ep, `exit code=${String(code)} signal=${String(signal)}`);
    });
    child.on('error', (error) => {
      // spawn selhal (např. ENOENT) nebo proces nešlo zabít – bereme jako pád
      this.onExit(ep, describeError(error));
    });

    this.writePidFile(child.pid);
    return ep;
  }

  private onLine(ep: EngineProcess, line: string): void {
    if (ep !== this.proc) {
      return; // pozdní řádek ze starého (zabitého) procesu – ignoruj
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.log(`Nevalidní JSON z enginu: ${line}`);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.log(`Odpověď enginu není objekt: ${line}`);
      return;
    }
    const id = (parsed as { id?: unknown }).id;
    if (typeof id !== 'string') {
      this.log(`Odpověď enginu bez textového id: ${line}`);
      return;
    }
    const waiter = this.pending.get(id);
    if (waiter === undefined) {
      this.log(`Odpověď enginu na neznámé id "${id}".`);
      return;
    }
    this.pending.delete(id);
    waiter.resolve(parsed as EngineResponse);
  }

  private onExit(ep: EngineProcess, detail: string): void {
    ep.dead = true;
    if (ep !== this.proc) {
      return; // starý proces, který jsme sami nahradili – žádné čekatele nedrží
    }
    // Aktuální proces zemřel (pád, nebo náš SIGKILL při timeoutu) → odmítni
    // vše, co na něj čekalo. Při timeoutu je pending už prázdné (smazané v
    // request), takže se nic dvakrát neodmítne.
    this.rejectAllPending(new EngineCrashError(detail));
  }

  private killProcess(ep: EngineProcess): void {
    if (ep.dead) {
      return;
    }
    ep.dead = true; // synchronně, ať ensureProcess pro retry rovnou spawnne nový
    ep.child.kill('SIGKILL');
  }

  private rejectAllPending(error: Error): void {
    for (const waiter of this.pending.values()) {
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private nextId(): string {
    this.seq += 1;
    return `s${String(this.seq)}`;
  }

  // --- pidfile / úklid ---

  private cleanupStaleProcess(): void {
    if (this.pidFile === null || !existsSync(this.pidFile)) {
      return;
    }
    let raw: string;
    try {
      raw = readFileSync(this.pidFile, 'utf8');
    } catch (error) {
      this.log(`Pidfile ${this.pidFile} nešlo přečíst: ${describeError(error)}`);
      return;
    }
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      this.log(`Pidfile ${this.pidFile} má nesmyslný obsah "${raw.trim()}", mažu.`);
      this.removePidFile();
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
      this.log(`Uklidil jsem osiřelý engine PID ${String(pid)} z minulého běhu.`);
    } catch (error) {
      // ESRCH = proces už neběží (běžné); jiné (EPERM) jen zaloguj, nezhroutit se
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') {
        this.log(`Osiřelý PID ${String(pid)} nešlo zabít (${String(code)}).`);
      }
    }
    this.removePidFile();
  }

  private writePidFile(pid: number | undefined): void {
    if (this.pidFile === null || pid === undefined) {
      return;
    }
    try {
      writeFileSync(this.pidFile, `${String(pid)}\n`, 'utf8');
    } catch (error) {
      this.log(`Pidfile ${this.pidFile} nešlo zapsat: ${describeError(error)}`);
    }
  }

  private removePidFile(): void {
    if (this.pidFile === null) {
      return;
    }
    try {
      rmSync(this.pidFile, { force: true });
    } catch (error) {
      this.log(`Pidfile ${this.pidFile} nešlo smazat: ${describeError(error)}`);
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** Runtime ověření tvaru `Move` z nedůvěryhodného enginu (from + pole čísel). */
function isMoveShape(value: unknown): value is Move {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const move = value as Record<string, unknown>;
  return (
    typeof move.from === 'number' &&
    Array.isArray(move.path) &&
    move.path.every((sq) => typeof sq === 'number') &&
    Array.isArray(move.captures) &&
    move.captures.every((sq) => typeof sq === 'number')
  );
}

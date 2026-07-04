/**
 * Vstupní bod serveru: postaví app se zapojeným enginem a nechá ji naslouchat.
 * Port lze přebít proměnnou PORT (využívá to i curl brána, aby si vzala volný),
 * čas enginu na tah proměnnou ENGINE_TIME_MS.
 *
 * Životní cyklus procesů: engine se spustí jako podproces (EngineClient), na
 * startu se ho pokusíme „zahřát" handshakem (warmup) – studený start tsx tak
 * nezdrží první reálný tah. Při vypnutí (SIGTERM/SIGINT) se nejdřív zavře HTTP
 * server (přestane brát requesty) a pak engine (SIGKILL + úklid pidfile), ať po
 * sobě nenecháme osiřelý proces.
 */

import { buildApp, DEFAULT_ENGINE_TIME_MS, DEFAULT_PORT, EngineClient } from './index.js';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const timeMs = Number(process.env.ENGINE_TIME_MS ?? DEFAULT_ENGINE_TIME_MS);

const engine = new EngineClient({ timeMs });
const app = buildApp({ engine });

/** Kolik ms čekat na app.close(), než se engine ubije tak jako tak. */
const APP_CLOSE_TIMEOUT_MS = 3000;
/** Tvrdá pojistka: kdyby cokoli viselo, proces se ukončí i bez čistého konce. */
const HARD_EXIT_TIMEOUT_MS = 5000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} – vypínám server a engine…`);

  // Pojistka proti zavěšení: ať se stane cokoli, proces po HARD_EXIT skončí.
  const hardExit = setTimeout(() => {
    console.error('Vypínání trvá příliš dlouho, končím tvrdě.');
    process.exit(1);
  }, HARD_EXIT_TIMEOUT_MS);
  hardExit.unref();

  // app.close() může kvůli keep-alive spojení VISET; nečekáme na něj věčně,
  // jinak by se engine.close() (a tím kill enginu) nikdy neprovedl → sirotek.
  try {
    await Promise.race([app.close(), delay(APP_CLOSE_TIMEOUT_MS)]);
  } catch (err) {
    console.error('Chyba při zavírání serveru:', err);
  }
  // engine.close() se provede VŽDY – zabije podproces a smaže pidfile.
  await engine.close();
  process.exit(0);
}

function onSignal(signal: string): void {
  if (shuttingDown) {
    // Druhý signál během vypínání = uživatel chce ven hned.
    console.error('Druhý signál – tvrdé ukončení.');
    process.exit(1);
  }
  shuttingDown = true;
  void shutdown(signal);
}

process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

async function start(): Promise<void> {
  // Zahřátí je best-effort: když engine nenaběhne, server pořád běží (partie
  // pak jen skončí engine chybou), ale nechceme kvůli tomu spadnout při startu.
  try {
    const hello = await engine.warmup();
    console.log(`Engine připraven: ${hello.engine} (protokol ${String(hello.protocol)}).`);
  } catch (err) {
    console.error('Zahřátí enginu selhalo (server běží dál):', err);
  }

  const address = await app.listen({ port, host: '127.0.0.1' });
  console.log(`Server naslouchá na ${address}`);
}

start().catch((err: unknown) => {
  console.error('Server se nepodařilo spustit:', err);
  void engine.close().finally(() => process.exit(1));
});

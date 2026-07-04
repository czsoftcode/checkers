/**
 * Falešný engine pro testy orchestrace. Plain ESM (žádné tsx → rychlý,
 * deterministický start), mluví stejným JSON Lines protokolem jako reálný
 * engine, ale chování `bestmove` řídí přepínač `--mode`:
 *
 *   ok            → hned vrátí tah (výchozí 23→18, legální bílý po černém 9→13)
 *   hang          → na bestmove NIKDY neodpoví (simuluje zaseknuté přemýšlení)
 *   slow-then-ok  → když timeMs >= threshold, zasekne se; jinak hned odpoví
 *                   (rozliší první pokus od retry na timeMs/2 → test kill+retry)
 *   crash         → na první bestmove proces spadne (exit 1)
 *   illegal       → vrátí nelegální tah (server ho musí odmítnout)
 *
 * hello se zodpoví VŽDY hned (aby šlo warmup i po nastavení bestmove chování).
 */

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const mode = argValue('--mode', 'ok');
const threshold = Number.parseInt(argValue('--threshold', '300'), 10);
const move = JSON.parse(argValue('--move', '{"from":23,"path":[18],"captures":[]}'));

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ type: 'error', id: null, code: 'invalid_json', message: 'fake: bad json' });
    return;
  }
  const id = typeof msg.id === 'string' ? msg.id : null;

  if (msg.type === 'hello') {
    send({ type: 'hello', id, protocol: 2, engine: 'fake-engine' });
    return;
  }
  if (msg.type !== 'bestmove') {
    send({ type: 'error', id, code: 'unknown_type', message: `fake: ${String(msg.type)}` });
    return;
  }

  switch (mode) {
    case 'hang':
      return; // ani muk
    case 'crash':
      process.exit(1);
      return;
    case 'illegal':
      send({ type: 'bestmove', id, move: { from: 99, path: [99], captures: [] } });
      return;
    case 'error':
      send({ type: 'error', id, code: 'no_legal_moves', message: 'fake: error mode' });
      return;
    case 'malformed':
      // typ bestmove, ale `move` je nesmysl – nedůvěryhodný engine posílá smetí
      send({ type: 'bestmove', id, move: null });
      return;
    case 'slow-then-ok':
      if (typeof msg.timeMs === 'number' && msg.timeMs >= threshold) {
        return; // první (plný) pokus se zasekne; retry na timeMs/2 projde níž
      }
      send({ type: 'bestmove', id, move });
      return;
    case 'ok':
    default:
      send({ type: 'bestmove', id, move });
      return;
  }
}

// Řádkový buffer nad stdin.
let rest = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  rest += chunk;
  const parts = rest.split('\n');
  rest = parts.pop() ?? '';
  for (const part of parts) {
    const line = part.replace(/\r$/, '');
    if (line.trim() !== '') {
      handle(line);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
// Rodič zavřel rouru → není komu odpovídat.
process.stdout.on('error', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));

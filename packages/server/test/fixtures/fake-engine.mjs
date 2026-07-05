/**
 * Falešný engine pro testy orchestrace. Plain ESM (žádné tsx → rychlý,
 * deterministický start), mluví stejným JSON Lines protokolem jako reálný
 * engine. Přepínač `--mode` řídí chování požadavků `bestmove` I `evaluate`
 * (liší se jen tvar úspěšné odpovědi – tah vs. skóre z `--score`):
 *
 *   ok            → hned úspěšná odpověď (tah 23→18 / skóre z --score)
 *   hang          → NIKDY neodpoví (simuluje zaseknuté přemýšlení)
 *   slow-then-ok  → když timeMs >= threshold, zasekne se; jinak hned odpoví
 *                   (rozliší první pokus od retry na timeMs/2 → test kill+retry)
 *   crash         → na první požadavek proces spadne (exit 1)
 *   illegal       → vrátí nelegální tah (server ho musí odmítnout)
 *   error         → odpoví protokolovou chybou (no_legal_moves)
 *   malformed     → vrátí smetí místo tahu/skóre (move: null / score: "NaN")
 *   echo          → přijatý požadavek zopakuje na stderr ("REQ <json>") a pak
 *                   odpoví úspěšně; test si přes `log` (stderr) ověří, jaká pole
 *                   (maxDepth/carelessness) server reálně poslal do bestmove
 *
 * Argumenty: --score (skóre pro evaluate), --protocol (verze v hello, výchozí 3),
 * --move, --threshold. hello se zodpoví VŽDY hned (aby šlo warmup i po nastavení
 * chování požadavků).
 */

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const mode = argValue('--mode', 'ok');
const threshold = Number.parseInt(argValue('--threshold', '300'), 10);
const move = JSON.parse(argValue('--move', '{"from":23,"path":[18],"captures":[]}'));
const score = Number.parseInt(argValue('--score', '0'), 10);
const helloProtocol = Number.parseInt(argValue('--protocol', '3'), 10);

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** Úspěšná odpověď podle typu požadavku (bestmove → tah, evaluate → skóre). */
function successResponse(type, id) {
  return type === 'evaluate'
    ? { type: 'evaluate', id, score }
    : { type: 'bestmove', id, move };
}

/** Vadná („malformed") odpověď podle typu – nedůvěryhodný engine posílá smetí. */
function malformedResponse(type, id) {
  return type === 'evaluate'
    ? { type: 'evaluate', id, score: 'NaN' } // score není číslo
    : { type: 'bestmove', id, move: null };
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
    send({ type: 'hello', id, protocol: helloProtocol, engine: 'fake-engine' });
    return;
  }
  // bestmove i evaluate procházejí stejným přepínačem chování; liší se jen tvar
  // úspěšné odpovědi (successResponse). Ostatní typy jsou neznámé.
  if (msg.type !== 'bestmove' && msg.type !== 'evaluate') {
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
      send(malformedResponse(msg.type, id));
      return;
    case 'echo':
      // Přijatý řádek zopakuj na stderr, ať ho test uvidí přes `log` klienta,
      // a pak odpověz úspěšně (bestmove tah / evaluate skóre).
      process.stderr.write(`REQ ${line}\n`);
      send(successResponse(msg.type, id));
      return;
    case 'slow-then-ok':
      if (typeof msg.timeMs === 'number' && msg.timeMs >= threshold) {
        return; // první (plný) pokus se zasekne; retry na timeMs/2 projde níž
      }
      send(successResponse(msg.type, id));
      return;
    case 'ok':
    default:
      send(successResponse(msg.type, id));
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

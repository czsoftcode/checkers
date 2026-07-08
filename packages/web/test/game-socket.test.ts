import { afterEach, describe, expect, it } from 'vitest';
import { initialPosition, legalMoves } from '@checkers/rules';

import { createGameSocket } from '../src/game-socket.js';
import type { GameSocket, GameWebSocket } from '../src/game-socket.js';
import type { PvpGameDto } from '../src/server-client.js';

/** Ovladatelný fake WS partie (bez `send` – kanál je čtecí). Testy spouští message/error/close. */
class FakeSocket implements GameWebSocket {
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }
  fireError(): void {
    this.onerror?.();
  }
  fireClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const activeSockets: GameSocket[] = [];
afterEach(() => {
  for (const s of activeSockets) {
    s.close();
  }
  activeSockets.length = 0;
});

/** Validní PvP stav v drátovém tvaru (výchozí pozice, tahy z pravidel). */
function pvpGame(id = 'g1'): PvpGameDto {
  const position = initialPosition();
  return {
    mode: 'pvp',
    id,
    position,
    result: 'ongoing',
    legalMoves: legalMoves(position).map((m) => ({
      from: m.from,
      path: [...m.path],
      captures: [...m.captures],
    })),
  };
}

/** Krátké počkání na microtask (snapshot se aplikuje v `.then`). */
const tick = (): Promise<void> => Promise.resolve();

function harness(opts: { snapshot?: PvpGameDto | null } = {}) {
  const sockets: FakeSocket[] = [];
  const states: PvpGameDto[] = [];
  let closedCount = 0;
  // Výchozí snapshot = null (WS-cílené testy jím nejsou dotčené); konkrétní testy si
  // dají svůj. Vždy injektujeme, ať v testu neběží reálný `fetch`.
  const snapshot = opts.snapshot ?? null;
  const socket = createGameSocket(
    'g1',
    {
      onState: (g) => states.push(g),
      onClosed: () => {
        closedCount += 1;
      },
    },
    {
      url: 'ws://test/games/g1/ws',
      socketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      fetchSnapshot: () => Promise.resolve(snapshot),
    },
  );
  activeSockets.push(socket);
  return { sockets, states, socket, closed: () => closedCount };
}

describe('createGameSocket', () => {
  it('otevře socket na předané URL', () => {
    const h = harness();
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]!.url).toBe('ws://test/games/g1/ws');
  });

  it('validní game-state → onState s PvpGameDto', () => {
    const h = harness();
    const game = pvpGame();
    h.sockets[0]!.message({ type: 'game-state', game });
    expect(h.states).toHaveLength(1);
    expect(h.states[0]!.id).toBe('g1');
    expect(h.states[0]!.result).toBe('ongoing');
    expect(h.states[0]!.legalMoves.length).toBeGreaterThan(0);
  });

  it('rozbitá/cizí/null zpráva nespadne a nezavolá onState', () => {
    const h = harness();
    h.sockets[0]!.message('{ tohle není JSON'); // nevalidní JSON
    h.sockets[0]!.message('null'); // validní JSON, ale null
    h.sockets[0]!.message('42'); // primitivum
    h.sockets[0]!.message({ type: 'game-state' }); // chybí game
    h.sockets[0]!.message({ type: 'game-state', game: { mode: 'pvp', id: 5 } }); // vadný tvar
    h.sockets[0]!.message({ type: 'roster', players: [] }); // cizí typ
    // Engine stav (jiný mode) tímto kanálem nečekáme → zahoď.
    h.sockets[0]!.message({ type: 'game-state', game: { mode: 'engine', id: 'g1' } });
    expect(h.states).toHaveLength(0);
    expect(h.closed()).toBe(0); // rozbitá zpráva NENÍ konec spojení
  });

  it('close spojení → onClosed právě jednou (i při error+close v řadě)', () => {
    const h = harness();
    h.sockets[0]!.fireError();
    h.sockets[0]!.fireClose();
    expect(h.closed()).toBe(1);
  });

  it('server neznámou partii rovnou zavře → onClosed (neblokuje)', () => {
    const h = harness();
    h.sockets[0]!.fireClose(); // žádný game-state, rovnou close
    expect(h.states).toHaveLength(0);
    expect(h.closed()).toBe(1);
  });

  it('po close() klienta už žádný onClosed ani onState', () => {
    const h = harness();
    h.socket.close();
    expect(h.sockets[0]!.closed).toBe(true);
    h.sockets[0]!.fireClose(); // teardown odpojil handlery
    h.sockets[0]!.message({ type: 'game-state', game: pvpGame() });
    expect(h.closed()).toBe(0);
    expect(h.states).toHaveLength(0);
  });

  it('úvodní REST snapshot dorazí jako onState (i bez WS pushe)', async () => {
    const h = harness({ snapshot: pvpGame('gSnap') });
    await tick();
    expect(h.states).toHaveLength(1);
    expect(h.states[0]!.id).toBe('gSnap');
  });

  it('když živý push dorazí PŘED snapshotem, snapshot se zahodí (nepřepíše novější)', async () => {
    const h = harness({ snapshot: pvpGame('gSnap') }); // starší snapshot
    // Živý push dorazí synchronně hned (dřív než se resolvne snapshot .then).
    const live = pvpGame('gLive');
    h.sockets[0]!.message({ type: 'game-state', game: live });
    await tick(); // teď by se resolvnul snapshot – musí se ZAHODIT
    expect(h.states.map((s) => s.id)).toEqual(['gLive']); // jen živý, snapshot ne
  });

  it('snapshot null (partie zmizela / ne-PvP) nezavolá onState', async () => {
    const h = harness({ snapshot: null });
    await tick();
    expect(h.states).toHaveLength(0);
    expect(h.closed()).toBe(0);
  });

  it('snapshot se nepoužije, když se kanál mezitím zavřel', async () => {
    const h = harness({ snapshot: pvpGame('gSnap') });
    h.socket.close();
    await tick();
    expect(h.states).toHaveLength(0);
  });

  it('snapshot se nepoužije, když socket mezitím SPADL (down, ne explicitní close)', async () => {
    const h = harness({ snapshot: pvpGame('gSnap') });
    h.sockets[0]!.fireClose(); // pád spojení → onClosed, ale ne close() klienta
    expect(h.closed()).toBe(1);
    await tick(); // opožděný snapshot by neměl OŽIVIT mrtvý kanál
    expect(h.states).toHaveLength(0);
  });
});

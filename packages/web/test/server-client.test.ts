import { describe, expect, it, vi } from 'vitest';

import { createHttpClient, ServerError } from '../src/server-client.js';
import type { GameDto } from '../src/server-client.js';

const sampleDto: GameDto = {
  id: 'g1',
  position: { board: Array.from({ length: 32 }, () => null), turn: 'black' },
  result: 'ongoing',
  legalMoves: [],
  engineStatus: 'idle',
};

/** Minimální `Response`-like objekt, ať test nezávisí na globálním `Response`. */
function fakeResponse(init: { ok: boolean; status: number; body: unknown }): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(init.body),
  } as unknown as Response;
}

function okFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(() => Promise.resolve(fakeResponse({ ok: true, status, body })));
}

describe('createHttpClient', () => {
  it('createGame posílá POST /games a vrací GameDto', async () => {
    const fetchMock = okFetch(sampleDto, 201);
    const client = createHttpClient(fetchMock);

    const result = await client.createGame();

    expect(result).toEqual(sampleDto);
    expect(fetchMock).toHaveBeenCalledWith('/games', expect.objectContaining({ method: 'POST' }));
  });

  it('getGame posílá GET /games/:id s enkódovaným id', async () => {
    const fetchMock = okFetch(sampleDto);
    const client = createHttpClient(fetchMock);

    await client.getGame('a b');

    expect(fetchMock).toHaveBeenCalledWith('/games/a%20b', expect.objectContaining({ method: 'GET' }));
  });

  it('postMove posílá from + celou path v JSON těle', async () => {
    const fetchMock = okFetch(sampleDto);
    const client = createHttpClient(fetchMock);

    await client.postMove('g1', 6, [15, 22]);

    expect(fetchMock).toHaveBeenCalledWith(
      '/games/g1/moves',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 6, path: [15, 22] }),
      }),
    );
  });

  it('resign posílá POST /games/:id/resign s enkódovaným id, bez těla', async () => {
    const fetchMock = okFetch(sampleDto);
    const client = createHttpClient(fetchMock);

    const result = await client.resign('a b');

    expect(result).toEqual(sampleDto);
    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe('/games/a%20b/resign');
    expect(call?.[1]).toMatchObject({ method: 'POST' });
    // GET/POST bez těla se skládají bez `body` (exactOptionalPropertyTypes).
    expect((call?.[1] as RequestInit).body).toBeUndefined();
  });

  it('resign non-2xx (409 game_over) vyhodí ServerError se status a kódem', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        fakeResponse({
          ok: false,
          status: 409,
          body: { error: { code: 'game_over', message: 'Partie je u konce' } },
        }),
      ),
    ) as unknown as typeof fetch;
    const client = createHttpClient(fetchMock);

    await expect(client.resign('g1')).rejects.toMatchObject({ status: 409, code: 'game_over' });
  });

  it('non-2xx vyhodí ServerError se status a kódem z obálky', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        fakeResponse({
          ok: false,
          status: 409,
          body: { error: { code: 'illegal_move', message: 'Nelegální tah' } },
        }),
      ),
    ) as unknown as typeof fetch;
    const client = createHttpClient(fetchMock);

    await expect(client.postMove('g1', 6, [15])).rejects.toMatchObject({
      status: 409,
      code: 'illegal_move',
    });
  });

  it('non-2xx bez čitelné obálky pořád vyhodí ServerError se status (kód undefined)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      } as unknown as Response),
    ) as unknown as typeof fetch;
    const client = createHttpClient(fetchMock);

    const error = await client.getGame('g1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect(error).toMatchObject({ status: 500, code: undefined });
  });

  it('síťová chyba (fetch throws) se přebalí na ServerError(0)', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
    const client = createHttpClient(fetchMock);

    const error = await client.createGame().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect(error).toMatchObject({ status: 0 });
  });

  it('200 s ne-JSON tělem (např. index.html z proxy) vyhodí ServerError, ne SyntaxError', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      } as unknown as Response),
    ) as unknown as typeof fetch;
    const client = createHttpClient(fetchMock);

    const error = await client.getGame('g1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect(error).toMatchObject({ status: 200 });
  });

  it('200 s JSON špatného tvaru (drift kontraktu) vyhodí ServerError místo tiché koruce', async () => {
    // Chybí `position` – reálný drift, který by jinak nastavil position=undefined
    // a při renderu shodil desku.
    const fetchMock = okFetch({ id: 'g1', result: 'ongoing', engineStatus: 'idle' });
    const client = createHttpClient(fetchMock);

    const error = await client.createGame().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
  });
});

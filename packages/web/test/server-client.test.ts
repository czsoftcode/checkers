import { describe, expect, it, vi } from 'vitest';

import { createHttpClient, ServerError } from '../src/server-client.js';
import type { GameDto, ServerClient } from '../src/server-client.js';

/**
 * Vytáhne `getHint` z reálného klienta a ověří, že ho implementuje. `getHint` je
 * na kontraktu VOLITELNÝ (stubovat ho nemusí každý fake), ale reálný HTTP klient
 * ho mít MUSÍ – tenhle guard je zub: kdyby ho `createHttpClient` přestal vracet,
 * testy spadnou tady, ne tichým „nápověda nikdy nejde".
 */
function hintOf(client: ServerClient): (id: string) => Promise<unknown> {
  const getHint = client.getHint;
  if (getHint === undefined) {
    throw new Error('reálný HTTP klient musí implementovat getHint');
  }
  return getHint;
}

const sampleDto: GameDto = {
  id: 'g1',
  position: { board: Array.from({ length: 32 }, () => null), turn: 'black' },
  result: 'ongoing',
  legalMoves: [],
  engineStatus: 'idle',
  level: 'professional',
  ballotMoves: null,
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
  it('createGame posílá POST /games se zvolenou úrovní v těle a vrací GameDto', async () => {
    const fetchMock = okFetch(sampleDto, 201);
    const client = createHttpClient(fetchMock);

    const result = await client.createGame('beginner');

    expect(result).toEqual(sampleDto);
    expect(fetchMock).toHaveBeenCalledWith(
      '/games',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'beginner' }),
      }),
    );
  });

  it('přijme GameDto s úrovní Mistrovství (championship) – bílý na tahu, engine přemýšlí', async () => {
    // ZUB: než se `championship` přidalo do GAME_LEVELS, `isGameDto` by tuhle
    // odpověď ODMÍTL (level mimo povolené) a partie Mistrovství by v prohlížeči
    // spadla na „neočekávaný tvar GameDto". Popballotový stav = bílý (engine) na
    // tahu, engineStatus 'thinking'.
    const championshipDto: GameDto = {
      id: 'g1',
      position: { board: Array.from({ length: 32 }, () => null), turn: 'white' },
      result: 'ongoing',
      legalMoves: [],
      engineStatus: 'thinking',
      level: 'championship',
      ballotMoves: [
        { from: 9, path: [13], captures: [] },
        { from: 22, path: [18], captures: [] },
        { from: 11, path: [16], captures: [] },
      ],
    };
    const client = createHttpClient(okFetch(championshipDto, 201));

    const result = await client.createGame('championship');

    expect(result).toEqual(championshipDto);
    expect(result.level).toBe('championship');
    expect(result.position.turn).toBe('white');
    expect(result.ballotMoves).toHaveLength(3);
  });

  it('isGameDto: rozbité ballotMoves (číslo místo pole / prvek bez tvaru MoveDto) → ServerError', async () => {
    // ZUB guardu tvaru: klient z `ballotMoves` skládá animaci ballotu (applyMove),
    // takže rozbité pole musí spadnout hned při parsování odpovědi, ne až v renderu.
    const base = {
      id: 'g1',
      position: { board: Array.from({ length: 32 }, () => null), turn: 'white' },
      result: 'ongoing',
      legalMoves: [],
      engineStatus: 'thinking',
      level: 'championship',
    };

    // ballotMoves je číslo, ne pole ani null.
    const numberBallot = await createHttpClient(okFetch({ ...base, ballotMoves: 3 }, 201))
      .createGame('championship')
      .catch((e: unknown) => e);
    expect(numberBallot).toBeInstanceOf(ServerError);

    // ballotMoves je pole, ale prvek nemá tvar MoveDto (chybí path/captures).
    const badElement = await createHttpClient(okFetch({ ...base, ballotMoves: [{ from: 9 }] }, 201))
      .createGame('championship')
      .catch((e: unknown) => e);
    expect(badElement).toBeInstanceOf(ServerError);

    // Chybějící pole úplně (undefined) je taky drift → odmítnout.
    const missing = await createHttpClient(okFetch(base, 201))
      .createGame('championship')
      .catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ServerError);
  });

  it('isGameDto: humanColor je volitelný – chybějící pole projde (výchozí černý)', async () => {
    // ZUB zpětné kompatibility: sampleDto humanColor NEMÁ. Kdyby guard pole
    // vyžadoval, každá dnešní odpověď (a starý server) by spadla na „neočekávaný
    // tvar GameDto". Musí projít – volající si dosadí výchozí černý.
    const client = createHttpClient(okFetch(sampleDto, 201));
    const result = await client.createGame('professional');
    expect(result).toEqual(sampleDto);
    expect(result.humanColor).toBeUndefined();
  });

  it('isGameDto: humanColor="white" projde a dorazí až k volajícímu', async () => {
    const whiteDto: GameDto = { ...sampleDto, humanColor: 'white' };
    const client = createHttpClient(okFetch(whiteDto, 201));
    const result = await client.createGame('professional');
    expect(result.humanColor).toBe('white');
  });

  it('isGameDto: neplatný humanColor (ne black/white) → ServerError (drift)', async () => {
    // ZUB: přítomná, ale nesmyslná barva by orientovala desku podle undefined
    // větve. Guard ji musí odmítnout, ne tiše protéct.
    const badColor = await createHttpClient(okFetch({ ...sampleDto, humanColor: 'red' }, 201))
      .createGame('professional')
      .catch((e: unknown) => e);
    expect(badColor).toBeInstanceOf(ServerError);
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

    const error = await client.createGame('professional').catch((e: unknown) => e);
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

    const error = await client.createGame('professional').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
  });

  it('offerDraw posílá POST /games/:id/offer-draw bez těla a vrací { accepted, game }', async () => {
    const fetchMock = okFetch({ accepted: true, game: { ...sampleDto, result: 'draw' } });
    const client = createHttpClient(fetchMock);

    const result = await client.offerDraw('a b');

    expect(result.accepted).toBe(true);
    expect(result.game.result).toBe('draw');
    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe('/games/a%20b/offer-draw');
    expect(call?.[1]).toMatchObject({ method: 'POST' });
    expect((call?.[1] as RequestInit).body).toBeUndefined();
  });

  it('offerDraw odmítnutí: accepted false, hra zůstává ongoing', async () => {
    const fetchMock = okFetch({ accepted: false, game: sampleDto });
    const client = createHttpClient(fetchMock);

    const result = await client.offerDraw('g1');
    expect(result.accepted).toBe(false);
    expect(result.game.result).toBe('ongoing');
  });

  it('offerDraw non-2xx (409 engine_busy) vyhodí ServerError se status a kódem', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        fakeResponse({
          ok: false,
          status: 409,
          body: { error: { code: 'engine_busy', message: 'Počítač je na tahu' } },
        }),
      ),
    ) as unknown as typeof fetch;
    const client = createHttpClient(fetchMock);

    await expect(client.offerDraw('g1')).rejects.toMatchObject({ status: 409, code: 'engine_busy' });
  });

  it('offerDraw se špatným tvarem (chybí accepted / game) vyhodí ServerError', async () => {
    // Drift kontraktu: bez guardu by se `accepted`/`game` tiše staly undefined.
    const fetchMock = okFetch({ game: sampleDto }); // chybí accepted
    const client = createHttpClient(fetchMock);

    const error = await client.offerDraw('g1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
  });

  it('getHint posílá GET /games/:id/hint bez těla a vrací samotný MoveDto', async () => {
    const move = { from: 11, path: [15], captures: [] };
    const fetchMock = okFetch({ move });
    const client = createHttpClient(fetchMock);

    const result = await hintOf(client)('a b');

    expect(result).toEqual(move);
    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toBe('/games/a%20b/hint');
    expect(call?.[1]).toMatchObject({ method: 'GET' });
    expect((call?.[1] as RequestInit).body).toBeUndefined();
  });

  it('getHint non-2xx (503 engine_unavailable) vyhodí ServerError se status a kódem', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        fakeResponse({
          ok: false,
          status: 503,
          body: { error: { code: 'engine_unavailable', message: 'Počítač teď nedokáže poradit' } },
        }),
      ),
    ) as unknown as typeof fetch;
    const client = createHttpClient(fetchMock);

    await expect(hintOf(client)('g1')).rejects.toMatchObject({ status: 503, code: 'engine_unavailable' });
  });

  it('getHint se špatným tvarem (chybí move) vyhodí ServerError', async () => {
    // Drift kontraktu: bez guardu by nápověda protekla jako undefined a zvýraznila nesmysl.
    const fetchMock = okFetch({ notMove: 1 });
    const client = createHttpClient(fetchMock);

    const error = await hintOf(client)('g1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
  });

  it('getHint s move špatného tvaru (from není číslo) vyhodí ServerError', async () => {
    const fetchMock = okFetch({ move: { from: 'x', path: [15], captures: [] } });
    const client = createHttpClient(fetchMock);

    const error = await hintOf(client)('g1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
  });
});

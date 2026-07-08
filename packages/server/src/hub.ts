/**
 * Registr WebSocket odběratelů partií – transportní vrstva V3 (fáze 66).
 *
 * Drží mapu `gameId → množina otevřených socketů`. `broadcast` rozešle textovou
 * zprávu VŠEM odběratelům dané partie a NIKOMU jinému (izolace dvojice – jádro
 * dvouhráčového modelu). Hub o herním stavu nic neví: dostane hotový řetězec a
 * jen ho rozešle; serializaci (drátový tvar) staví volající v `app.ts`.
 *
 * Fire-and-forget vedlejší efekt: jeden vadný socket NESMÍ shodit ostatní ani
 * volající mutační cestu (REST odpověď, tah enginu). Proto se posílá po jednom,
 * v try/catch a jen do OTEVŘENÝCH spojení (readyState).
 *
 * VĚDOMĚ mimo tento řez (fáze 66): úklid nečinných/zombie spojení (idle
 * timeout), limity velikosti/frekvence zpráv. Základní odhlášení socketu při
 * `close` řeší WS route (bez něj by mapa i broadcast rostly o mrtvé sockety).
 */

/**
 * Minimální rozhraní socketu, které hub potřebuje. Reálně ho splňuje
 * `ws.WebSocket` z @fastify/websocket; test dodá fake se stejným tvarem, aby
 * šel hub ověřit bez skutečného spojení.
 */
export interface HubSocket {
  /** WebSocket readyState; `1` = OPEN (WHATWG i knihovna ws). */
  readonly readyState: number;
  send(data: string): void;
}

/**
 * readyState otevřeného WebSocketu. `WebSocket.OPEN === 1` dle WHATWG i ws –
 * konstanta pojmenovaná tady, ať broadcast neporovnává s magickou jedničkou.
 */
const WS_OPEN = 1;

export class GameHub {
  private readonly rooms = new Map<string, Set<HubSocket>>();

  /** Přihlásí socket k odběru partie `gameId` (idempotentní na tomtéž socketu). */
  subscribe(gameId: string, socket: HubSocket): void {
    let room = this.rooms.get(gameId);
    if (room === undefined) {
      room = new Set();
      this.rooms.set(gameId, room);
    }
    room.add(socket);
  }

  /**
   * Odhlásí socket. Prázdnou místnost zahodí, ať mapa neroste bez omezení o
   * partie, které už nikdo neodebírá. Neznámá partie / socket = no-op.
   */
  unsubscribe(gameId: string, socket: HubSocket): void {
    const room = this.rooms.get(gameId);
    if (room === undefined) {
      return;
    }
    room.delete(socket);
    if (room.size === 0) {
      this.rooms.delete(gameId);
    }
  }

  /**
   * Rozešle `payload` všem OTEVŘENÝM odběratelům partie `gameId`. Zavřené /
   * zavírající se sockety (readyState !== OPEN) přeskočí; výjimku z jednoho
   * `send` spolkne a zaloguje, aby nezablokovala ostatní ani volajícího.
   * Neznámá partie (nikdo neodebírá) = no-op.
   */
  broadcast(gameId: string, payload: string): void {
    const room = this.rooms.get(gameId);
    if (room === undefined) {
      return;
    }
    for (const socket of room) {
      if (socket.readyState !== WS_OPEN) {
        continue;
      }
      try {
        socket.send(payload);
      } catch (error) {
        console.error(`WS broadcast: odeslání do socketu partie ${gameId} selhalo:`, error);
      }
    }
  }

  /** Počet odběratelů partie – pro testy a diagnostiku. */
  subscriberCount(gameId: string): number {
    return this.rooms.get(gameId)?.size ?? 0;
  }
}

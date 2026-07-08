/**
 * Registr přítomných hráčů v JEDNÉ společné místnosti – globální real-time
 * vrstva V3 (fáze 67). Na rozdíl od `GameHub` (mapa `gameId → sockety`,
 * per-partie) je tu JEDNA globální množina hráčů `{ id, nick, socket }`.
 *
 * Modul je autorita nad obsazeností místnosti: přiděluje skryté session `id`
 * (autoritní klíč hráče – přezdívka je jen jmenovka, na kterou se pak navěsí
 * párování v todo 38), řeší case-insensitive unikátnost přezdívky, navrhuje
 * volnou variantu při kolizi a validuje přezdívku. Transport (WS route,
 * serializace drátových zpráv) je MIMO modul: route dostane výsledek `join`
 * a rozhodne, co komu poslat.
 *
 * Fire-and-forget vedlejší efekt (jako u `GameHub`): jeden vadný socket NESMÍ
 * shodit ostatní. `broadcast` posílá po jednom, v try/catch a jen do OTEVŘENÝCH
 * spojení (readyState).
 *
 * VĚDOMĚ mimo tento řez (fáze 67): stav volný/hraje (naplní párování, todo 38),
 * stabilní identita/reconnection (todo 42), úklid nečinných/zombie spojení a
 * limity zpráv (todo 45). Základní odhlášení hráče při `close` řeší WS route
 * voláním {@link RoomPresence.remove} – bez něj by roster i broadcast rostly
 * o mrtvá spojení.
 */

import { randomUUID } from 'node:crypto';

/**
 * Minimální rozhraní socketu, které registr potřebuje. Reálně ho splňuje
 * `ws.WebSocket` z @fastify/websocket; test dodá fake se stejným tvarem, aby
 * šel modul ověřit bez skutečného spojení.
 */
export interface RoomSocket {
  /** WebSocket readyState; `1` = OPEN (WHATWG i knihovna ws). */
  readonly readyState: number;
  send(data: string): void;
}

/** Veřejný pohled na hráče v místnosti (drátový tvar). Bez socketu, bez stavu. */
export interface RoomPlayer {
  readonly id: string;
  readonly nick: string;
}

/**
 * Výsledek pokusu o vstup do místnosti. `ok` = hráč zapsán (a je v rosteru);
 * `nick-taken` = přezdívka obsazená, hráč NEzapsán, `suggestion` je volná
 * varianta k opakování; `invalid` = přezdívka neprošla validací (prázdná /
 * příliš dlouhá), hráč NEzapsán, `reason` je lidský důvod.
 */
export type JoinResult =
  | { readonly status: 'ok'; readonly player: RoomPlayer }
  | { readonly status: 'nick-taken'; readonly suggestion: string }
  | { readonly status: 'invalid'; readonly reason: string };

/**
 * Maximální délka přezdívky (po `trim`). Konstanta (ne magické číslo): sdílí ji
 * validace i test (kontrakt mezi modulem a testem – ať test neověřuje proti
 * natvrdo zadané hodnotě, která se rozejde s kódem).
 */
export const NICK_MAX_LENGTH = 24;

/**
 * Drátové zprávy SERVER → klient (obálky s `type`). Route je jediné místo, kde
 * se serializují; klient (zatím jen test) je čte podle `type`.
 *  - `roster`     – JEN příchozímu, celý seznam přítomných (vč. sebe),
 *  - `joined`     – VŠEM ostatním, nový hráč,
 *  - `left`       – VŠEM zbylým, odchozí hráč (jen `id`),
 *  - `nick-taken` – příchozímu, přezdívka obsazená + návrh volné varianty,
 *  - `error`      – příchozímu, lidský důvod (prázdná/dlouhá přezdívka, dvojí
 *                   join, nevalidní zpráva); socket zůstává otevřený.
 */
export interface RosterMessage {
  readonly type: 'roster';
  readonly players: RoomPlayer[];
}
export interface JoinedMessage {
  readonly type: 'joined';
  readonly player: RoomPlayer;
}
export interface LeftMessage {
  readonly type: 'left';
  readonly player: { readonly id: string };
}
export interface NickTakenMessage {
  readonly type: 'nick-taken';
  readonly suggestion: string;
}
export interface RoomErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

/**
 * Drátové zprávy párování výzvou (fáze 68) – tečou po TÉMŽE room WS jako
 * presence. Logiku výzev drží `ChallengeRegistry`; route jen serializuje.
 *  - `challenged`          – JEN vyzvanému: přišla ti výzva (kdo + id k odpovědi),
 *  - `challenge-accepted`  – OBĚMA spárovaným: vznikla partie `gameId`, tvá barva
 *                            a soupeř (vyzyvatel černá, vyzvaný bílá),
 *  - `challenge-rejected`  – vyzyvateli: vyzvaný odmítl,
 *  - `challenge-cancelled` – protějšku zaniklé výzvy: druhý odešel / spároval se jinam.
 */
export interface ChallengedMessage {
  readonly type: 'challenged';
  readonly challenge: {
    readonly id: string;
    readonly challengerId: string;
    readonly challengerNick: string;
  };
}
export interface ChallengeAcceptedMessage {
  readonly type: 'challenge-accepted';
  readonly gameId: string;
  readonly color: 'black' | 'white';
  readonly opponentId: string;
}
export interface ChallengeRejectedMessage {
  readonly type: 'challenge-rejected';
  readonly challengedId: string;
}
export interface ChallengeCancelledMessage {
  readonly type: 'challenge-cancelled';
  readonly challengeId: string;
}
export type RoomServerMessage =
  | RosterMessage
  | JoinedMessage
  | LeftMessage
  | NickTakenMessage
  | RoomErrorMessage
  | ChallengedMessage
  | ChallengeAcceptedMessage
  | ChallengeRejectedMessage
  | ChallengeCancelledMessage;

/** readyState otevřeného WebSocketu. `WebSocket.OPEN === 1` dle WHATWG i ws. */
const WS_OPEN = 1;

interface PlayerEntry {
  readonly id: string;
  readonly nick: string;
  readonly socket: RoomSocket;
}

export class RoomPresence {
  private readonly players = new Map<string, PlayerEntry>();

  /**
   * Pokus o vstup pod přezdívkou. Trim → validace (prázdná / >{@link NICK_MAX_LENGTH})
   * → kontrola obsazenosti (case-insensitive). Při úspěchu přidělí session `id`,
   * hráče ZAPÍŠE (roster ho hned obsahuje) a vrátí `ok`. Jinak NIC nemění a vrátí
   * `nick-taken` (s návrhem) nebo `invalid` (s důvodem).
   *
   * Dvojí `join` na tomtéž socketu registr NEřeší – to je stav spojení, hlídá ho
   * route (drží referenci na už zapsaného hráče).
   */
  join(rawNick: string, socket: RoomSocket): JoinResult {
    const nick = rawNick.trim();
    if (nick.length === 0) {
      return { status: 'invalid', reason: 'Přezdívka nesmí být prázdná.' };
    }
    if (nick.length > NICK_MAX_LENGTH) {
      return {
        status: 'invalid',
        reason: `Přezdívka smí mít nejvýše ${NICK_MAX_LENGTH} znaků.`,
      };
    }
    if (this.isNickTaken(nick)) {
      return { status: 'nick-taken', suggestion: this.suggestFreeNick(nick) };
    }
    const id = randomUUID();
    this.players.set(id, { id, nick, socket });
    return { status: 'ok', player: { id, nick } };
  }

  /** Odhlásí hráče podle `id`. Neznámé `id` = no-op (idempotentní na `close`). */
  remove(id: string): void {
    this.players.delete(id);
  }

  /** Aktuální seznam přítomných (drátový tvar, bez socketů). */
  roster(): RoomPlayer[] {
    return [...this.players.values()].map(({ id, nick }) => ({ id, nick }));
  }

  /**
   * Rozešle `payload` VŠEM otevřeným hráčům, volitelně kromě `exceptId` (typicky
   * sám příchozí, který dostal `roster` a nemá dostat i vlastní `joined`).
   * Zavřené sockety (readyState !== OPEN) přeskočí; výjimku z jednoho `send`
   * spolkne a zaloguje, aby nezablokovala ostatní.
   */
  broadcast(payload: string, exceptId?: string): void {
    for (const entry of this.players.values()) {
      if (entry.id === exceptId || entry.socket.readyState !== WS_OPEN) {
        continue;
      }
      try {
        entry.socket.send(payload);
      } catch (error) {
        console.error(`Místnost: odeslání hráči ${entry.id} selhalo:`, error);
      }
    }
  }

  /** Je hráč `id` v místnosti? Pro směrované zprávy (výzva na přítomného). */
  has(id: string): boolean {
    return this.players.has(id);
  }

  /**
   * Pošle `payload` JEDNOMU hráči podle `id` (směrovaná zpráva – výzva, přijetí,
   * odmítnutí, zrušení). No-op, když hráč není v místnosti nebo má zavřený socket.
   * Fire-and-forget jako {@link broadcast}: výjimku z `send` spolkne a zaloguje,
   * ať jeden vadný socket nezhodí volající cestu. Vrací `true`, když se doručilo.
   */
  sendTo(id: string, payload: string): boolean {
    const entry = this.players.get(id);
    if (entry?.socket.readyState !== WS_OPEN) {
      return false;
    }
    try {
      entry.socket.send(payload);
      return true;
    } catch (error) {
      console.error(`Místnost: směrované odeslání hráči ${id} selhalo:`, error);
      return false;
    }
  }

  /** Počet přítomných – pro testy a diagnostiku (deterministické čekání). */
  count(): number {
    return this.players.size;
  }

  /** Je přezdívka obsazená? Porovnání case-insensitive (`honza` == `Honza`). */
  private isNickTaken(nick: string): boolean {
    const lower = nick.toLowerCase();
    for (const entry of this.players.values()) {
      if (entry.nick.toLowerCase() === lower) {
        return true;
      }
    }
    return false;
  }

  /**
   * Nejnižší volná varianta `nick_1`, `nick_2`, … (case-insensitive). Kdyby
   * návrh přesáhl {@link NICK_MAX_LENGTH}, základ se zkrátí, ať návrh projde
   * validací při opakovaném `join`. Smyčka je konečná: přítomných je konečně,
   * takže nějaké `n` je vždy volné.
   */
  private suggestFreeNick(nick: string): string {
    for (let n = 1; ; n += 1) {
      const suffix = `_${n}`;
      const maxBase = NICK_MAX_LENGTH - suffix.length;
      const base = nick.length > maxBase ? nick.slice(0, maxBase) : nick;
      const candidate = `${base}${suffix}`;
      if (!this.isNickTaken(candidate)) {
        return candidate;
      }
    }
  }
}

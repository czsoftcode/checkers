/**
 * Prezence hráčů v PĚTI varianta-lobby (fáze 103, italská přidána 116). Dvě vrstvy:
 *
 *  - {@link RoomPresence} = transport JEDNÉ lobby: množina `{ id, nick, socket }`,
 *    roster, broadcast a směrované `sendTo`. NEřeší unikátnost přezdívky ani
 *    přidělování id – to je nově globální (viz níž). Vnitřek se od fáze 67 skoro
 *    nezměnil, jen se z něj VYTÁHLA identita.
 *  - {@link Lobbies} = registr 5 lobby + GLOBÁLNÍ identita. Přezdívka je jedna na
 *    CELÝ server (jeden registr nicků, ne 4× per-lobby), příprava na budoucí login.
 *    Hráč (identita) je v PRÁVĚ JEDNÉ lobby a smí PŘEJÍT do jiné (`switchLobby`)
 *    bez ztráty přezdívky/session. Cross-variant výzva pak padne přirozeně:
 *    `Lobbies.room(mojeVarianta).has(cíl)` je false, když cíl je v jiné lobby.
 *
 * Fire-and-forget vedlejší efekt (jako u `GameHub`): jeden vadný socket NESMÍ
 * shodit ostatní. `broadcast`/`sendTo` posílají v try/catch a jen do OTEVŘENÝCH
 * spojení (readyState).
 *
 * VĚDOMĚ mimo tento řez: stabilní identita/reconnection (todo 42), úklid
 * nečinných/zombie spojení a limity zpráv (todo 45), KLIENTSKÉ UI pěti místností
 * (D3b). Odhlášení hráče při `close` řeší WS route voláním {@link Lobbies.remove}.
 */

import { randomUUID } from 'node:crypto';
import { VARIANT_IDS } from '@checkers/rules';
import type { VariantId } from '@checkers/rules';

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
 * Výsledek pokusu o vstup do lobby. `ok` = hráč zapsán (a je v rosteru své
 * lobby); `nick-taken` = přezdívka obsazená GLOBÁLNĚ (v libovolné lobby), hráč
 * NEzapsán, `suggestion` je volná varianta k opakování; `invalid` = přezdívka
 * neprošla validací (prázdná / příliš dlouhá), hráč NEzapsán, `reason` je důvod.
 */
export type JoinResult =
  | { readonly status: 'ok'; readonly player: RoomPlayer }
  | { readonly status: 'nick-taken'; readonly suggestion: string }
  | { readonly status: 'invalid'; readonly reason: string };

/**
 * Výsledek přechodu do jiné lobby ({@link Lobbies.switchLobby}). `ok` nese cílovou
 * variantu; `not-joined` = hráč vůbec není přihlášen (neznámé id); `same` = už je
 * v cílové lobby (no-op, ale route to nemá hlásit jako přechod). Autoritu „hráč
 * není v aktivní partii" hlídá route PŘED voláním (registr hry nezná).
 */
export type SwitchLobbyResult =
  | { readonly status: 'ok'; readonly variant: VariantId }
  | { readonly status: 'not-joined' }
  | { readonly status: 'same' };

/**
 * Maximální délka přezdívky (po `trim`). Konstanta (ne magické číslo): sdílí ji
 * validace i test (kontrakt mezi modulem a testem – ať test neověřuje proti
 * natvrdo zadané hodnotě, která se rozejde s kódem).
 */
export const NICK_MAX_LENGTH = 24;

/**
 * Drátové zprávy SERVER → klient (obálky s `type`). Route je jediné místo, kde
 * se serializují; klient (zatím jen test) je čte podle `type`.
 *  - `roster`     – JEN příchozímu, celý seznam přítomných v JEHO lobby (vč. sebe)
 *                   + `variant` (echo lobby, do které vstoupil / přešel – fáze 103),
 *  - `joined`     – ostatním V TÉŽE lobby, nový hráč,
 *  - `left`       – zbylým V TÉŽE lobby, odchozí hráč (jen `id`),
 *  - `nick-taken` – příchozímu, přezdívka obsazená + návrh volné varianty,
 *  - `error`      – příchozímu, lidský důvod (prázdná/dlouhá přezdívka, dvojí
 *                   connect, nevalidní zpráva); socket zůstává otevřený.
 */
export interface RosterMessage {
  readonly type: 'roster';
  readonly players: RoomPlayer[];
  /** Varianta lobby, do které hráč vstoupil (echo pro klienta – fáze 103). */
  readonly variant: VariantId;
}

/** Roster JEDNÉ lobby ve snímku všech lobby (fáze 104): varianta + přítomní. */
export interface LobbyRoster {
  readonly variant: VariantId;
  readonly players: RoomPlayer[];
}

/**
 * Snímek rosterů VŠECH 5 lobby (fáze 104). Server ho pushuje KAŽDÉMU přihlášenému
 * po každé změně prezence (join, switch-lobby, odchod), aby akordeon v klientu
 * viděl, kdo je v které lobby, i BEZ vstupu do ní. Je to čistě ČTENÍ (rostery na
 * displej); scoped `roster`/`joined`/`left` (jedna lobby) zůstávají pro logiku
 * výzev nedotčené (fáze 103) – tenhle snímek je NAVÍC, ne náhrada. Starý klient
 * neznámý `type` ignoruje.
 */
export interface LobbiesMessage {
  readonly type: 'lobbies';
  readonly lobbies: LobbyRoster[];
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

/**
 * Signály nabídky remízy v PvP partii (fáze 77) – tečou po TÉMŽE room WS jako
 * presence a výzvy (oba hráči místnost drží po celou partii). Samotný STAV
 * partie (přijatá remíza, vzdání) jde jinou cestou – přes game hub `/games/:id/ws`
 * jako `game-state`; sem patří JEN signalizace nabídky, která stav pravidel nemění.
 *  - `draw-offered`  – JEN soupeři nabízejícího: „soupeř nabízí remízu" (+ `gameId`),
 *  - `draw-rejected` – JEN nabízejícímu: „soupeř tvou nabídku odmítl" (+ `gameId`).
 * Přijetí nabídky se sem NEPOSÍLÁ – projeví se terminálním `game-state` (draw) oběma.
 */
export interface DrawOfferedMessage {
  readonly type: 'draw-offered';
  readonly gameId: string;
}
export interface DrawRejectedMessage {
  readonly type: 'draw-rejected';
  readonly gameId: string;
}

/**
 * Signály ODVETY po dohrané partii (fáze 77) – po room WS, analogicky k nabídce
 * remízy. Samotné ZAČÁTEK nové partie po přijetí odvety se sem NEPOSÍLÁ – jde
 * stávající cestou `challenge-accepted` (obě strany rovnou přejdou do nové hry).
 *  - `rematch-offered`  – JEN soupeři nabízejícího: „soupeř chce odvetu" (+ `gameId`),
 *  - `rematch-declined` – JEN nabízejícímu: „soupeř odvetu odmítl / partii ukončil".
 */
export interface RematchOfferedMessage {
  readonly type: 'rematch-offered';
  readonly gameId: string;
}
export interface RematchDeclinedMessage {
  readonly type: 'rematch-declined';
  readonly gameId: string;
}

/**
 * Partie `gameId` je pro OBA u konce – druhý hráč dal „Konec" (fáze 77). Příjemce se
 * má taky přesunout do místnosti, ať nezůstane viset na výsledku a neví, co se děje.
 * Posílá se soupeři odcházejícího hráče při `leave-game`.
 */
export interface GameClosedMessage {
  readonly type: 'game-closed';
  readonly gameId: string;
}
export type RoomServerMessage =
  | RosterMessage
  | LobbiesMessage
  | JoinedMessage
  | LeftMessage
  | NickTakenMessage
  | RoomErrorMessage
  | ChallengedMessage
  | ChallengeAcceptedMessage
  | ChallengeRejectedMessage
  | ChallengeCancelledMessage
  | DrawOfferedMessage
  | DrawRejectedMessage
  | RematchOfferedMessage
  | RematchDeclinedMessage
  | GameClosedMessage;

/** readyState otevřeného WebSocketu. `WebSocket.OPEN === 1` dle WHATWG i ws. */
const WS_OPEN = 1;

interface PlayerEntry {
  readonly id: string;
  readonly nick: string;
  readonly socket: RoomSocket;
}

/**
 * Transport JEDNÉ lobby (fáze 103, dřív celá „místnost" fáze 67). Drží množinu
 * přítomných `{ id, nick, socket }` a umí roster, broadcast a směrované `sendTo`.
 *
 * NEřeší unikátnost přezdívky ani přidělování id – hráče sem vkládá {@link Lobbies}
 * přes {@link RoomPresence.add} s už přidělenou identitou (id je globálně unikátní).
 * Tím zůstává jedna přezdívka na CELÝ server, ne 4× per-lobby.
 */
export class RoomPresence {
  private readonly players = new Map<string, PlayerEntry>();

  /**
   * Vloží hráče s UŽ přidělenou identitou (id, nick) a jeho socketem. Volá
   * výhradně {@link Lobbies} (po globální kontrole unikátnosti a validaci) –
   * proto tu žádná kontrola není. Duplicitní id přepíše (nenastává: id je UUID).
   */
  add(player: RoomPlayer, socket: RoomSocket): void {
    this.players.set(player.id, { id: player.id, nick: player.nick, socket });
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
   * Rozešle `payload` VŠEM otevřeným hráčům lobby, volitelně kromě `exceptId`
   * (typicky sám příchozí, který dostal `roster` a nemá dostat i vlastní `joined`).
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
        console.error(`Lobby: odeslání hráči ${entry.id} selhalo:`, error);
      }
    }
  }

  /** Je hráč `id` v TÉTO lobby? Pro směrované zprávy (výzva na přítomného v lobby). */
  has(id: string): boolean {
    return this.players.has(id);
  }

  /**
   * Pošle `payload` JEDNOMU hráči lobby podle `id` (směrovaná zpráva – výzva,
   * přijetí, odmítnutí, zrušení). No-op, když hráč není v lobby nebo má zavřený
   * socket. Fire-and-forget jako {@link broadcast}: výjimku z `send` spolkne a
   * zaloguje, ať jeden vadný socket nezhodí volající cestu. Vrací `true`, když
   * se doručilo.
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
      console.error(`Lobby: směrované odeslání hráči ${id} selhalo:`, error);
      return false;
    }
  }

  /** Počet přítomných v této lobby – pro testy a diagnostiku (deterministické čekání). */
  count(): number {
    return this.players.size;
  }
}

/**
 * Globální identita hráče: přezdívka + socket + lobby, ve které je člen. `variant`
 * je `null` u PŘEDSÍNĚ (fáze 105): hráč je připojený (`connect`), má přezdívku a
 * dostává all-roster snímek, ale NENÍ členem žádné lobby (v žádném rosteru) – dokud
 * nezvolí lobby přes `enter` (fáze 105).
 */
interface Identity {
  readonly nick: string;
  readonly variant: VariantId | null;
  readonly socket: RoomSocket;
}

/**
 * Registr PĚTI varianta-lobby + GLOBÁLNÍ identita (fáze 103). Jeden zdroj pravdy
 * o tom, kdo je přihlášen (nick→lobby) a je autorita nad unikátností přezdívky
 * přes CELÝ server. Přezdívka je jedna na program (příprava na budoucí login),
 * NE na místnost: „Karel" nejde zaregistrovat dvakrát ani do různých lobby.
 *
 * Členství per lobby drží pět {@link RoomPresence} (transport). Route (app.ts)
 * dostane výsledek operace a rozhodne, komu co poslat.
 */
export class Lobbies {
  private readonly rooms = new Map<VariantId, RoomPresence>();
  /** id → identita (nick + lobby + socket). Klíč unikátnosti nicku je globální. */
  private readonly identities = new Map<string, Identity>();

  constructor() {
    // Všech 5 lobby eagerly – registr je úplný, `room()` nikdy nevrátí undefined.
    for (const variant of VARIANT_IDS) {
      this.rooms.set(variant, new RoomPresence());
    }
  }

  /**
   * Transport dané lobby. Registr je úplný (5 variant), takže pro platné
   * `VariantId` nikdy nevrátí undefined; neznámá varianta (cizí cast) → RangeError,
   * ne tiché defaultnutí (stejná zásada jako `rulesetForVariant`).
   */
  room(variant: VariantId): RoomPresence {
    const room = this.rooms.get(variant);
    if (room === undefined) {
      throw new RangeError(`Neznámá lobby: ${String(variant)}`);
    }
    return room;
  }

  /**
   * PŘEDSÍŇ (fáze 105): zaregistruje GLOBÁLNÍ identitu BEZ členství (`variant=null`).
   * Trim → validace → globální kontrola obsazenosti. Při úspěchu
   * přidělí session `id`, zapíše identitu s `variant=null` a vrátí `ok`. Hráč NENÍ v
   * žádném rosteru (žádná room), ale `broadcastAll` ho zasáhne (iteruje identity), takže
   * all-roster snímek dostane. Do lobby vstoupí až přes {@link enter}.
   */
  connect(rawNick: string, socket: RoomSocket): JoinResult {
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
    this.identities.set(id, { nick, variant: null, socket });
    return { status: 'ok', player: { id, nick } };
  }

  /**
   * PRVNÍ vstup do lobby z předsíně (fáze 105): připojený ne-člen (`variant=null`)
   * se stane členem lobby `target` (add do room). Sdílí jádro se {@link switchLobby}
   * ({@link assignLobby}), takže zvládne i (nepravděpodobný) přechod člena – app to
   * ale volá jen pro ne-člena. `not-joined` když identita neexistuje; `same` když už
   * je v cílové lobby.
   */
  enter(id: string, target: VariantId): SwitchLobbyResult {
    return this.assignLobby(id, target);
  }

  /**
   * Odhlásí hráče (uvolní identitu i členství v jeho lobby). Neznámé `id` = no-op
   * (idempotentní na `close`). Přezdívka se tím GLOBÁLNĚ uvolní.
   */
  remove(id: string): void {
    const identity = this.identities.get(id);
    if (identity === undefined) {
      return;
    }
    this.identities.delete(id);
    // Ne-člen předsíně (`variant=null`) není v žádné room → nic neodebírej (fáze 105).
    if (identity.variant !== null) {
      this.room(identity.variant).remove(id);
    }
  }

  /**
   * Lobby hráče `id`: `VariantId` když je člen, `null` když je připojen v předsíni
   * (bez členství, fáze 105), `undefined` když není přihlášen. Volající MUSÍ null
   * odlišit od varianty (ne-člen nejde vyzvat / nepatří do rosteru).
   */
  variantOf(id: string): VariantId | null | undefined {
    return this.identities.get(id)?.variant;
  }

  /**
   * Přechod hráče `id` do lobby `target` BEZ ztráty identity (fáze 103). Přesune
   * členství (socket) mezi lobby, přezdívka/session zůstává. `not-joined` když
   * hráč není přihlášen; `same` když už v cílové lobby je (route to nehlásí jako
   * přechod). Autoritu „hráč není v aktivní partii" hlídá route PŘED voláním –
   * registr hry nezná (proto sem přechod za běhu partie vůbec nesmí dorazit).
   */
  switchLobby(id: string, target: VariantId): SwitchLobbyResult {
    return this.assignLobby(id, target);
  }

  /**
   * Sdílené jádro {@link enter} a {@link switchLobby} (fáze 105): přiřadí hráči `id`
   * členství v lobby `target`. Z předsíně (`variant=null`) jen PŘIDÁ do room; z jiné
   * lobby (člen) nejdřív odebere ze staré a pak přidá do cílové (chování `switchLobby`
   * z fáze 103 je pro člena BYTE-IDENTICKÉ – null větev se ho netýká). `not-joined`
   * když identita neexistuje; `same` když už je v cílové lobby (no-op).
   */
  private assignLobby(id: string, target: VariantId): SwitchLobbyResult {
    const identity = this.identities.get(id);
    if (identity === undefined) {
      return { status: 'not-joined' };
    }
    if (identity.variant === target) {
      return { status: 'same' };
    }
    // Člen: opusť starou lobby. Ne-člen předsíně (null): není odkud odejít – jen se přidá.
    if (identity.variant !== null) {
      this.room(identity.variant).remove(id);
    }
    this.identities.set(id, { nick: identity.nick, variant: target, socket: identity.socket });
    this.room(target).add({ id, nick: identity.nick }, identity.socket);
    return { status: 'ok', variant: target };
  }

  /**
   * Pošle `payload` hráči `id` do JEHO lobby (najde ji přes identitu). Konvence
   * pro směrované zprávy, kde je příjemce jednoznačný (session id je globálně
   * unikátní). No-op, když hráč není přihlášen / má zavřený socket.
   */
  sendTo(id: string, payload: string): boolean {
    const identity = this.identities.get(id);
    if (identity === undefined) {
      return false;
    }
    // Ne-člen předsíně (`variant=null`) není v žádné room → doruč přímo na jeho socket
    // (fáze 105). V tomto řezu sem směrovaná zpráva pro ne-člena nechodí (výzvy jsou pro
    // ne-členy zakázané), ale přímé doručení je bezpečné a nemaskuje null defaultem.
    if (identity.variant === null) {
      if (identity.socket.readyState !== WS_OPEN) {
        return false;
      }
      try {
        identity.socket.send(payload);
        return true;
      } catch (error) {
        console.error(`Lobbies: přímé odeslání ne-členu ${id} selhalo:`, error);
        return false;
      }
    }
    return this.room(identity.variant).sendTo(id, payload);
  }

  /** Počet přihlášených (napříč všemi lobby) – pro testy/diagnostiku. */
  totalCount(): number {
    return this.identities.size;
  }

  /**
   * Snímek rosterů VŠECH 5 lobby (fáze 104) v pořadí {@link VARIANT_IDS}. Pro
   * all-roster broadcast akordeonu – čistě čtení (bez socketů), volá se po každé
   * změně prezence. Registr je úplný, takže je vždy 4 položky.
   */
  allRosters(): LobbyRoster[] {
    return VARIANT_IDS.map((variant) => ({ variant, players: this.room(variant).roster() }));
  }

  /**
   * Rozešle `payload` VŠEM přihlášeným hráčům napříč lobby (fáze 104) – fan-out
   * přes identity (jeden socket na identitu). Pro all-roster snímek, ať ho po
   * změně prezence dostane i hráč v JINÉ lobby. Zavřené sockety (readyState !==
   * OPEN) přeskočí; výjimku z jednoho `send` spolkne a zaloguje (fire-and-forget
   * jako {@link RoomPresence.broadcast}), aby jeden vadný socket nezhodil ostatní.
   */
  broadcastAll(payload: string): void {
    for (const identity of this.identities.values()) {
      if (identity.socket.readyState !== WS_OPEN) {
        continue;
      }
      try {
        identity.socket.send(payload);
      } catch (error) {
        console.error('Lobbies: all-roster broadcast selhal:', error);
      }
    }
  }

  /**
   * Je přezdívka obsazená GLOBÁLNĚ (v libovolné lobby)? Porovnání case-insensitive
   * (`honza` == `Honza`). Jádro „jedna přezdívka na program".
   */
  private isNickTaken(nick: string): boolean {
    const lower = nick.toLowerCase();
    for (const identity of this.identities.values()) {
      if (identity.nick.toLowerCase() === lower) {
        return true;
      }
    }
    return false;
  }

  /**
   * Nejnižší volná varianta `nick_1`, `nick_2`, … (case-insensitive, GLOBÁLNĚ).
   * Kdyby návrh přesáhl {@link NICK_MAX_LENGTH}, základ se zkrátí, ať návrh projde
   * validací při opakovaném `connect`. Smyčka je konečná: přihlášených je konečně,
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

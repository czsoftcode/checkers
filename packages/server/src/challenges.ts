/**
 * Registr čekajících výzev na partii mezi hráči v místnosti (fáze 68). Čistá
 * logika životního cyklu výzvy BEZ transportu: WS route (viz `app.ts`) dostane
 * výsledek operace a rozhodne, komu co poslat. Registr sám nikam neposílá.
 *
 * Drží dva stavy:
 *  - `pending` – čekající výzvy (`challengeId → Challenge`), dokud vyzvaný
 *    nepřijme / neodmítne, nebo dokud jeden z dvojice neopustí místnost,
 *  - `busy`    – session id hráčů, kteří UŽ hrají (spárovali se). Vyzvat lze jen
 *    volného hráče a jen volný hráč může vyzvat. Busy se ruší odchodem hráče
 *    ({@link ChallengeRegistry.removePlayer}) NEBO uvolněním po dohrané partii
 *    ({@link ChallengeRegistry.release} – fáze 77, „Konec"/„Odveta" ve výsledkovém
 *    modalu). Bez uvolnění po konci by dvojice zůstala busy až do odpojení a
 *    nemohla hrát s nikým jiným.
 *
 * Pravidla proti divným stavům (rozhodnutí z diskuse fáze 68 – „plné ošetření"):
 *  - nelze vyzvat sám sebe,
 *  - busy hráč (na obou stranách) výzvu nedostane ani nepošle,
 *  - mezi dvojicí smí čekat NEJVÝŠ JEDNA výzva v libovolném směru – to pokrývá
 *    dvojitou výzvu (A→B dvakrát) i křížovou (A→B a zároveň B→A) jedním pravidlem,
 *  - přijetí spáruje dvojici a ZRUŠÍ všechny ostatní výzvy obou (aby A, který se
 *    spároval, nezůstal viset v cizí čekající výzvě); WS uvědomí protějšky.
 */

import { randomUUID } from 'node:crypto';

/** Čekající výzva: skryté id + session id vyzyvatele a vyzvaného. */
export interface Challenge {
  readonly id: string;
  readonly challengerId: string;
  readonly challengedId: string;
}

/** Výsledek pokusu o vytvoření výzvy. `rejected` nese lidský důvod pro `error`. */
export type CreateChallengeResult =
  | { readonly status: 'ok'; readonly challenge: Challenge }
  | { readonly status: 'rejected'; readonly reason: string };

/**
 * Výsledek přijetí výzvy. `ok` = dvojice spárována (WS založí partii); `cancelled`
 * jsou VEDLEJŠÍ výzvy obou hráčů, které tím zanikly (WS uvědomí jejich protějšky).
 * `gone` = výzva už neplatí (vyzyvatel odešel, cizí/neznámé id, ne pro tebe).
 */
export type AcceptChallengeResult =
  | { readonly status: 'ok'; readonly challenge: Challenge; readonly cancelled: Challenge[] }
  | { readonly status: 'gone' };

/** Výsledek odmítnutí výzvy. `gone` = výzva už neplatí / není pro tebe. */
export type RejectChallengeResult =
  | { readonly status: 'ok'; readonly challenge: Challenge }
  | { readonly status: 'gone' };

export class ChallengeRegistry {
  private readonly pending = new Map<string, Challenge>();
  private readonly busy = new Set<string>();

  /**
   * Vytvoří výzvu vyzyvatele na vyzvaného. Odmítne sebe-výzvu, výzvu na/od busy
   * hráče a druhou výzvu mezi touž dvojicí (v libovolném směru). Při úspěchu
   * přidělí `challengeId` a výzvu zapíše.
   */
  create(challengerId: string, challengedId: string): CreateChallengeResult {
    if (challengerId === challengedId) {
      return { status: 'rejected', reason: 'Nemůžeš vyzvat sám sebe.' };
    }
    if (this.busy.has(challengerId)) {
      return { status: 'rejected', reason: 'Už hraješ partii.' };
    }
    if (this.busy.has(challengedId)) {
      return { status: 'rejected', reason: 'Vyzvaný hráč už hraje.' };
    }
    if (this.hasPendingBetween(challengerId, challengedId)) {
      return { status: 'rejected', reason: 'Výzva mezi vámi už čeká na odpověď.' };
    }
    // Pravidlo „první výzva vyhrává" (fáze 105): vyzvaný smí mít NEJVÝŠ JEDNU čekající
    // PŘÍCHOZÍ výzvu (od kohokoli). Když už jednu má, další vyzyvatel je odmítnut jiným
    // důvodem než „už hraje" – vyzvaný zatím jen zvažuje. Efekt: klient (fáze 106) ukáže
    // v modalu vždy právě jednu výzvu, žádná fronta. Kontrola je AŽ za `hasPendingBetween`,
    // ať dvojitá A→B dostane přesnější „mezi vámi už čeká".
    if (this.hasPendingIncoming(challengedId)) {
      return { status: 'rejected', reason: 'Vyzvaný hráč právě zvažuje jinou výzvu.' };
    }
    const challenge: Challenge = { id: randomUUID(), challengerId, challengedId };
    this.pending.set(challenge.id, challenge);
    return { status: 'ok', challenge };
  }

  /**
   * Vyzvaný (`byId`) přijme výzvu `challengeId`. Přijmout smí JEN vyzvaný a jen
   * existující výzvu – jinak `gone`. Při úspěchu označí oba za busy, výzvu odebere
   * a zruší všechny ostatní výzvy obou (vrací je v `cancelled`).
   */
  accept(byId: string, challengeId: string): AcceptChallengeResult {
    const challenge = this.pending.get(challengeId);
    if (challenge?.challengedId !== byId) {
      return { status: 'gone' };
    }
    // Obrana: dvojice měla být volná (create to hlídá a přijetí jinam odklidí
    // ostatní výzvy hráče níž). Kdyby přesto někdo busy byl, výzva je neplatná.
    if (this.busy.has(challenge.challengerId) || this.busy.has(challenge.challengedId)) {
      this.pending.delete(challengeId);
      return { status: 'gone' };
    }
    this.pending.delete(challengeId);
    this.busy.add(challenge.challengerId);
    this.busy.add(challenge.challengedId);
    const cancelled = this.removeInvolving(
      new Set([challenge.challengerId, challenge.challengedId]),
    );
    return { status: 'ok', challenge, cancelled };
  }

  /** Vyzvaný (`byId`) odmítne výzvu `challengeId`. Cizí/neznámou → `gone`. */
  reject(byId: string, challengeId: string): RejectChallengeResult {
    const challenge = this.pending.get(challengeId);
    if (challenge?.challengedId !== byId) {
      return { status: 'gone' };
    }
    this.pending.delete(challengeId);
    return { status: 'ok', challenge };
  }

  /**
   * Hráč opustil místnost: uvolní jeho busy stav a zruší VŠECHNY jeho čekající
   * výzvy (jako vyzyvatele i vyzvaného). Vrací zrušené výzvy, ať WS uvědomí
   * protějšky (`challenge-cancelled`). Idempotentní: neznámé id = prázdný výsledek.
   */
  removePlayer(id: string): Challenge[] {
    this.busy.delete(id);
    return this.removeInvolving(new Set([id]));
  }

  /**
   * Uvolní hráče z busy stavu (fáze 77) – po DOHRANÉ partii, ať může hrát s někým
   * jiným. Na rozdíl od {@link removePlayer} NEruší jeho čekající výzvy: po konci
   * partie může mít čerstvou výzvu na odvetu, kterou nechceme shodit. Idempotentní
   * (uvolnit neuvolněného = no-op). Autoritu „partie je opravdu u konce" hlídá
   * volající (app) – registr sám stav partie nezná.
   */
  release(id: string): void {
    this.busy.delete(id);
  }

  /** Hraje hráč už partii? Pro testy a obranné kontroly. */
  isBusy(id: string): boolean {
    return this.busy.has(id);
  }

  /** Počet čekajících výzev – pro testy (deterministické čekání bez sleepu). */
  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Má hráč `id` čekající PŘÍCHOZÍ výzvu (je něčí `challengedId`)? Jádro pravidla
   * „první výzva vyhrává" (fáze 105) – druhý vyzyvatel na téhož vyzvaného je odmítnut.
   * Veřejné pro obranné kontroly a testy.
   */
  hasPendingIncoming(id: string): boolean {
    for (const c of this.pending.values()) {
      if (c.challengedId === id) {
        return true;
      }
    }
    return false;
  }

  private hasPendingBetween(a: string, b: string): boolean {
    for (const c of this.pending.values()) {
      if (
        (c.challengerId === a && c.challengedId === b) ||
        (c.challengerId === b && c.challengedId === a)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Odebere a vrátí všechny výzvy, kde je vyzyvatel NEBO vyzvaný v `ids`. Mazání
   * za běhu iterace Map je bezpečné (Map iteruje deterministicky vč. smazaných).
   */
  private removeInvolving(ids: Set<string>): Challenge[] {
    const removed: Challenge[] = [];
    for (const [key, c] of this.pending) {
      if (ids.has(c.challengerId) || ids.has(c.challengedId)) {
        removed.push(c);
        this.pending.delete(key);
      }
    }
    return removed;
  }
}

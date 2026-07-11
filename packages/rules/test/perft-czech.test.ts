/**
 * Perft brána pro ČESKOU dámu (Czech draughts, `CZECH_RULESET`).
 *
 * ZDROJ OVĚŘENÍ (otevírací pozice): český muž bere JEN VPŘED a v mělkých
 * hloubkách se na desce ještě NEOBJEVÍ žádná dáma (muži jsou daleko od
 * proměny). Do té doby je český strom tahů IDENTICKÝ s americkým – proto
 * česká otevírací perft 1–6 musí SEDNOUT NA PUBLIKOVANÁ AMERICKÁ čísla
 * (7/49/302/1469/7361/36768). To je zadarmo cross-check bitu
 * `manCaptureBackward=false`: kdyby český muž bral i dozadu (jako pool),
 * číslo v hloubce 5 by bylo 7482 (pool), ne 7361 (americká).
 *
 * CO OTEVÍRACÍ PERFT NEOVĚŘÍ: létavou dámu ani prioritu braní dámou –
 * v mělké hloubce žádné dámy nejsou. Tyto rysy pokrývají golden testy
 * (`czech-king-priority.test.ts`, `flying-*`), ne perft. Publikovaná česká
 * perft čísla se najít nepodařilo; hlubší strom by potřeboval nezávislý
 * oracle s prioritou (mimo řez této fáze).
 */

import { describe, expect, it } from 'vitest';

import {
  AMERICAN_RULESET,
  CZECH_RULESET,
  POOL_RULESET,
  initialPosition,
  perft,
} from '../src/index.js';

describe('česká perft – otevírací pozice (== americká, kříží se s manCaptureBackward)', () => {
  // Zafixovaná AMERICKÁ čísla (English draughts) z výchozí pozice, hloubka 1–6.
  // Česká se s nimi MUSÍ krýt: muž jen vpřed + žádné dámy v mělké hloubce.
  const EXPECTED_AMERICAN: readonly number[] = [7, 49, 302, 1469, 7361, 36768];

  it.each(EXPECTED_AMERICAN.map((nodes, i) => [i + 1, nodes] as const))(
    'perft česká(%i) = %i (== americká)',
    (depth, nodes) => {
      expect(perft(initialPosition(), depth, CZECH_RULESET)).toBe(nodes);
    },
  );

  it('shoda s americkým stromem do hloubky 6 (žádná dáma se dosud neobjeví)', () => {
    const start = initialPosition();
    for (let d = 1; d <= 6; d++) {
      expect(perft(start, d, CZECH_RULESET)).toBe(perft(start, d, AMERICAN_RULESET));
    }
  });

  it('zuby: česká se LIŠÍ od pool (muž jen vpřed) – hloubka 5 je 7361, ne 7482', () => {
    const start = initialPosition();
    // Do hloubky 4 pool a americká (tedy i česká) ještě splývají; v hloubce 5
    // se pool rozejde braním dozadu. Kdyby česká měla manCaptureBackward=true,
    // seděla by na pool – tento test by to odhalil.
    expect(perft(start, 5, CZECH_RULESET)).toBe(7361);
    expect(perft(start, 5, POOL_RULESET)).toBe(7482);
    expect(perft(start, 5, CZECH_RULESET)).not.toBe(perft(start, 5, POOL_RULESET));
  });
});

import { describe, expect, it } from 'vitest';

// Geometrický stavební blok – z indexu se (jako isNeighbor) neexportuje,
// test ho importuje přímo z modulu.
import { raySquares } from '../src/board.js';

describe('raySquares – paprsek diagonály', () => {
  it('sousední pole je paprsek délky 1 (from exkluzivně, to inkluzivně)', () => {
    expect(raySquares(18, 14)).toEqual([14]);
  });

  it('vrací všechna mezipole i cíl na delší diagonále (18→5 přes 14, 9)', () => {
    expect(raySquares(18, 5)).toEqual([14, 9, 5]);
  });

  it('nejdelší diagonála přes celou desku (18→4 přes 15, 11, 8)', () => {
    expect(raySquares(18, 4)).toEqual([15, 11, 8, 4]);
  });

  it('funguje ve všech čtyřech směrech z 18', () => {
    expect(raySquares(18, 9)).toEqual([14, 9]); // NW
    expect(raySquares(18, 11)).toEqual([15, 11]); // NE
    expect(raySquares(18, 25)).toEqual([22, 25]); // SW
    expect(raySquares(18, 27)).toEqual([23, 27]); // SE
  });

  it('pole ležící vedle diagonály (stejná řada) vrací null', () => {
    // 19 je ve stejné řadě jako 18 – není na žádné diagonále z 18.
    expect(raySquares(18, 19)).toBeNull();
  });

  it('to === from vrací null (prázdný paprsek)', () => {
    expect(raySquares(18, 18)).toBeNull();
  });

  it('cíl mimo desku (33) vrací null, nevyhazuje', () => {
    expect(raySquares(18, 33)).toBeNull();
  });

  it('pole za okrajem diagonály není dosažitelné (5 je konec NW z 18)', () => {
    // Za 5 už NW diagonála spadne z desky – 1 na ní neleží.
    expect(raySquares(18, 1)).toBeNull();
  });

  it('neplatné výchozí pole vyhazuje RangeError', () => {
    expect(() => raySquares(0, 5)).toThrow(RangeError);
    expect(() => raySquares(33, 5)).toThrow(RangeError);
  });
});

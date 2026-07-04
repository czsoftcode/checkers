/**
 * Rekonstrukce tahu z rozdílu dvou pozic – čistá logika bez DOM.
 *
 * Server posílá klientovi jen výslednou pozici, ne odehraný tah. Aby šlo tah
 * animovat (a u vícenásobného skoku projít mezidopady), musí klient tah odvodit
 * z porovnání PŘEDCHOZÍ a NOVÉ pozice: které pole se vyprázdnilo (`from`), kam
 * kámen dorazil (`to`), které soupeřovy kameny zmizely (`captured`) a v jakém
 * pořadí kámen skákal (`hops`).
 *
 * Pojistka „jeden diff = právě jeden tah": když rozdíl neodpovídá jednomu
 * legálnímu tahu (dva slité tahy, přeskočený poll, nic se nestalo), vrátí
 * `null` a volající desku jen tiše překreslí – NEanimuje nesmysl.
 */

import { BOARD_SIZE, isDarkSquare, squareToCoords, coordsToSquare } from '@checkers/rules';
import type { Cell, Color, Position, Square } from '@checkers/rules';

/**
 * Odvozený tah k animaci.
 * - `hops` je posloupnost polí DOPADU v pořadí skoků; poslední prvek je `to`.
 *   Prostý tah má `hops = [to]`.
 * - `captured` jsou přeskočená pole. U zrekonstruovaného skoku platí
 *   `captured.length === hops.length` (i-tý skok bere `captured[i]`); u fallbacku
 *   (rovný posun `from`→`to`, když cestu nejde složit) může být delší než `hops`
 *   a volající je odebere najednou.
 */
export interface DiffMove {
  readonly from: Square;
  readonly to: Square;
  readonly hops: readonly Square[];
  readonly captured: readonly Square[];
}

/** Jedna zrekonstruovaná cesta skoku: pole dopadů a přeskočené kameny (zarovnané). */
interface JumpPath {
  readonly hops: readonly Square[];
  readonly captured: readonly Square[];
}

/**
 * Odvodí tah z rozdílu `prev`→`next`. Strana, která táhla, je `prev.turn`.
 * Vrací `null`, když rozdíl neodpovídá právě jednomu tahu (viz pojistka výše).
 */
export function diffMove(prev: Position, next: Position): DiffMove | null {
  const mover = prev.turn;

  const appearedOwn: Square[] = [];
  const disappearedOwn: Square[] = [];
  const captured: Square[] = [];

  for (let i = 0; i < prev.board.length; i++) {
    const before = prev.board[i] ?? null;
    const after = next.board[i] ?? null;
    if (cellsEqual(before, after)) {
      continue;
    }
    const square = i + 1;
    // Pole s kamenem v obou snímcích, ale JINÝM – žádný jeden legální tah takové
    // pole nezanechá (kámen buď stojí, nebo odejde, dopad je na prázdné). Nesmysl.
    if (before !== null && after !== null) {
      return null;
    }
    if (after !== null) {
      // Přibyl kámen. Vlastní = dopad tahu; soupeřův = soupeř nemohl přibýt.
      if (after.color === mover) {
        appearedOwn.push(square);
      } else {
        return null;
      }
    } else {
      // Kámen zmizel: vlastní = výchozí pole, soupeřův = sebraný.
      if (before !== null && before.color === mover) {
        disappearedOwn.push(square);
      } else {
        captured.push(square);
      }
    }
  }

  // Právě jeden posun vlastního kamene: from = kde zmizel, to = kam přibyl.
  const from = disappearedOwn[0];
  const to = appearedOwn[0];
  if (appearedOwn.length === 1 && disappearedOwn.length === 1 && from !== undefined && to !== undefined) {
    return build(next, from, to, captured);
  }

  // Kruhový skok dámy končící NA VÝCHOZÍM poli: vlastní kámen se v poli obsahem
  // nezměnil (from === to, dáma zůstala dámou), takže z pole samotného není nic
  // vidět – změnily se jen sebrané kameny. Hledáme vlastní kámen (v obou snímcích
  // stejný), z něhož jde složit uzavřená smyčka přes všechny sebrané.
  if (appearedOwn.length === 0 && disappearedOwn.length === 0 && captured.length > 0) {
    return buildCircular(prev, next, mover, captured);
  }

  // Cokoli jiného (přibyl kámen odnikud, zmizely dva vlastní, nic se nestalo) není
  // jeden tah → neanimovat.
  return null;
}

/** Sestaví `DiffMove` pro tah s identifikovaným from/to. */
function build(next: Position, from: Square, to: Square, captured: readonly Square[]): DiffMove {
  if (captured.length === 0) {
    // Prostý tah (nebo cokoli bez braní) – rovný posun na cíl.
    return { from, to, hops: [to], captured: [] };
  }
  const paths = reconstructPaths(from, to, captured, next);
  if (paths.length === 0) {
    // Cestu nejde geometricky složit → fallback: rovný posun, sebrané naráz na konci.
    return { from, to, hops: [to], captured };
  }
  const chosen = pickClockwise(from, paths);
  return { from, to, hops: chosen.hops, captured: chosen.captured };
}

/** Sestaví `DiffMove` pro kruhový skok končící na výchozím poli (from === to). */
function buildCircular(
  prev: Position,
  next: Position,
  mover: Color,
  captured: readonly Square[],
): DiffMove | null {
  const solutions: { square: Square; path: JumpPath }[] = [];
  for (let i = 0; i < prev.board.length; i++) {
    const before = prev.board[i] ?? null;
    const after = next.board[i] ?? null;
    // Kandidát: vlastní kámen, který v obou snímcích stojí beze změny.
    if (before === null) {
      continue;
    }
    if (before.color !== mover || !cellsEqual(before, after)) {
      continue;
    }
    const square = i + 1;
    const paths = reconstructPaths(square, square, captured, next);
    if (paths.length > 0) {
      solutions.push({ square, path: pickClockwise(square, paths) });
    }
  }
  // Žádná smyčka, nebo víc kamenů, z nichž smyčka jde – nejednoznačné → neanimovat.
  const only = solutions[0];
  if (solutions.length !== 1 || only === undefined) {
    return null;
  }
  return { from: only.square, to: only.square, hops: only.path.hops, captured: only.path.captured };
}

/**
 * Najde VŠECHNY cesty skoku z `from` na `to`, které přeskočí přesně množinu
 * `captured` (každý právě jednou). Mezidopad leží 2 pole za přeskočeným kamenem
 * po diagonále a musí být v `next` prázdný (kámen jím jen prošel); poslední dopad
 * je `to`. Pro kruhový skok je `from === to`.
 */
function reconstructPaths(
  from: Square,
  to: Square,
  captured: readonly Square[],
  next: Position,
): JumpPath[] {
  const results: JumpPath[] = [];

  const dfs = (current: Square, remaining: Square[], hops: Square[], caps: Square[]): void => {
    if (remaining.length === 0) {
      if (current === to) {
        results.push({ hops: [...hops], captured: [...caps] });
      }
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      const cap = remaining[i];
      if (cap === undefined) {
        continue;
      }
      const landing = jumpLanding(current, cap);
      if (landing === null) {
        continue;
      }
      // Mezidopad musí být v cílové pozici prázdný; jen poslední (== to) je obsazen.
      if (landing !== to && (next.board[landing - 1] ?? null) !== null) {
        continue;
      }
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      dfs(landing, rest, [...hops, landing], [...caps, cap]);
    }
  };

  dfs(from, [...captured], [], []);
  return results;
}

/**
 * Pole dopadu při skoku z `from` přes sousední `over`: `over` musí být diagonální
 * soused a dopad leží o krok dál stejným směrem. `null`, když `over` není
 * diagonální soused nebo dopad padá mimo desku / na světlé pole.
 */
function jumpLanding(from: Square, over: Square): Square | null {
  const a = squareToCoords(from);
  const b = squareToCoords(over);
  const dr = b.row - a.row;
  const dc = b.col - a.col;
  if (Math.abs(dr) !== 1 || Math.abs(dc) !== 1) {
    return null;
  }
  const row = a.row + 2 * dr;
  const col = a.col + 2 * dc;
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE || !isDarkSquare(row, col)) {
    return null;
  }
  return coordsToSquare(row, col);
}

/**
 * Z platných cest vybere tu vedoucí PO SMĚRU hodinových ručiček. Orientaci určuje
 * znaménko plochy uzavřeného mnohoúhelníku `[from, ...hops]` (shoelace), přičemž
 * na obrazovce roste Y (řádek) DOLŮ – kladná plocha proto odpovídá směru
 * hodinových ručiček. Vybere cestu s největší (nejvíc kladnou) plochou; u jediné
 * cesty ji jen vrátí.
 */
function pickClockwise(from: Square, paths: JumpPath[]): JumpPath {
  let best = paths[0]!;
  let bestArea = signedScreenArea(from, best.hops);
  for (let i = 1; i < paths.length; i++) {
    const candidate = paths[i]!;
    const area = signedScreenArea(from, candidate.hops);
    if (area > bestArea) {
      bestArea = area;
      best = candidate;
    }
  }
  return best;
}

/**
 * Dvojnásobek znaménkové plochy mnohoúhelníku daného poli (x = sloupec,
 * y = řádek, Y dolů). Kladná = po směru hodinových ručiček na obrazovce.
 */
function signedScreenArea(from: Square, hops: readonly Square[]): number {
  const vertices = [from, ...hops].map((sq) => squareToCoords(sq));
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    sum += a.col * b.row - b.col * a.row;
  }
  return sum;
}

/** Obsah dvou polí je stejný (obě prázdná, nebo stejná barva i druh). */
function cellsEqual(a: Cell, b: Cell): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.color === b.color && a.kind === b.kind;
}

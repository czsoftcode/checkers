/**
 * Čistý model výběru a zvýraznění – žádný DOM.
 *
 * Jediným zdrojem legality je knihovna `rules`; klient nikdy sám nerozhoduje,
 * co je legální tah. Povinné braní se tím respektuje automaticky: když má strana
 * na tahu k dispozici skok, `legalMoves` prosté tahy vůbec nevrátí, takže se
 * ani nezvýrazní.
 *
 * Vícenásobný skok se doklikává po dopadech: model drží **předponu cesty**
 * (naklikaná pole dopadu, bez výchozího pole) a ptá se `rules`, které tahy touto
 * předponou začínají. Nikdy sám nepočítá „už není kam skočit“ – to plyne z toho,
 * že v každé podporované variantě je skokový řetězec z `legalMoves` MAXIMÁLNÍ,
 * takže se předpona buď rovná `path` právě jednoho tahu (hotovo), nebo z ní vede
 * aspoň jeden další dopad. Platí i pro létavou dámu (pool/ruská/česká) – paprskové
 * braní vrací rules taky jako úplné cesty.
 *
 * Ruleset varianty je VOLITELNÝ argument každé funkce (default {@link AMERICAN_RULESET}
 * = dnešní chování). Controller ho odvodí z varianty HRY a předává ho sem, aby UI
 * zvýrazňovalo tytéž tahy, jaké engine reálně počítá – jinak by se pro ne-americkou
 * partii nabídly tahy jiné varianty.
 */

import { AMERICAN_RULESET, legalMoves } from '@checkers/rules';
import type { Cell, Move, Position, Ruleset, Square } from '@checkers/rules';

/** Obsah pole `square` (1–32), nebo `null` mimo rozsah i pro prázdné pole. */
function cellAt(position: Position, square: Square): Cell {
  if (!Number.isInteger(square) || square < 1 || square > position.board.length) {
    return null;
  }
  return position.board[square - 1] ?? null;
}

/**
 * `true`, pokud na poli stojí kámen strany, která je na tahu (jen ten lze
 * vybrat). Prázdné pole, kámen soupeře i pole mimo desku vrací `false`.
 */
export function selectableAt(position: Position, square: Square): boolean {
  const cell = cellAt(position, square);
  return cell !== null && cell.color === position.turn;
}

/** `true`, pokud `path` začíná přesně poli z `prefix` (ve stejném pořadí). */
function pathStartsWith(path: readonly Square[], prefix: readonly Square[]): boolean {
  if (prefix.length > path.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Další možná pole dopadu z kamene `from` po naklikané předponě `prefix`
 * (dopady bez výchozího pole). Pro každý legální tah, jehož `path` začíná touto
 * předponou, se vezme pole na indexu `prefix.length` (tj. bezprostředně další
 * dopad). Duplicity se sloučí; větvení = víc různých polí.
 *
 * Prázdná předpona = první dopady všech tahů z `from` (výběr právě vybraného
 * kamene). Vrací prázdné pole, když z `from` po této předponě žádný legální tah
 * nepokračuje (včetně povinného braní jiným kamenem).
 */
export function nextTargets(
  position: Position,
  from: Square,
  prefix: readonly Square[],
  ruleset: Ruleset = AMERICAN_RULESET,
): Square[] {
  const targets: Square[] = [];
  for (const move of legalMoves(position, ruleset)) {
    if (move.from !== from || !pathStartsWith(move.path, prefix)) {
      continue;
    }
    const next = move.path[prefix.length];
    if (next !== undefined && !targets.includes(next)) {
      targets.push(next);
    }
  }
  return targets;
}

/**
 * Kompletní legální tah, jehož `path` se přesně rovná naklikané předponě
 * (`from` + celá sekvence dopadů). Vrací `null`, když žádný takový tah není –
 * tj. předpona je zatím jen rozpracovaná (vede z ní další dopad) nebo neodpovídá
 * ničemu legálnímu. Kontroler dokončení pozná podle prázdného `nextTargets`;
 * tato funkce pak vydá konkrétní `Move` k provedení.
 */
export function resolveMove(
  position: Position,
  from: Square,
  prefix: readonly Square[],
  ruleset: Ruleset = AMERICAN_RULESET,
): Move | null {
  for (const move of legalMoves(position, ruleset)) {
    if (move.from !== from || move.path.length !== prefix.length) {
      continue;
    }
    if (pathStartsWith(move.path, prefix)) {
      return move;
    }
  }
  return null;
}

/**
 * Cílová pole prvních dopadů legálních tahů z daného pole (předpona prázdná).
 * Tenká obálka nad {@link nextTargets} – zachována pro výběr kamene bez
 * rozpracované sekvence.
 */
export function targetsFor(
  position: Position,
  square: Square,
  ruleset: Ruleset = AMERICAN_RULESET,
): Square[] {
  return nextTargets(position, square, [], ruleset);
}

/**
 * KONCOVÁ pole všech legálních tahů z `from` (poslední dopad každého tahu; duplicity
 * sloučeny). U prostého tahu je to jeho cílové pole, u vícenásobného skoku KONCOVÉ pole
 * řetězu (ne mezidopady). Slouží zvýraznění cílů při TAŽENÍ, kdy hráč pouští kámen rovnou
 * na koncové pole (na rozdíl od klikání hop-po-hopu, které bere {@link nextTargets}).
 */
export function endpointsFor(
  position: Position,
  from: Square,
  ruleset: Ruleset = AMERICAN_RULESET,
): Square[] {
  const ends: Square[] = [];
  for (const move of legalMoves(position, ruleset)) {
    if (move.from !== from) {
      continue;
    }
    const last = move.path[move.path.length - 1];
    if (last !== undefined && !ends.includes(last)) {
      ends.push(last);
    }
  }
  return ends;
}

/**
 * Kompletní legální tah z `from`, jehož `path` začíná předponou `prefix` a jehož
 * FINÁLNÍ dopad je `endpoint` – tj. celý zbývající řetěz skoků končící přesně v
 * `endpoint`. Slouží „souvislému tažení" drag & dropu: hráč pustí kámen rovnou na
 * koncové pole braní a klient dohledá celou cestu.
 *
 * Vrací `null`, když žádný takový tah neexistuje, i když jsou takové tahy DVA a
 * víc (nejednoznačné – dva různé řetězce na stejný endpoint). `endpoint` musí ležet
 * ZA aktuální předponou (delší cesta), jinak by prázdný prefix + `endpoint` uvnitř
 * cesty propustil kratší tah. Bezprostřední jeden dopad řeší volající přes
 * {@link nextTargets}; sem se dostane až pro vzdálenější koncová pole.
 */
export function resolveChainTo(
  position: Position,
  from: Square,
  prefix: readonly Square[],
  endpoint: Square,
  ruleset: Ruleset = AMERICAN_RULESET,
): Move | null {
  let found: Move | null = null;
  for (const move of legalMoves(position, ruleset)) {
    if (move.from !== from || move.path.length <= prefix.length) {
      continue;
    }
    if (!pathStartsWith(move.path, prefix)) {
      continue;
    }
    if (move.path[move.path.length - 1] !== endpoint) {
      continue;
    }
    if (found !== null) {
      return null; // dva různé řetězce končící v `endpoint` → nejednoznačné
    }
    found = move;
  }
  return found;
}

/**
 * Pole SEBRANÉHO kamene při jednom skoku z předpony `prefix` na dopad `to`, tj.
 * kámen přeskočený právě tímto hopem. Bere se z libovolného legálního tahu, jehož
 * `path` začíná `[...prefix, to]`; `captures` je zarovnané s `path` (i-tý dopad
 * bere `captures[i]`), takže sebraný tohoto hopu je `captures[prefix.length]`.
 *
 * Vrací prázdné pole u prostého (nebracího) tahu i když `[...prefix, to]` žádnému
 * tahu neodpovídá. Vždy nejvýš jeden prvek – drag & drop ho předá desce k
 * plynulému zmizení (`land` + fade) při potvrzení hopu.
 */
export function capturedOnHop(
  position: Position,
  from: Square,
  prefix: readonly Square[],
  to: Square,
  ruleset: Ruleset = AMERICAN_RULESET,
): Square[] {
  const path = [...prefix, to];
  for (const move of legalMoves(position, ruleset)) {
    if (move.from !== from || !pathStartsWith(move.path, path)) {
      continue;
    }
    const captured = move.captures[prefix.length];
    return captured === undefined ? [] : [captured];
  }
  return [];
}

/**
 * Pole VŠECH kamenů sebraných v dosavadní předponě `prefix` (dopady bez výchozího
 * pole). Bere se z libovolného legálního tahu, jehož `path` začíná touto předponou
 * – `captures` je zarovnané s `path`, takže sebrané předpony jsou `captures[0..prefix.length)`.
 * U větvení se sdíleným prefixem jsou tato pole shodná pro všechny větve.
 *
 * Slouží k „optimistickému" zobrazení rozpracovaného braní: dokud tah neskončí,
 * klient zobrazí kámen na posledním dopadu a tato sebraná pole schová (server je
 * potvrdí až s celým tahem). Prázdné pole u prosté (nebrací) předpony i když
 * `prefix` ničemu neodpovídá.
 */
export function capturesForPrefix(
  position: Position,
  from: Square,
  prefix: readonly Square[],
  ruleset: Ruleset = AMERICAN_RULESET,
): Square[] {
  for (const move of legalMoves(position, ruleset)) {
    if (move.from !== from || !pathStartsWith(move.path, prefix)) {
      continue;
    }
    return move.captures.slice(0, prefix.length);
  }
  return [];
}

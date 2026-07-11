/**
 * Evaluace v1 – čistá funkce pozice → skóre z pohledu strany na tahu.
 *
 * Skóre je vždy CELÉ číslo (na celočíselnosti stojí sběr remízových tahů
 * v search.ts – okno `best - 1`). Kladné = strana na tahu stojí lépe.
 *
 * Složky (rozhodnutí fáze 14, kalibrace síly přijde ve fázi „síla pro cíl"):
 * - materiál: muž 100, dáma 130 (short/americká) nebo ~300 (flying, dle ruleset),
 * - zadní řada: muž stojící na vlastní zadní řadě hlídá proti proměně (+8),
 * - postup: drobný bonus za každou řadu, o kterou muž postoupil (+1/řada),
 *   aby engine v klidných pozicích tlačil vpřed místo přešlapování.
 *
 * Dáma poziční bonusy nemá – mobilitu a kontrolu dvojitého rohu řeší až v2
 * evaluace. Evaluace NEVIDÍ remízová pravidla (čítač půltahů, opakování) –
 * hodnotí jedinou pozici bez historie.
 */

import { AMERICAN_RULESET, BOARD_SQUARES, legalMoves, squareToCoords } from '@checkers/rules';
import type { Color, Position, Ruleset, Square } from '@checkers/rules';

/** Hodnota muže. */
export const MAN_VALUE = 100;

/** Hodnota krátké (short) dámy – americká. Beze změny. */
export const KING_VALUE = 130;

/**
 * Hodnota létavé (flying) dámy – pool/ruská/česká. Řádově 3× muž: létavá dáma
 * ovládá celou diagonálu, je násobně cennější než krátká. Výchozí ~300 je
 * podloženo self-play sanity (`selfplay-flying-king.test.ts`), ne odhadem od
 * stolu; když by AI dámu podceňovala/přeceňovala, ladí se TATO konstanta.
 */
export const KING_VALUE_FLYING = 300;

/** Bonus za muže na vlastní zadní řadě (hlídá pole proměny soupeře). */
export const BACK_ROW_BONUS = 8;

/** Bonus za každou řadu postupu muže směrem k proměně. */
export const ADVANCE_BONUS = 1;

/** Vlastní zadní řada: černý začíná nahoře (řada 0), bílý dole (řada 7). */
const BACK_ROW: Record<Color, number> = { black: 0, white: 7 };

/**
 * Ohodnotí pozici z pohledu STRANY NA TAHU (negamax konvence): kladné
 * skóre = strana na tahu má výhodu. Vrací vždy celé číslo.
 *
 * Poškozenou desku (díra v poli – `undefined`) odmítá RangeError; tiché
 * přeskočení by dvě různě poškozené pozice ohodnotilo stejně a chyba by
 * kaskádovala do výběru tahu.
 *
 * `ruleset` řídí JEN cenu dámy: `king: 'flying'` (pool/ruská/česká) → létavá
 * dáma `KING_VALUE_FLYING`; `king: 'short'` (americká, default) → `KING_VALUE`.
 * Ostatní složky (materiál muže, postup, zadní řada) jsou na variantě nezávislé.
 * Chybí-li ruleset, počítá se americky (short) – dosavadní chování beze změny.
 * Mobilitu přes `legalMoves` v1 stále nepočítá (to až v2).
 */
export function evaluate(position: Position, ruleset: Ruleset = AMERICAN_RULESET): number {
  const kingValue = ruleset.king === 'flying' ? KING_VALUE_FLYING : KING_VALUE;
  let black = 0;
  let white = 0;
  for (let square = 1; square <= BOARD_SQUARES; square++) {
    const cell = position.board[square - 1];
    if (cell === undefined) {
      throw new RangeError(`Poškozená pozice: díra v board na poli ${String(square)}`);
    }
    if (cell === null) {
      continue;
    }
    let value: number;
    if (cell.kind === 'king') {
      value = kingValue;
    } else {
      // Postup se měří od vlastní zadní řady: černý roste s řadou, bílý proti ní.
      const { row } = squareToCoords(square);
      const advance = cell.color === 'black' ? row : 7 - row;
      const backRow = row === BACK_ROW[cell.color] ? BACK_ROW_BONUS : 0;
      value = MAN_VALUE + ADVANCE_BONUS * advance + backRow;
    }
    if (cell.color === 'black') {
      black += value;
    } else {
      white += value;
    }
  }
  // Rozdíl místo negace: `-(black - white)` by u vyrovnané pozice vrátil -0.
  return position.turn === 'black' ? black - white : white - black;
}

/**
 * Váha mobility: kolik bodů má rozdíl JEDNOHO legálního tahu navíc. Malá
 * proti materiálu (muž 100) – mobilita je jemné poziční koření, ne důvod
 * obětovat kámen.
 */
export const MOBILITY_WEIGHT = 2;

/** Bonus za vlastní kámen (muž i dáma) na vlastním dvojitém rohu. */
export const DOUBLE_CORNER_BONUS = 4;

/**
 * Vlastní dvojitý roh: tmavý roh desky + pole za ním. Číslování 1–32
 * (řada 0 = zadní řada černého nahoře): černý roh je pole 4 (řada 0, col 7)
 * a 8 (řada 1, col 6); bílý roh je pole 29 (řada 7, col 0) a 25 (řada 6,
 * col 1). Druhé dva rohy desky jsou světlé (nehrací) = jednoduché rohy.
 */
const DOUBLE_CORNER_SQUARES: Record<Color, ReadonlySet<Square>> = {
  black: new Set<Square>([4, 8]),
  white: new Set<Square>([25, 29]),
};

/**
 * Evaluace v2 (kandidát fáze 16) – k v1 (materiál, postup, zadní řada)
 * přidává tři poziční složky. Skóre je z pohledu STRANY NA TAHU a VŽDY
 * celé číslo (kontrakt searche – trik okna `best - 1`, viz search.ts).
 *
 * Složky proti v1:
 * - **mobilita** = `MOBILITY_WEIGHT × (počet legálních tahů strany na tahu
 *   − počet legálních tahů soupeře)`. Mobilita jde přes VEŘEJNÉ `legalMoves`
 *   (rules záměrně neexportuje generátor prostých tahů) – proto: má-li
 *   soupeř povinné braní, počítá se počet skokových sekvencí, ne prostých
 *   tahů. ZNÁMÝ DEFEKT (self-review fáze 16, nález 3): když soupeř MUSÍ brát
 *   (typicky můj kámen visí), `oppMoves` je malé → term mě „odmění" právě
 *   v pozici, kde hrozím ztrátou materiálu. Pletou se tak dva opačné významy
 *   („soupeř je omezený" vs. „soupeř mě nutně sebere"). V klidném listu, kde
 *   search evaluaci volá, strana NA TAHU braní nemá (počítá prosté tahy);
 *   defekt se týká hypoteticky prohozeného soupeře. Kandidát na opravu, až
 *   se bude evaluace ladit – jedno z možných vysvětlení, proč v2 v bráně
 *   neprokázala převahu.
 * - **dvojitý roh**: `DOUBLE_CORNER_BONUS` za vlastní kámen na vlastním
 *   dvojitém rohu (obranně cenné pole).
 * - **zadní řada podmíněně**: bonus za muže na vlastní zadní řadě se počítá
 *   jen dokud má SOUPEŘ aspoň jednoho muže (má co proměnit). Nemá-li soupeř
 *   muže (jen dámy), hlídání zadní řady je bezcenné → bez bonusu. (v1 dává
 *   bonus bezpodmínečně.)
 *
 * Poškozenou desku odmítá RangeError stejně jako v1.
 */
export function evaluateV2(position: Position, ruleset: Ruleset = AMERICAN_RULESET): number {
  let black = 0;
  let white = 0;
  let blackMen = 0;
  let whiteMen = 0;
  let blackBackRow = 0;
  let whiteBackRow = 0;

  for (let square = 1; square <= BOARD_SQUARES; square++) {
    const cell = position.board[square - 1];
    if (cell === undefined) {
      throw new RangeError(`Poškozená pozice: díra v board na poli ${String(square)}`);
    }
    if (cell === null) {
      continue;
    }
    let value: number;
    if (cell.kind === 'king') {
      value = KING_VALUE;
    } else {
      const { row } = squareToCoords(square);
      const advance = cell.color === 'black' ? row : 7 - row;
      value = MAN_VALUE + ADVANCE_BONUS * advance;
      if (cell.color === 'black') {
        blackMen++;
        if (row === BACK_ROW.black) {
          blackBackRow++;
        }
      } else {
        whiteMen++;
        if (row === BACK_ROW.white) {
          whiteBackRow++;
        }
      }
    }
    if (DOUBLE_CORNER_SQUARES[cell.color].has(square)) {
      value += DOUBLE_CORNER_BONUS;
    }
    if (cell.color === 'black') {
      black += value;
    } else {
      white += value;
    }
  }

  // Zadní řada se cení jen dokud má soupeř muže (má co proměnit).
  if (whiteMen > 0) {
    black += BACK_ROW_BONUS * blackBackRow;
  }
  if (blackMen > 0) {
    white += BACK_ROW_BONUS * whiteBackRow;
  }

  const material = position.turn === 'black' ? black - white : white - black;

  const opponent: Color = position.turn === 'black' ? 'white' : 'black';
  const myMoves = legalMoves(position, ruleset).length;
  const oppMoves = legalMoves({ board: position.board, turn: opponent }, ruleset).length;
  const mobility = MOBILITY_WEIGHT * (myMoves - oppMoves);

  return material + mobility;
}

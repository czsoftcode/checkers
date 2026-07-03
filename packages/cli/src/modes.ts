/**
 * Herní režimy CLI nad `playGame`. I/O jde přes rozhraní `CliIO`, aby šly
 * režimy testovat in-process bez terminálu a bez podprocesů.
 */

import { formatMove, parseMove } from '@checkers/rules';
import type { Color, GameResult, Move, Position } from '@checkers/rules';

import type { Strategy } from './game.js';
import { playGame } from './game.js';
import { randomPlayer } from './players.js';
import { mulberry32 } from './prng.js';
import { renderPosition } from './render.js';

/** I/O rozhraní CLI: výstup, chybový výstup a čtení řádku vstupu. */
export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  /** Přečte řádek vstupu; `null` = konec vstupu (EOF / Ctrl+D / Ctrl+C). */
  readLine(prompt: string): Promise<string | null>;
}

const RESULT_TEXT: Record<Exclude<GameResult, 'ongoing'>, string> = {
  'black-wins': 'Vyhrál černý.',
  'white-wins': 'Vyhrál bílý.',
  draw: 'Remíza.',
};

const COLOR_TEXT: Record<Color, string> = { black: 'černý', white: 'bílý' };

function printFinish(
  io: Pick<CliIO, 'out'>,
  position: Position,
  result: Exclude<GameResult, 'ongoing'>,
  plies: number,
): void {
  io.out('');
  io.out(renderPosition(position));
  io.out('');
  io.out(`Výsledek: ${RESULT_TEXT[result]} (${String(plies)} půltahů)`);
}

/**
 * Random vs random: odehraje celou partii, tiskne tahy, závěrečnou desku
 * a výsledek. Díky remízovým pravidlům (80 půltahů bez pokroku) vždy
 * terminuje – to je brána M2.
 */
export async function runRandomVsRandom(
  seed: number,
  io: Pick<CliIO, 'out'>,
): Promise<Exclude<GameResult, 'ongoing'>> {
  io.out(`Random vs random, seed ${String(seed)}`);
  const game = await playGame(
    randomPlayer(mulberry32(seed)),
    // Druhá strana dostane jiný stream: stejný seed pro obě by tahy
    // korreloval, XOR konstantou drží determinismus.
    randomPlayer(mulberry32(seed ^ 0x9e3779b9)),
    ({ ply, color, pdn }) => {
      io.out(`${String(ply)}. ${COLOR_TEXT[color]}: ${pdn}`);
    },
  );
  printFinish(io, game.finalState.position, game.result, game.pdnMoves.length);
  return game.result;
}

/** Přerušení partie člověkem (konec vstupu) – řízený konec, ne chyba programu. */
class GameAborted extends Error {
  constructor() {
    super('Partie přerušena');
    this.name = 'GameAborted';
  }
}

/**
 * Strategie člověka: vykreslí desku, nabídne legální tahy v PDN a čte
 * vstup, dokud nedostane legální tah. Nesmyslný zápis (RangeError
 * z parseMove) i legálně zapsaný, ale nelegální tah vypíše a ptá se
 * znovu – žádný vstup nesmí smyčku shodit. Jiná chyba než RangeError
 * (programová) se NEpolyká a letí ven i se stackem.
 */
function humanStrategy(io: CliIO): Strategy {
  return async (state, moves) => {
    io.out('');
    io.out(renderPosition(state.position));
    io.out(
      `Na tahu: ${COLOR_TEXT[state.position.turn]}. Legální tahy: ${moves
        .map(formatMove)
        .join(', ')}`,
    );
    for (;;) {
      const line = await io.readLine('Tvůj tah: ');
      if (line === null) {
        throw new GameAborted();
      }
      const text = line.trim();
      if (text === '') {
        continue;
      }
      let move: Move;
      try {
        move = parseMove(text);
      } catch (error) {
        if (error instanceof RangeError) {
          io.err(error.message);
          continue;
        }
        throw error;
      }
      const pdn = formatMove(move);
      if (!moves.some((legal) => formatMove(legal) === pdn)) {
        io.err(`Tah ${pdn} teď není legální. Vyber jeden z nabízených tahů.`);
        continue;
      }
      return move;
    }
  };
}

/**
 * Člověk vs random. Vrací výsledek partie, nebo `'aborted'`, když člověk
 * ukončí vstup (EOF) – to je vědomé opuštění partie, ne chyba.
 */
export async function runHumanVsRandom(
  seed: number,
  humanColor: Color,
  io: CliIO,
): Promise<Exclude<GameResult, 'ongoing'> | 'aborted'> {
  io.out(`Člověk (${COLOR_TEXT[humanColor]}) vs random, seed ${String(seed)}`);
  io.out('Tahy zadávej v PDN: prostý tah 11-15, skok 22x15, vícenásobný skok 26x17x10.');
  const human = humanStrategy(io);
  const robot = randomPlayer(mulberry32(seed));
  const black = humanColor === 'black' ? human : robot;
  const white = humanColor === 'white' ? human : robot;
  try {
    const game = await playGame(black, white, ({ ply, color, pdn }) => {
      io.out(`${String(ply)}. ${COLOR_TEXT[color]}: ${pdn}`);
    });
    printFinish(io, game.finalState.position, game.result, game.pdnMoves.length);
    return game.result;
  } catch (error) {
    if (error instanceof GameAborted) {
      io.out('Partie přerušena (konec vstupu).');
      return 'aborted';
    }
    throw error;
  }
}

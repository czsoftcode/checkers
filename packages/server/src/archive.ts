/**
 * Archiv dokončených partií na disk (fáze 23). Jednosměrné a best-effort:
 * po skončení partie se z ní vyrobí PDN celé partie a atomicky zapíše jako
 * `<id>.pdn`. Zpět do hry se NIKDY nenačítá – server zůstává jediným zdrojem
 * pravdy, tohle je jen výstup pro rozbor ve vnějším nástroji.
 *
 * Dvě oddělené odpovědnosti (schválně):
 * - `formatGamePdn` je ČISTÁ funkce (žádné I/O). Nesmyslný vstup (serializace
 *   ještě běžící partie) je programová chyba serveru → padá RangeError, NEmaskuje
 *   se jako I/O problém.
 * - `writeGamePdn` dělá VÝHRADNĚ I/O a nikdy nevyhazuje: selhání zápisu (plný
 *   disk, práva, neexistující adresář) partii neshodí, jen se zaloguje.
 */

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatMove } from '@checkers/rules';
import type { GameResult, Move } from '@checkers/rules';

/** Výsledkový token PDN. Člověk je černý (Black), engine bílý (White). */
const RESULT_TOKEN: Record<Exclude<GameResult, 'ongoing'>, string> = {
  'black-wins': '0-1',
  'white-wins': '1-0',
  draw: '1/2-1/2',
};

/** Dvojmístné číslo s vedoucí nulou (den/měsíc v tagu Date). */
function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Datum pro tag `[Date "YYYY.MM.DD"]` z lokálního času. */
function formatPdnDate(date: Date): string {
  return `${String(date.getFullYear())}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

/**
 * Sestaví PDN celé partie: 7 povinných STR tagů + movetext s full-move
 * číslováním (černý+bílý půltah pod jedním číslem, černý začíná) + výsledkový
 * token. Lichý počet půltahů (partie končí po tahu černého) → poslední číslo
 * nese jen jeden půltah.
 *
 * `result === 'ongoing'` je NEplatný vstup (archivuje se jen dokončená partie)
 * a vyhodí RangeError – tiše zapsat rozehranou partii jako „hotovou" by byla
 * horší chyba než hlasitý pád.
 */
export function formatGamePdn(moves: readonly Move[], result: GameResult, date: Date): string {
  if (result === 'ongoing') {
    throw new RangeError('formatGamePdn: nelze archivovat rozehranou partii (result "ongoing")');
  }
  const token = RESULT_TOKEN[result];
  const tags = [
    '[Event "Checkers"]',
    '[Site "local"]',
    `[Date "${formatPdnDate(date)}"]`,
    '[Round "-"]',
    '[White "Engine"]',
    '[Black "Human"]',
    `[Result "${token}"]`,
  ].join('\n');

  const tokens: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const moveNo = i / 2 + 1;
    const black = formatMove(moves[i]!);
    const white = i + 1 < moves.length ? formatMove(moves[i + 1]!) : undefined;
    tokens.push(white === undefined ? `${String(moveNo)}. ${black}` : `${String(moveNo)}. ${black} ${white}`);
  }
  tokens.push(token);
  const movetext = tokens.join(' ');

  return `${tags}\n\n${movetext}\n`;
}

/**
 * Atomicky zapíše PDN jako `<id>.pdn` do `dir`. Zápis jde nejdřív do
 * `<id>.pdn.tmp` v TÉMŽE adresáři a pak `rename` na finální jméno – rename je
 * na stejném filesystému atomický, takže čtenář nikdy neuvidí půlku souboru.
 *
 * NIKDY nevyhazuje. Při selhání zaloguje přes `console.error` a pokusí se
 * uklidit případný `.tmp` (ať po sobě nenechá půlnedopsaný soubor). `try`
 * obaluje výhradně I/O – žádnou programovou chybu tu nemaskujeme.
 */
export async function writeGamePdn(dir: string, id: string, pdn: string): Promise<void> {
  const finalPath = join(dir, `${id}.pdn`);
  const tmpPath = `${finalPath}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmpPath, pdn, 'utf8');
    await rename(tmpPath, finalPath);
  } catch (err) {
    console.error(`Nepodařilo se archivovat PDN partie ${id}:`, err);
    // Úklid rozdělaného .tmp. Když neexistuje (selhalo už mkdir/writeFile),
    // unlink taky selže – to je v pořádku, spolkneme to.
    try {
      await unlink(tmpPath);
    } catch {
      /* .tmp nemusí existovat – nic k úklidu */
    }
  }
}
